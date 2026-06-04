import * as cheerio from 'cheerio';

export type Lang = 'fr' | 'de' | 'en' | 'it';

export function langFromUrl(url: string): Lang | null {
  const p = new URL(url).pathname;
  if (p.startsWith('/fr/audit/')) return 'fr';
  if (p.startsWith('/en/audit/')) return 'en';
  if (p.startsWith('/it/verifica/')) return 'it';
  if (p.startsWith('/prufung/')) return 'de';
  return null;
}

export function isAuditDetail(url: string): boolean {
  const lang = langFromUrl(url);
  if (!lang) return false;
  const p = new URL(url).pathname.replace(/\/$/, '');
  const segments = p.split('/').filter(Boolean);
  return lang === 'de' ? segments.length >= 2 : segments.length >= 3;
}

const LETTER_LANG: Record<string, Lang> = { d: 'de', f: 'fr', e: 'en', i: 'it' };

const EXCLUDE_RE = /(darstellung[-_]aktueller|stand[-_]der[-_]dinge|^flyer|[-_]flyer|prise[-_]de[-_]position|stellungnahme|[-_]pm[-_]|pressemitteilung|communique)/i;
const SUMMARY_RE = /(wik|[-_]zf[-_.]|\dzf[-_.])/i;
const FULL_RE = /(\d[-_]?be[-_.0-9]|endgueltige[-_]fassung|endgultige[-_]fassung|version[-_]definitive)/i;

export function pdfLangFromName(fname: string): Lang | null {
  const m = fname.match(/wik[-_]([dfei])[-_]/i) || fname.match(/[-_]([dfei])\.pdf$/i);
  return m ? LETTER_LANG[m[1]!.toLowerCase()] ?? null : null;
}

export function pdfLangFromUrl(url: string): Lang | null {
  const fname = (url.split('/').pop() || '').toLowerCase();
  const fromName = pdfLangFromName(fname);
  if (fromName) return fromName;
  const dir = url.match(/\/\d{3,6}\/([dfei])\//i);
  return dir ? LETTER_LANG[dir[1]!.toLowerCase()] ?? null : null;
}

export function classifyPdf(url: string): { kind: 'full' | 'summary' | 'exclude'; lang: Lang | null } {
  const fname = (url.split('/').pop() || '').toLowerCase();
  const lang = pdfLangFromUrl(url);
  if (EXCLUDE_RE.test(fname)) return { kind: 'exclude', lang };
  if (SUMMARY_RE.test(fname)) return { kind: 'summary', lang };
  if (FULL_RE.test(fname)) return { kind: 'full', lang };
  return { kind: 'exclude', lang };
}

export function idPrefixFromPdfUrl(url: string): string | null {
  const fname = url.split('/').pop() || '';
  const m = fname.match(/^(\d{3,6})/);
  return m ? m[1]! : null;
}

export function folderIdFromPdfUrl(url: string): number | null {
  const m = url.match(/\/uploads\/.*?\/(\d+)\/[^/]+\.pdf$/i);
  return m ? Number(m[1]) : null;
}

export interface DetailMeta {
  lang: Lang | null;
  title: string | null;
  description: string | null;
  datePublished: string | null;
  dateModified: string | null;
  alternates: Partial<Record<Lang | 'x-default', string>>;
  groupKey: string;
  pdfUrls: string[];
  folderId: number | null;
}

export function parseDetail(url: string, html: string): DetailMeta {
  const $ = cheerio.load(html);

  const alternates: Partial<Record<Lang | 'x-default', string>> = {};
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hl = ($(el).attr('hreflang') || '').toLowerCase();
    const href = $(el).attr('href');
    if (!href) return;
    if (hl === 'de' || hl === 'fr' || hl === 'en' || hl === 'it' || hl === 'x-default') {
      alternates[hl as Lang | 'x-default'] = href;
    }
  });

  let datePublished: string | null = null;
  let dateModified: string | null = null;
  let headline: string | null = null;
  let description: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data['@graph']) ? data['@graph'] : [data];
      for (const node of nodes) {
        if (node && typeof node === 'object') {
          if (!datePublished && typeof node.datePublished === 'string') datePublished = node.datePublished;
          if (!dateModified && typeof node.dateModified === 'string') dateModified = node.dateModified;
          if (!headline && typeof node.headline === 'string') headline = node.headline;
          if (!description && node['@type'] === 'WebPage' && typeof node.description === 'string') {
            description = node.description;
          }
        }
      }
    } catch {
      /* ignore malformed ld+json */
    }
  });

  const title = ($('h1.audit__title').first().text().trim() || headline || '').trim() || null;

  const pdfUrls = new Set<string>();
  $('a[href$=".pdf"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.toLowerCase().endsWith('.pdf')) pdfUrls.add(new URL(href, url).toString());
  });

  const pdfList = [...pdfUrls];
  const folderId = pdfList.map(folderIdFromPdfUrl).find((v) => v != null) ?? null;
  const groupKey = alternates['x-default'] || alternates.de || url;

  return {
    lang: langFromUrl(url),
    title,
    description,
    datePublished,
    dateModified,
    alternates,
    groupKey,
    pdfUrls: pdfList,
    folderId,
  };
}
