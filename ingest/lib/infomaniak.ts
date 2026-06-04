import { requireEnv } from './env.js';

const PRODUCT_ID = process.env.INFOMANIAK_PRODUCT_ID ?? '109105';
const BASE = `https://api.infomaniak.com/1/ai/${PRODUCT_ID}/openai/v1`;
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL_ID ?? 'bge_multilingual_gemma2';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export async function embed(inputs: string[]): Promise<number[][]> {
  const token = requireEnv('INFOMANIAK_TOKEN');
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as EmbeddingResponse;
      const sorted = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (sorted.length !== inputs.length) {
        throw new Error(`expected ${inputs.length} embeddings, got ${sorted.length}`);
      }
      return sorted;
    } catch (err) {
      attempt++;
      if (attempt > 6) throw err;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      console.warn(`  embed retry ${attempt}/6: ${(err as Error).message} — waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }
}
