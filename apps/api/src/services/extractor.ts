import * as cheerio from 'cheerio';
import { config } from '../config.js';

export type SelectorMap = Record<string, string>;

/** Runs each CSS selector against the page and returns matched text keyed by field name. */
export function extractBySelectors(html: string, selectors: SelectorMap): Record<string, string> {
  const $ = cheerio.load(html);
  const out: Record<string, string> = {};
  for (const [field, selector] of Object.entries(selectors)) {
    try {
      const el = $(selector).first();
      const text = el.attr('content') ?? el.text();
      if (text) out[field] = text.trim();
    } catch {
      // invalid selector - skip that field
    }
  }
  return out;
}

export type JsonSchema = Record<string, 'string' | 'number' | 'boolean'>;

/**
 * Falls back to an OpenAI-compatible chat completion to extract fields the
 * site's saved selectors couldn't fill, given the schema's declared types.
 */
export async function extractWithLlm(
  html: string,
  schema: JsonSchema,
): Promise<Record<string, unknown>> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured - cannot use LLM extraction fallback');
  }

  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 12_000);

  const fields = Object.entries(schema)
    .map(([key, type]) => `- ${key}: ${type}`)
    .join('\n');

  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [
        {
          role: 'system',
          content:
            'You extract structured data from web page text and respond with ONLY a valid JSON object, no markdown fences, no commentary.',
        },
        {
          role: 'user',
          content: `Extract these fields from the page content below.\n\nFields (name: type):\n${fields}\n\nIf a field cannot be found, use null.\n\nPage content:\n${text}`,
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`LLM extraction failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message.content ?? '{}';
  return JSON.parse(content);
}
