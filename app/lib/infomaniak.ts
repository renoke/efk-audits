import {
  INFOMANIAK_EMBED_BASE,
  INFOMANIAK_RERANK_URL,
  EMBEDDING_MODEL,
  RERANK_MODEL,
} from './config';

function token(): string {
  const t = process.env.INFOMANIAK_TOKEN;
  if (!t) throw new Error('Missing INFOMANIAK_TOKEN');
  return t;
}

const QUERY_INSTRUCTION =
  'Given a user question in French, German, English or Italian, retrieve passages from Swiss EFK (Federal Audit Office) audit reports that answer it.';

export function formatQueryForEmbedding(query: string): string {
  return `<instruct>${QUERY_INSTRUCTION}\n<query>${query}`;
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${INFOMANIAK_EMBED_BASE}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: formatQueryForEmbedding(text) }),
  });
  if (!res.ok) throw new Error(`Embedding failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0]!.embedding;
}

export interface RerankResult {
  index: number;
  relevance_score: number;
}

export async function rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  const res = await fetch(INFOMANIAK_RERANK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: RERANK_MODEL, query, documents, top_n: Math.min(topN, documents.length) }),
  });
  if (!res.ok) throw new Error(`Rerank failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { results: RerankResult[] };
  return json.results;
}
