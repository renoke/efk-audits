import fs from 'fs';
import path from 'path';

function loadModelEnv(): Record<string, string> {
  for (const dir of [process.cwd(), path.join(process.cwd(), '..')]) {
    const file = path.join(dir, 'model.env');
    if (!fs.existsSync(file)) continue;
    const config: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key) config[key.trim()] = rest.join('=').trim();
    }
    return config;
  }
  return {};
}

const modelConfig = loadModelEnv();

export function getConfig(key: string, defaultValue: string): string {
  return process.env[key] || modelConfig[key] || defaultValue;
}

export function getConfigNumber(key: string, defaultValue: number): number {
  const value = getConfig(key, String(defaultValue));
  const n = parseFloat(value);
  return Number.isNaN(n) ? defaultValue : n;
}

export function getConfigInt(key: string, defaultValue: number): number {
  const value = getConfig(key, String(defaultValue));
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

const PRODUCT_ID = getConfig('INFOMANIAK_PRODUCT_ID', '109105');
export const INFOMANIAK_EMBED_BASE = `https://api.infomaniak.com/1/ai/${PRODUCT_ID}/openai/v1`;
export const INFOMANIAK_LLM_BASE = `https://api.infomaniak.com/2/ai/${PRODUCT_ID}/openai/v1`;
export const INFOMANIAK_RERANK_URL = `https://api.infomaniak.com/2/ai/${PRODUCT_ID}/cohere/v2/rerank`;

export const EMBEDDING_MODEL = getConfig('EMBEDDING_MODEL', 'bge_multilingual_gemma2');
export const LLM_MODEL = getConfig('LLM_MODEL', 'mistralai/Ministral-3-14B-Instruct-2512');
export const RERANK_MODEL = getConfig('RERANK_MODEL', 'BAAI/bge-reranker-v2-m3');
export const LLM_TEMPERATURE = getConfigNumber('LLM_TEMPERATURE', 0.3);
export const LLM_TOP_P = getConfigNumber('LLM_TOP_P', 0.95);
export const LLM_FREQUENCY_PENALTY = getConfigNumber('LLM_FREQUENCY_PENALTY', 0.3);
export const RETRIEVAL_CANDIDATES = getConfigInt('RETRIEVAL_CANDIDATES', 30);
export const RETRIEVAL_TOP_K = getConfigInt('RETRIEVAL_TOP_K', 8);
