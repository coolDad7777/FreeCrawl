import { GoogleGenAI, Type } from "@google/genai";
import Groq from "groq-sdk";

export interface AIProvider {
  extractStructured(content: string, schema: any, prompt?: string): Promise<any>;
  summarize(content: string): Promise<string>;
}

function cleanText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(content: string): string {
  const text = cleanText(content);
  const match = text.match(/^(.{40,280}?[.!?])\s/);
  return (match?.[1] || text.slice(0, 280)).trim();
}

function firstHeading(content: string): string {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return (heading || firstSentence(content)).trim();
}

function schemaKeys(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return ['summary'];
  return Object.keys(schema).length > 0 ? Object.keys(schema) : ['summary'];
}

export class LocalProvider implements AIProvider {
  async extractStructured(content: string, schema: any): Promise<any> {
    const text = cleanText(content);
    const result: Record<string, string> = {};

    for (const key of schemaKeys(schema)) {
      const label = key.replace(/[_-]+/g, ' ');
      const labeledValue = text.match(new RegExp(`${label}\\s*[:\\-]\\s*([^.!?]{1,240})`, 'i'))?.[1];

      if (/title|name|heading/i.test(key)) {
        result[key] = firstHeading(content);
      } else if (/description|summary|overview|abstract/i.test(key)) {
        result[key] = firstSentence(content);
      } else if (/url|link/i.test(key)) {
        result[key] = content.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.]+$/, '') || '';
      } else {
        result[key] = (labeledValue || firstSentence(content)).trim();
      }
    }

    return result;
  }

  async summarize(content: string): Promise<string> {
    return firstSentence(content);
  }
}

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;

  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Gemini API key not configured");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async extractStructured(content: string, schema: any, prompt?: string): Promise<any> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Extract structured data from the following content based on the schema provided.
      
      Prompt: ${prompt || "Extract the relevant information."}
      
      Content:
      ${content.substring(0, 30000)}`, // Limit content size
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: Object.entries(schema).reduce((acc: any, [key, val]) => {
            acc[key] = { type: Type.STRING, description: val as string };
            return acc;
          }, {}),
        },
      },
    });

    try {
      return JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Failed to parse Gemini JSON response", e);
      return {};
    }
  }

  async summarize(content: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Summarize the following content in a concise way:
      
      ${content.substring(0, 10000)}`,
    });
    return response.text || "";
  }
}

export class GroqProvider implements AIProvider {
  private client: Groq | null = null;

  constructor() {
    if (process.env.GROQ_API_KEY) {
      this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  async extractStructured(content: string, schema: any, prompt?: string): Promise<any> {
    if (!this.client) throw new Error("Groq API key not configured");

    const completion = await this.client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a data extraction assistant. Extract data as JSON according to this schema: ${JSON.stringify(schema)}`,
        },
        {
          role: "user",
          content: `${prompt || "Extract information"}:\n\n${content.substring(0, 20000)}`,
        },
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0]?.message?.content || "{}");
  }

  async summarize(content: string): Promise<string> {
    if (!this.client) throw new Error("Groq API key not configured");

    const completion = await this.client.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Summarize this content:\n\n${content.substring(0, 10000)}`,
        },
      ],
      model: "llama-3.3-70b-versatile",
    });

    return completion.choices[0]?.message?.content || "";
  }
}

export function getAIProvider(name: string = 'local'): AIProvider {
  switch (name) {
    case 'groq':
      return process.env.GROQ_API_KEY ? new GroqProvider() : new LocalProvider();
    case 'gemini':
      return process.env.GEMINI_API_KEY ? new GeminiProvider() : new LocalProvider();
    case 'local':
      return new LocalProvider();
    default:
      return new LocalProvider();
  }
}
