import './lib/env.js';
import { db } from './lib/db.js';
import { embed } from './lib/infomaniak.js';
import { upsert, countRows } from './lib/supabase.js';

const EMBED_BATCH = 16;

function ensureUploadedColumn(): void {
  const cols = db.prepare(`pragma table_info(chunks)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'uploaded')) {
    db.exec(`alter table chunks add column uploaded integer not null default 0`);
  }
}

function argValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function syncAudits(): Promise<void> {
  const rows = db.prepare(`select * from audits`).all() as Array<Record<string, unknown>>;
  const mapped = rows.map((a) => ({
    group_key: a.group_key,
    folder_id: a.folder_id,
    number: a.number,
    year: a.year,
    date_published: a.date_published ? String(a.date_published).slice(0, 10) : null,
    title_fr: a.title_fr,
    title_de: a.title_de,
    title_en: a.title_en,
    title_it: a.title_it,
    url_fr: a.url_fr,
    url_de: a.url_de,
    url_en: a.url_en,
    url_it: a.url_it,
  }));
  for (let i = 0; i < mapped.length; i += 200) {
    await upsert('efk_audits', mapped.slice(i, i + 200), 'group_key');
  }
  console.log(`Synced ${mapped.length} audits → efk_audits.`);
}

interface ChunkRow {
  id: number;
  group_key: string | null;
  folder_id: number | null;
  language: string;
  position: number;
  content: string;
  content_hash: string;
}

async function main(): Promise<void> {
  ensureUploadedColumn();
  const limit = argValue('--limit') ? Number(argValue('--limit')) : Infinity;

  await syncAudits();

  const pending = db
    .prepare(`select id, group_key, folder_id, lang as language, position, content, content_hash from chunks where uploaded = 0 order by id`)
    .all() as ChunkRow[];
  const todo = Number.isFinite(limit) ? pending.slice(0, limit) : pending;
  console.log(`${pending.length} chunks pending; processing ${todo.length}.`);

  const markUploaded = db.prepare(`update chunks set uploaded = 1 where id = ?`);
  const markMany = db.transaction((ids: number[]) => ids.forEach((id) => markUploaded.run(id)));

  let done = 0;
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => c.content));
    const rows = batch.map((c, j) => ({
      group_key: c.group_key,
      folder_id: c.folder_id,
      language: c.language,
      position: c.position,
      content: c.content,
      content_hash: c.content_hash,
      embedding: `[${vectors[j]!.join(',')}]`,
    }));
    await upsert('efk_chunks', rows, 'content_hash');
    markMany(batch.map((c) => c.id));
    done += batch.length;
    if (done % 160 === 0 || done === todo.length) {
      console.log(`  embedded+stored ${done}/${todo.length}`);
    }
  }

  const remote = await countRows('efk_chunks');
  console.log(`\nDone. uploaded this run=${done} | efk_chunks total in Supabase=${remote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
