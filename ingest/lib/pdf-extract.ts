import { createRequire } from 'node:module';
import type { Lang } from './parse.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  buf: Buffer,
) => Promise<{ text: string; numpages: number; info: unknown }>;

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedPdf> {
  const result = await pdfParse(buffer);
  return { text: normalize(result.text), pageCount: result.numpages };
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/-\n(?=\p{Ll})/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const STOPWORDS: Record<Lang, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'une', 'dans', 'pour', 'que', 'est', 'aux', 'sur', 'par'],
  de: ['der', 'die', 'das', 'und', 'den', 'von', 'mit', 'für', 'auf', 'ist', 'dem', 'nicht'],
  en: ['the', 'and', 'for', 'that', 'with', 'are', 'this', 'was', 'from', 'has', 'have', 'were'],
  it: ['il', 'la', 'le', 'dei', 'che', 'per', 'con', 'una', 'del', 'nel', 'sono', 'gli'],
};

export function detectLanguage(text: string): Lang {
  const tokens = text.toLowerCase().match(/\p{L}+/gu)?.slice(0, 4000) ?? [];
  const counts = new Set(tokens);
  const scores: Record<Lang, number> = { fr: 0, de: 0, en: 0, it: 0 };
  for (const lang of Object.keys(STOPWORDS) as Lang[]) {
    for (const w of STOPWORDS[lang]) if (counts.has(w)) scores[lang]++;
  }
  return (Object.keys(scores) as Lang[]).reduce((a, b) => (scores[b] > scores[a] ? b : a), 'de');
}
