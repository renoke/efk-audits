import { supabase } from './supabase';
import { embedQuery, rerank } from './infomaniak';
import { RETRIEVAL_CANDIDATES, RETRIEVAL_TOP_K } from './config';
import type { Lang } from './language';

interface HybridRow {
  id: number;
  group_key: string;
  folder_id: number | null;
  language: string;
  position: number;
  content: string;
  score: number;
}

interface AuditMeta {
  group_key: string;
  number: string | null;
  year: number | null;
  date_published: string | null;
  title_fr: string | null;
  title_de: string | null;
  title_en: string | null;
  title_it: string | null;
  url_fr: string | null;
  url_de: string | null;
  url_en: string | null;
  url_it: string | null;
}

export interface RetrievedChunk {
  groupKey: string;
  language: string;
  content: string;
  number: string | null;
  title: string | null;
  year: number | null;
  url: string | null;
  relevance: number;
}

export interface Reference {
  number: string | null;
  title: string | null;
  year: number | null;
  url: string | null;
}

function pick(a: AuditMeta, field: 'title' | 'url', lang: Lang): string | null {
  return a[`${field}_${lang}`] ?? a[`${field}_de`] ?? a[`${field}_fr`] ?? a[`${field}_en`] ?? a[`${field}_it`];
}

export async function retrieve(query: string, userLang: Lang, topK = RETRIEVAL_TOP_K): Promise<RetrievedChunk[]> {
  const embedding = await embedQuery(query);

  const { data, error } = await supabase.rpc('efk_search_hybrid', {
    query_embedding: `[${embedding.join(',')}]`,
    query_text: query,
    match_count: RETRIEVAL_CANDIDATES,
  });
  if (error) throw new Error(`Search failed: ${error.message}`);
  const candidates = (data ?? []) as HybridRow[];
  if (candidates.length === 0) return [];

  const ranked = await rerank(query, candidates.map((c) => c.content), topK);
  const top = ranked.map((r) => ({ row: candidates[r.index]!, relevance: r.relevance_score }));

  const groupKeys = [...new Set(top.map((t) => t.row.group_key))];
  const { data: auditsData } = await supabase
    .from('efk_audits')
    .select('group_key,number,year,date_published,title_fr,title_de,title_en,title_it,url_fr,url_de,url_en,url_it')
    .in('group_key', groupKeys);
  const byKey = new Map((auditsData as AuditMeta[] | null ?? []).map((a) => [a.group_key, a]));

  return top.map(({ row, relevance }) => {
    const a = byKey.get(row.group_key);
    return {
      groupKey: row.group_key,
      language: row.language,
      content: row.content,
      number: a?.number ?? null,
      title: a ? pick(a, 'title', userLang) : null,
      year: a?.year ?? null,
      url: a ? pick(a, 'url', userLang) : null,
      relevance,
    };
  });
}

export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return 'No relevant audit excerpts were found.';
  return chunks
    .map((c, i) => `[${i + 1}] EFK ${c.number ?? '?'} — ${c.title ?? ''} (${c.year ?? '?'}) [source language: ${c.language}]\n${c.content}`)
    .join('\n\n---\n\n');
}

export function extractReferences(chunks: RetrievedChunk[]): Reference[] {
  const seen = new Set<string>();
  const refs: Reference[] = [];
  for (const c of chunks) {
    if (seen.has(c.groupKey)) continue;
    seen.add(c.groupKey);
    refs.push({ number: c.number, title: c.title, year: c.year, url: c.url });
  }
  return refs;
}
