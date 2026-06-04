import '../ingest/lib/env.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireEnv } from '../ingest/lib/env.js';
import { embed } from '../ingest/lib/infomaniak.js';

const PRODUCT_ID = process.env.INFOMANIAK_PRODUCT_ID ?? '109105';
const RERANK_URL = `https://api.infomaniak.com/2/ai/${PRODUCT_ID}/cohere/v2/rerank`;
const RERANK_MODEL = process.env.RERANK_MODEL ?? 'BAAI/bge-reranker-v2-m3';
const CANDIDATES = Number(process.env.RETRIEVAL_CANDIDATES ?? 30);
const KS = [1, 3, 5, 10];

const SUPA_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const SUPA_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const QUERY_INSTRUCTION =
  'Given a user question in French, German, English or Italian, retrieve passages from Swiss EFK (Federal Audit Office) audit reports that answer it.';
const formatQuery = (q: string): string => `<instruct>${QUERY_INSTRUCTION}\n<query>${q}`;

interface TestItem {
  id: string;
  lang: string;
  question: string;
  expected: number[];
}

interface HybridRow {
  folder_id: number | null;
  content: string;
  score: number;
}

async function hybridSearch(query: string, embedding: number[]): Promise<HybridRow[]> {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/efk_search_hybrid`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query_embedding: `[${embedding.join(',')}]`, query_text: query, match_count: CANDIDATES }),
  });
  if (!res.ok) throw new Error(`RPC failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as HybridRow[];
}

async function rerankOrder(query: string, rows: HybridRow[]): Promise<HybridRow[]> {
  if (rows.length === 0) return rows;
  const res = await fetch(RERANK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('INFOMANIAK_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: RERANK_MODEL, query, documents: rows.map((r) => r.content), top_n: rows.length }),
  });
  if (!res.ok) throw new Error(`rerank failed: HTTP ${res.status}`);
  const json = (await res.json()) as { results: { index: number; relevance_score: number }[] };
  return json.results.map((r) => rows[r.index]!);
}

function rankedAudits(rows: HybridRow[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (r.folder_id == null || seen.has(r.folder_id)) continue;
    seen.add(r.folder_id);
    out.push(r.folder_id);
  }
  return out;
}

function firstHitRank(ranked: number[], expected: number[]): number {
  for (let i = 0; i < ranked.length; i++) if (expected.includes(ranked[i]!)) return i + 1;
  return 0;
}

interface Acc {
  recall: Record<number, number>;
  mrr: number;
  n: number;
}

function emptyAcc(): Acc {
  return { recall: Object.fromEntries(KS.map((k) => [k, 0])), mrr: 0, n: 0 };
}

function tally(acc: Acc, ranked: number[], expected: number[]): void {
  acc.n++;
  const rank = firstHitRank(ranked, expected);
  if (rank > 0) acc.mrr += 1 / rank;
  for (const k of KS) if (rank > 0 && rank <= k) acc.recall[k]!++;
}

function report(label: string, acc: Acc): void {
  const pct = (x: number) => `${((x / acc.n) * 100).toFixed(0)}%`.padStart(4);
  const cols = KS.map((k) => `R@${k}=${pct(acc.recall[k]!)}`).join('  ');
  console.log(`  ${label.padEnd(18)} ${cols}   MRR=${(acc.mrr / acc.n).toFixed(3)}`);
}

async function main(): Promise<void> {
  const path = resolve(process.cwd(), 'eval/testset.json');
  const { items } = JSON.parse(readFileSync(path, 'utf-8')) as { items: TestItem[] };
  console.log(`Running ${items.length} eval queries (candidates=${CANDIDATES}), plain vs instructed query embedding...\n`);

  const plainHybrid = emptyAcc();
  const plainRerank = emptyAcc();
  const instrHybrid = emptyAcc();
  const instrRerank = emptyAcc();
  const byLangInstr: Record<string, Acc> = {};
  const misses: string[] = [];

  for (const item of items) {
    const [plainEmb] = await embed([item.question]);
    const [instrEmb] = await embed([formatQuery(item.question)]);

    const plainRows = await hybridSearch(item.question, plainEmb!);
    const instrRows = await hybridSearch(item.question, instrEmb!);

    const plainHybridRanked = rankedAudits(plainRows);
    const instrHybridRanked = rankedAudits(instrRows);
    const plainRerankRanked = rankedAudits(await rerankOrder(item.question, plainRows));
    const instrRerankRanked = rankedAudits(await rerankOrder(item.question, instrRows));

    tally(plainHybrid, plainHybridRanked, item.expected);
    tally(plainRerank, plainRerankRanked, item.expected);
    tally(instrHybrid, instrHybridRanked, item.expected);
    tally(instrRerank, instrRerankRanked, item.expected);
    (byLangInstr[item.lang] ??= emptyAcc()) && tally(byLangInstr[item.lang]!, instrRerankRanked, item.expected);

    const pRank = firstHitRank(plainRerankRanked, item.expected);
    const iRank = firstHitRank(instrRerankRanked, item.expected);
    if (iRank === 0 || iRank > 5) {
      misses.push(`${item.id} [${item.lang}] exp=${item.expected.join('/')} plainRerankRank=${pRank || '—'} instrRerankRank=${iRank || '—'}`);
    }
  }

  console.log('Overall (plain query embedding):');
  report('hybrid (RRF)', plainHybrid);
  report('hybrid+rerank', plainRerank);
  console.log('\nOverall (instructed query embedding):');
  report('hybrid (RRF)', instrHybrid);
  report('hybrid+rerank', instrRerank);

  console.log('\nBy language (instructed + rerank):');
  for (const lang of Object.keys(byLangInstr).sort()) report(lang, byLangInstr[lang]!);

  if (misses.length) {
    console.log('\nMisses / weak (instructed+rerank rank > 5):');
    for (const m of misses) console.log(`  ${m}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
