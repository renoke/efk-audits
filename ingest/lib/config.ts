import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '..', '..');
export const DATA_DIR = resolve(ROOT, 'data');
export const DB_PATH = resolve(DATA_DIR, 'ingest.db');
export const PDF_DIR = resolve(DATA_DIR, 'pdfs');

export const ORIGIN = 'https://www.efk.admin.ch';

export const AUDIT_SITEMAPS = [
  `${ORIGIN}/audit-sitemap.xml`,
  `${ORIGIN}/audit-sitemap2.xml`,
  `${ORIGIN}/audit-sitemap3.xml`,
  `${ORIGIN}/audit-sitemap4.xml`,
];

export const USER_AGENT =
  'efk-audits-rag/0.1 (research; contact renaud.kern@gmail.com)';

export const MIN_REQUEST_INTERVAL_MS = 2000;
export const MAX_RETRIES = 5;

export const CHUNK_TARGET_CHARS = 1400;
export const CHUNK_OVERLAP_CHARS = 180;
export const CHUNK_MIN_CHARS = 250;
