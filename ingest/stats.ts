import { db } from './lib/db.js';

function one(sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

console.log('Audits:        ', one('select count(*) c from audits'));
console.log('Pages fetched: ', one('select count(*) c from pages where http_status=200'));
console.log('PDFs (full):   ', one(`select count(*) c from pdfs where kind='full'`));
console.log('PDFs (summary):', one(`select count(*) c from pdfs where kind='summary'`));
console.log('PDFs downloaded:', one('select count(*) c from pdfs where sha256 is not null'));
console.log('Chunks:        ', one('select count(*) c from chunks'));

const byLang = db.prepare(`select lang, count(*) c from chunks group by lang order by c desc`).all();
if (byLang.length) {
  console.log('\nChunks by language:');
  for (const r of byLang as { lang: string; c: number }[]) console.log(`  ${r.lang}: ${r.c}`);
}

const sample = db.prepare(`select number, year, date_published, title_fr, title_de from audits order by date_published desc limit 5`).all();
if (sample.length) {
  console.log('\nMost recent audits:');
  for (const a of sample as Array<Record<string, unknown>>) {
    console.log(`  ${a.year} ${a.date_published} — ${a.title_fr ?? a.title_de ?? '(no title)'}`);
  }
}
