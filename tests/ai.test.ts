import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  getAIProvider,
  isJsonSchema,
  listAIProviders,
  resolveSchema,
  toGeminiSchema,
} from '../src/ai';

describe('isJsonSchema', () => {
  it('recognizes a real JSON Schema', () => {
    expect(isJsonSchema({ type: 'object', properties: {} })).toBe(true);
    expect(isJsonSchema({ items: { type: 'string' } })).toBe(true);
  });

  it('treats a flat field map as shorthand', () => {
    expect(isJsonSchema({ title: 'The page title', price: 'The listed price' })).toBe(false);
  });
});

describe('resolveSchema', () => {
  it('expands the shorthand field map into a JSON Schema', () => {
    expect(resolveSchema({ content: '', schema: { title: 'The page title' } })).toEqual({
      type: 'object',
      properties: { title: { type: 'string', description: 'The page title' } },
    });
  });

  it('passes a full JSON Schema through untouched', () => {
    const schema = { type: 'object', properties: { price: { type: 'number' } } };
    expect(resolveSchema({ content: '', schema })).toBe(schema);
  });

  it('falls back to a summary schema', () => {
    expect(resolveSchema({ content: '' })).toMatchObject({
      type: 'object',
      properties: { summary: { type: 'string' } },
    });
  });
});

describe('toGeminiSchema', () => {
  it('converts nested objects and arrays', () => {
    const converted = toGeminiSchema({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Product name' },
        price: { type: 'number' },
        inStock: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        vendor: { type: 'object', properties: { id: { type: 'integer' } } },
      },
    });

    expect(converted).toMatchObject({
      type: 'OBJECT',
      required: ['name'],
      properties: {
        name: { type: 'STRING', description: 'Product name' },
        price: { type: 'NUMBER' },
        inStock: { type: 'BOOLEAN' },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
        vendor: { type: 'OBJECT', properties: { id: { type: 'INTEGER' } } },
      },
    });
  });

  it('infers object from properties and array from items', () => {
    expect(toGeminiSchema({ properties: { a: { type: 'string' } } })).toMatchObject({ type: 'OBJECT' });
    expect(toGeminiSchema({ items: { type: 'string' } })).toMatchObject({ type: 'ARRAY' });
  });

  it('keeps enum values as strings', () => {
    expect(toGeminiSchema({ type: 'string', enum: ['a', 'b'] })).toMatchObject({ enum: ['a', 'b'] });
  });
});

describe('buildExtractionPrompt', () => {
  it('includes the source URL and the page content', () => {
    const prompt = buildExtractionPrompt({
      content: 'Page body here',
      prompt: 'Find the price',
      sourceUrl: 'https://example.com/p',
    });

    expect(prompt).toContain('Find the price');
    expect(prompt).toContain('https://example.com/p');
    expect(prompt).toContain('Page body here');
  });

  it('truncates very long content', () => {
    const prompt = buildExtractionPrompt({ content: 'x'.repeat(200_000) });
    expect(prompt).toContain('[content truncated]');
    expect(prompt.length).toBeLessThan(140_000);
  });
});

describe('provider registry', () => {
  it('returns gemini for an unknown provider name', () => {
    expect(getAIProvider('nonsense').name).toBe('gemini');
    expect(getAIProvider('groq').name).toBe('groq');
  });

  it('reports configuration state for every provider', () => {
    expect(listAIProviders()).toEqual([
      { name: 'gemini', configured: false },
      { name: 'groq', configured: false },
    ]);
  });

  it('throws a helpful error when a key is missing', async () => {
    await expect(getAIProvider('gemini').extractStructured({ content: 'x' })).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
    await expect(getAIProvider('groq').extractStructured({ content: 'x' })).rejects.toThrow(
      /GROQ_API_KEY/,
    );
  });
});
