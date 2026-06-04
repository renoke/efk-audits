import { createHash } from 'node:crypto';
import { CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS, CHUNK_MIN_CHARS } from './config.js';

export interface Chunk {
  position: number;
  content: string;
  contentHash: string;
  charLen: number;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function chunkText(text: string): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0);

  const raw: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf.length + p.length + 1 <= CHUNK_TARGET_CHARS) {
      buf = buf ? `${buf} ${p}` : p;
      continue;
    }
    if (buf) raw.push(buf);
    if (p.length <= CHUNK_TARGET_CHARS) {
      buf = p;
    } else {
      for (const slice of hardWrap(p)) raw.push(slice);
      buf = '';
    }
  }
  if (buf) raw.push(buf);

  const withOverlap = applyOverlap(raw);

  const out: Chunk[] = [];
  let position = 0;
  for (const content of withOverlap) {
    if (content.length < CHUNK_MIN_CHARS && out.length > 0) continue;
    out.push({ position: position++, content, contentHash: sha256(content), charLen: content.length });
  }
  return out;
}

function hardWrap(p: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < p.length) {
    let end = Math.min(p.length, i + CHUNK_TARGET_CHARS);
    if (end < p.length) {
      const lastSpace = p.lastIndexOf(' ', end);
      if (lastSpace > i + CHUNK_MIN_CHARS) end = lastSpace;
    }
    out.push(p.slice(i, end).trim());
    i = end;
  }
  return out;
}

function applyOverlap(chunks: string[]): string[] {
  if (CHUNK_OVERLAP_CHARS <= 0) return chunks;
  return chunks.map((c, idx) => {
    if (idx === 0) return c;
    const prev = chunks[idx - 1]!;
    const tail = prev.slice(Math.max(0, prev.length - CHUNK_OVERLAP_CHARS));
    const cut = tail.indexOf(' ');
    const overlap = cut >= 0 ? tail.slice(cut + 1) : tail;
    return `${overlap} ${c}`.trim();
  });
}
