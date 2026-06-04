import { db } from './lib/db.js';
import { classifyPdf, idPrefixFromPdfUrl } from './lib/parse.js';

interface Row {
  url: string;
  group_key: string | null;
  sha256: string | null;
}

const rows = db.prepare(`select url, group_key, sha256 from pdfs`).all() as Row[];
console.log(`Re-classifying ${rows.length} PDFs...`);

const primaryId = new Map<string, string>();
{
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const { kind } = classifyPdf(r.url);
    if (kind === 'exclude' || !r.group_key) continue;
    const id = idPrefixFromPdfUrl(r.url);
    if (!id) continue;
    if (!counts.has(r.group_key)) counts.set(r.group_key, new Map());
    const m = counts.get(r.group_key)!;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  for (const [g, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) primaryId.set(g, best[0]);
  }
}

const del = db.prepare(`delete from pdfs where url = ?`);
const upd = db.prepare(`update pdfs set kind = @kind, lang = @lang where url = @url`);

let deletedExclude = 0;
let deletedForeign = 0;
let kept = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    const { kind, lang } = classifyPdf(r.url);
    if (kind === 'exclude') {
      del.run(r.url);
      deletedExclude++;
      continue;
    }
    const id = idPrefixFromPdfUrl(r.url);
    const primary = r.group_key ? primaryId.get(r.group_key) : undefined;
    if (id && primary && id !== primary) {
      del.run(r.url);
      deletedForeign++;
      continue;
    }
    upd.run({ url: r.url, kind, lang });
    kept++;
  }
});
tx();

const q = (s: string) => (db.prepare(s).get() as { c: number }).c;
console.log(`\nDeleted: exclude=${deletedExclude} foreign-id=${deletedForeign} | kept=${kept}`);
console.log(`Now: full=${q(`select count(*) c from pdfs where kind='full'`)} summary=${q(`select count(*) c from pdfs where kind='summary'`)}`);

console.log('\nfull-pdfs-per-group distribution:');
for (const r of db
  .prepare(
    `select n, count(*) groups from (select group_key, count(*) n from pdfs where kind='full' group by group_key) group by n order by n`,
  )
  .all() as { n: number; groups: number }[]) {
  console.log(`  ${r.n} full: ${r.groups} groups`);
}

const noFull = db
  .prepare(
    `select count(*) c from audits a where not exists (select 1 from pdfs p where p.group_key=a.group_key and p.kind='full')`,
  )
  .get() as { c: number };
console.log(`\naudits with no full report: ${noFull.c}`);
