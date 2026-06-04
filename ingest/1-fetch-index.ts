import { db, nowIso } from './lib/db.js';
import { fetchText } from './lib/http.js';
import { parseDetail, classifyPdf, folderIdFromPdfUrl } from './lib/parse.js';
import { collectAuditGroups } from './lib/sitemap.js';
import type { Lang } from './lib/parse.js';

const upsertPage = db.prepare(`
insert into pages (url, lang, group_key, title, description, date_published, date_modified, folder_id, http_status, fetched_at)
values (@url, @lang, @group_key, @title, @description, @date_published, @date_modified, @folder_id, @http_status, @fetched_at)
on conflict(url) do update set
  lang=excluded.lang, group_key=excluded.group_key, title=excluded.title, description=excluded.description,
  date_published=excluded.date_published, date_modified=excluded.date_modified, folder_id=excluded.folder_id,
  http_status=excluded.http_status, fetched_at=excluded.fetched_at
`);

const upsertPdf = db.prepare(`
insert into pdfs (url, group_key, folder_id, kind, lang)
values (@url, @group_key, @folder_id, @kind, @lang)
on conflict(url) do update set
  group_key=excluded.group_key, folder_id=excluded.folder_id, kind=excluded.kind, lang=excluded.lang
`);

const alreadyOk = new Set<string>(
  (db.prepare(`select url from pages where http_status = 200`).all() as { url: string }[]).map((r) => r.url),
);

function rebuildAudits(): void {
  db.exec('delete from audits');
  const groups = db
    .prepare(`select distinct group_key from pages where http_status = 200`)
    .all() as { group_key: string }[];
  const pagesByGroup = db.prepare(`select * from pages where group_key = ? and http_status = 200`);
  const insert = db.prepare(`
    insert into audits (group_key, folder_id, number, year, date_published, title_fr, title_de, title_en, title_it, url_fr, url_de, url_en, url_it)
    values (@group_key, @folder_id, @number, @year, @date_published, @title_fr, @title_de, @title_en, @title_it, @url_fr, @url_de, @url_en, @url_it)
  `);
  for (const { group_key } of groups) {
    const rows = pagesByGroup.all(group_key) as Array<{
      url: string; lang: Lang; title: string | null; date_published: string | null; folder_id: number | null;
    }>;
    const titles: Record<string, string | null> = {};
    const urls: Record<string, string | null> = {};
    let folderId: number | null = null;
    let date: string | null = null;
    for (const r of rows) {
      titles[r.lang] = r.title;
      urls[r.lang] = r.url;
      if (r.folder_id != null) folderId = r.folder_id;
      if (r.date_published && (!date || r.date_published < date)) date = r.date_published;
    }
    insert.run({
      group_key,
      folder_id: folderId,
      number: folderId != null ? `EFK-${folderId}` : null,
      year: date ? Number(date.slice(0, 4)) : null,
      date_published: date,
      title_fr: titles.fr ?? null, title_de: titles.de ?? null, title_en: titles.en ?? null, title_it: titles.it ?? null,
      url_fr: urls.fr ?? null, url_de: urls.de ?? null, url_en: urls.en ?? null, url_it: urls.it ?? null,
    });
  }
}

function argValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const maxArg = argValue('--max-audits');
  const maxAudits = maxArg ? Number(maxArg) : Infinity;
  const groups = await collectAuditGroups();
  const selected = Number.isFinite(maxAudits) ? groups.slice(0, maxAudits) : groups;
  const urls = selected.flatMap((g) => g.urls);
  console.log(`Found ${groups.length} audit groups across the sitemaps.`);
  if (Number.isFinite(maxAudits)) {
    const first = selected[0]?.lastmod ?? '?';
    const last = selected[selected.length - 1]?.lastmod ?? '?';
    console.log(`Selecting ${selected.length} most-recent audits (lastmod ${last} … ${first}) → ${urls.length} pages.`);
  }

  let fetched = 0;
  let skipped = 0;
  for (const url of urls) {
    if (!force && alreadyOk.has(url)) {
      skipped++;
      continue;
    }
    const { status, body } = await fetchText(url);
    if (status !== 200 || !body) {
      upsertPage.run({
        url, lang: null, group_key: url, title: null, description: null,
        date_published: null, date_modified: null, folder_id: null, http_status: status, fetched_at: nowIso(),
      });
      console.warn(`  ${url} -> HTTP ${status}`);
      continue;
    }
    const meta = parseDetail(url, body);
    upsertPage.run({
      url,
      lang: meta.lang,
      group_key: meta.groupKey,
      title: meta.title,
      description: meta.description,
      date_published: meta.datePublished,
      date_modified: meta.dateModified,
      folder_id: meta.folderId,
      http_status: 200,
      fetched_at: nowIso(),
    });
    for (const pdfUrl of meta.pdfUrls) {
      const { kind, lang } = classifyPdf(pdfUrl);
      if (kind === 'exclude') continue;
      upsertPdf.run({
        url: pdfUrl,
        group_key: meta.groupKey,
        folder_id: folderIdFromPdfUrl(pdfUrl) ?? meta.folderId,
        kind,
        lang,
      });
    }
    fetched++;
    if (fetched % 25 === 0) console.log(`  fetched ${fetched} pages...`);
  }

  rebuildAudits();

  const audits = (db.prepare(`select count(*) c from audits`).get() as { c: number }).c;
  const pdfFull = (db.prepare(`select count(*) c from pdfs where kind='full'`).get() as { c: number }).c;
  const pdfSum = (db.prepare(`select count(*) c from pdfs where kind='summary'`).get() as { c: number }).c;
  console.log(`\nDone. fetched=${fetched} skipped=${skipped}`);
  console.log(`audits=${audits} | pdfs: full=${pdfFull} summary=${pdfSum}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
