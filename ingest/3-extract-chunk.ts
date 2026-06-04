import { readFileSync } from 'node:fs';
import { db, nowIso } from './lib/db.js';
import { extractPdf, detectLanguage } from './lib/pdf-extract.js';
import { chunkText } from './lib/chunk.js';
import type { Lang } from './lib/parse.js';

interface PdfRow {
  url: string;
  group_key: string | null;
  folder_id: number | null;
  kind: string;
  lang: string | null;
  local_path: string | null;
  page_count: number | null;
}

const setPageCount = db.prepare(`update pdfs set page_count=@page_count where url=@url`);
const deleteChunks = db.prepare(`delete from chunks where pdf_url=?`);
const insertChunk = db.prepare(`
insert into chunks (pdf_url, group_key, folder_id, lang, position, content, content_hash, char_len, created_at)
values (@pdf_url, @group_key, @folder_id, @lang, @position, @content, @content_hash, @char_len, @created_at)
on conflict(content_hash) do nothing
`);

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const rows = db
    .prepare(`select url, group_key, folder_id, kind, lang, local_path, page_count from pdfs where local_path is not null`)
    .all() as PdfRow[];
  console.log(`${rows.length} downloaded PDFs to process.`);

  let processed = 0;
  let totalChunks = 0;
  let failed = 0;

  for (const row of rows) {
    const existing = (db.prepare(`select count(*) c from chunks where pdf_url=?`).get(row.url) as { c: number }).c;
    if (!force && existing > 0) continue;

    let extracted;
    try {
      extracted = await extractPdf(readFileSync(row.local_path!));
    } catch (e) {
      console.warn(`  extract failed ${row.local_path}: ${(e as Error).message}`);
      failed++;
      continue;
    }

    const lang: Lang = (row.lang as Lang) || detectLanguage(extracted.text);
    setPageCount.run({ url: row.url, page_count: extracted.pageCount });

    const chunks = chunkText(extracted.text);
    if (force) deleteChunks.run(row.url);

    const insertMany = db.transaction((items: typeof chunks) => {
      for (const c of items) {
        insertChunk.run({
          pdf_url: row.url,
          group_key: row.group_key,
          folder_id: row.folder_id,
          lang,
          position: c.position,
          content: c.content,
          content_hash: c.contentHash,
          char_len: c.charLen,
          created_at: nowIso(),
        });
      }
    });
    insertMany(chunks);

    processed++;
    totalChunks += chunks.length;
    if (processed % 20 === 0) console.log(`  processed ${processed} PDFs, ${totalChunks} chunks...`);
  }

  const stored = (db.prepare(`select count(*) c from chunks`).get() as { c: number }).c;
  const byLang = db.prepare(`select lang, count(*) c from chunks group by lang`).all() as { lang: string; c: number }[];
  console.log(`\nDone. processed=${processed} failed=${failed}`);
  console.log(`chunks stored=${stored}`);
  for (const l of byLang) console.log(`  ${l.lang}: ${l.c}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
