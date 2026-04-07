import { GoogleGenAI, Type } from "@google/genai";
import Groq from "groq-sdk";

export interface AIProvider {
  extractStructured(content: string, schema: any, prompt?: string): Promise<any>;
  summarize(content: string): Promise<string>;
}

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async extractStructured(content: string, schema: any, prompt?: string): Promise<any> {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
      model: "gemini-3-flash-preview",
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

export function getAIProvider(name: string = 'gemini'): AIProvider {
  switch (name) {
    case 'groq':
      return new GroqProvider();
    case 'gemini':
    default:
      return new GeminiProvider();
  }
}
