import { GoogleGenAI, Type } from '@google/genai';
import Groq from 'groq-sdk';
import { config } from '../config';
import { ConfigurationError, FreeCrawlError } from '../core/errors';

export interface ExtractionRequest {
  content: string;
  /** Full JSON Schema describing the desired output. */
  schema?: Record<string, unknown>;
  /** Shorthand alternative to `schema`: a map of field name to description. */
  fields?: Record<string, string>;
  prompt?: string;
  systemPrompt?: string;
  sourceUrl?: string;
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  extractStructured(request: ExtractionRequest): Promise<Record<string, unknown>>;
  summarize(content: string): Promise<string>;
}

const MAX_CONTENT_CHARS = 120_000;
const DEFAULT_SYSTEM_PROMPT =
  'You are a precise web data extraction engine. Use only facts present in the provided page content. ' +
  'Return null for any field the page does not state. Never invent values.';

function truncate(content: string, limit = MAX_CONTENT_CHARS): string {
  return content.length > limit ? `${content.slice(0, limit)}\n\n[content truncated]` : content;
}

function fieldsToJsonSchema(fields: Record<string, string>): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(fields).map(([key, description]) => [
        key,
        { type: 'string', description },
      ]),
    ),
  };
}

/** True for a real JSON Schema, false for the `{ field: description }` shorthand. */
export function isJsonSchema(schema: Record<string, unknown>): boolean {
  return 'type' in schema || 'properties' in schema || '$schema' in schema || 'items' in schema;
}

export function resolveSchema(request: ExtractionRequest): Record<string, unknown> {
  if (request.schema) {
    return isJsonSchema(request.schema)
      ? request.schema
      : fieldsToJsonSchema(
          Object.fromEntries(
            Object.entries(request.schema).map(([key, value]) => [key, String(value)]),
          ),
        );
  }
  if (request.fields) return fieldsToJsonSchema(request.fields);
  return {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'A concise summary of the page content' },
    },
  };
}

const JSON_TYPE_TO_GEMINI: Record<string, Type> = {
  object: Type.OBJECT,
  array: Type.ARRAY,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
};

/** Translates a JSON Schema subset into the shape `@google/genai` expects. */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const declaredType = Array.isArray(schema.type)
    ? String((schema.type as unknown[])[0])
    : typeof schema.type === 'string'
      ? schema.type
      : schema.properties
        ? 'object'
        : schema.items
          ? 'array'
          : 'string';

  const result: Record<string, unknown> = {
    type: JSON_TYPE_TO_GEMINI[declaredType] ?? Type.STRING,
  };

  if (typeof schema.description === 'string') result.description = schema.description;
  if (Array.isArray(schema.enum)) result.enum = schema.enum.map(String);

  if (result.type === Type.OBJECT) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    result.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
    if (Array.isArray(schema.required)) result.required = schema.required.map(String);
  }

  if (result.type === Type.ARRAY) {
    result.items = toGeminiSchema((schema.items ?? { type: 'string' }) as Record<string, unknown>);
  }

  return result;
}

export function buildExtractionPrompt(request: ExtractionRequest): string {
  const instruction = request.prompt ?? 'Extract every field described by the schema.';
  const source = request.sourceUrl ? `Source URL: ${request.sourceUrl}\n` : '';
  return `${instruction}\n\n${source}Page content:\n"""\n${truncate(request.content)}\n"""`;
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    // Models occasionally prepend prose; recover the outermost JSON object.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        // Fall through.
      }
    }
    throw new FreeCrawlError('The AI provider returned a non-JSON response', 502, 'extraction_failed');
  }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return Boolean(config.ai.geminiApiKey);
  }

  private getClient(): GoogleGenAI {
    if (!this.isConfigured()) {
      throw new ConfigurationError(
        'GEMINI_API_KEY is not set. Add it to .env to enable AI extraction.',
      );
    }
    this.client ??= new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
    return this.client;
  }

  async extractStructured(request: ExtractionRequest): Promise<Record<string, unknown>> {
    const response = await this.getClient().models.generateContent({
      model: config.ai.geminiModel,
      contents: buildExtractionPrompt(request),
      config: {
        systemInstruction: request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(resolveSchema(request)) as never,
        temperature: 0,
      },
    });

    return parseJsonResponse(response.text ?? '{}');
  }

  async summarize(content: string): Promise<string> {
    const response = await this.getClient().models.generateContent({
      model: config.ai.geminiModel,
      contents: `Summarize the following page in at most five sentences:\n\n${truncate(content, 30_000)}`,
    });
    return response.text ?? '';
  }
}

export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  private client: Groq | null = null;

  isConfigured(): boolean {
    return Boolean(config.ai.groqApiKey);
  }

  private getClient(): Groq {
    if (!this.isConfigured()) {
      throw new ConfigurationError('GROQ_API_KEY is not set. Add it to .env to use the Groq provider.');
    }
    this.client ??= new Groq({ apiKey: config.ai.groqApiKey });
    return this.client;
  }

  async extractStructured(request: ExtractionRequest): Promise<Record<string, unknown>> {
    const schema = resolveSchema(request);
    const completion = await this.getClient().chat.completions.create({
      model: config.ai.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}\nRespond with a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
        },
        { role: 'user', content: buildExtractionPrompt(request) },
      ],
    });

    return parseJsonResponse(completion.choices[0]?.message?.content ?? '{}');
  }

  async summarize(content: string): Promise<string> {
    const completion = await this.getClient().chat.completions.create({
      model: config.ai.groqModel,
      messages: [
        {
          role: 'user',
          content: `Summarize the following page in at most five sentences:\n\n${truncate(content, 30_000)}`,
        },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  }
}

const providers: Record<string, AIProvider> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
};

export function getAIProvider(name: string = config.ai.defaultProvider): AIProvider {
  return providers[name] ?? providers.gemini;
}

export function listAIProviders(): { name: string; configured: boolean }[] {
  return Object.values(providers).map((provider) => ({
    name: provider.name,
    configured: provider.isConfigured(),
  }));
}
