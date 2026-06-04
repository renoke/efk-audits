import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { db, nowIso } from './lib/db.js';
import { fetchBuffer } from './lib/http.js';
import { PDF_DIR } from './lib/config.js';

interface PdfRow {
  url: string;
  folder_id: number | null;
  kind: string;
  lang: string | null;
  local_path: string | null;
  sha256: string | null;
}

function localName(row: PdfRow): string {
  const base = row.url.split('/').pop() || 'file.pdf';
  const prefix = row.folder_id ?? 'x';
  return resolve(PDF_DIR, `${prefix}__${base}`);
}

const update = db.prepare(`
update pdfs set local_path=@local_path, bytes=@bytes, sha256=@sha256, http_status=@http_status, downloaded_at=@downloaded_at
where url=@url
`);

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const rows = db.prepare(`select url, folder_id, kind, lang, local_path, sha256 from pdfs`).all() as PdfRow[];
  console.log(`${rows.length} PDFs registered.`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const path = localName(row);
    if (!force && row.sha256 && row.local_path && existsSync(row.local_path)) {
      skipped++;
      continue;
    }
    const { status, body } = await fetchBuffer(row.url);
    if (status !== 200 || body.length === 0) {
      update.run({ url: row.url, local_path: null, bytes: 0, sha256: null, http_status: status, downloaded_at: nowIso() });
      console.warn(`  ${row.url} -> HTTP ${status}`);
      failed++;
      continue;
    }
    writeFileSync(path, body);
    const sha = createHash('sha256').update(body).digest('hex');
    update.run({ url: row.url, local_path: path, bytes: body.length, sha256: sha, http_status: 200, downloaded_at: nowIso() });
    downloaded++;
    if (downloaded % 20 === 0) console.log(`  downloaded ${downloaded}...`);
  }

  const bytes = (db.prepare(`select coalesce(sum(bytes),0) b from pdfs`).get() as { b: number }).b;
  console.log(`\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
  console.log(`total ${(bytes / 1e6).toFixed(1)} MB on disk in ${PDF_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
