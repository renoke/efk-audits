import { fetchText } from './http.js';
import { AUDIT_SITEMAPS } from './config.js';
import { isAuditDetail, langFromUrl } from './parse.js';
import type { Lang } from './parse.js';

export interface AuditGroup {
  groupKey: string;
  lastmod: string;
  urls: string[];
}

function alternatesOf(block: string): Partial<Record<Lang | 'x-default', string>> {
  const out: Partial<Record<Lang | 'x-default', string>> = {};
  for (const m of block.matchAll(/<xhtml:link[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"/g)) {
    const hl = m[1]!.toLowerCase();
    if (hl === 'de' || hl === 'fr' || hl === 'en' || hl === 'it' || hl === 'x-default') {
      out[hl as Lang | 'x-default'] = m[2]!;
    }
  }
  return out;
}

export async function collectAuditGroups(): Promise<AuditGroup[]> {
  const groups = new Map<string, AuditGroup>();

  for (const sm of AUDIT_SITEMAPS) {
    const { status, body } = await fetchText(sm);
    if (status !== 200) {
      console.warn(`sitemap ${sm} -> HTTP ${status}, skipping`);
      continue;
    }
    for (const m of body.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const block = m[1]!;
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
      if (!loc || !isAuditDetail(loc)) continue;
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim() ?? '';
      const alts = alternatesOf(block);
      const urls = new Set<string>([loc]);
      for (const v of Object.values(alts)) if (v) urls.add(v);

      const groupKey = alts['x-default'] || alts.de || loc;
      const existing = groups.get(groupKey);
      if (existing) {
        for (const u of urls) existing.urls.push(u);
        existing.urls = [...new Set(existing.urls)];
        if (lastmod > existing.lastmod) existing.lastmod = lastmod;
      } else {
        groups.set(groupKey, { groupKey, lastmod, urls: [...urls].filter(isAuditDetail) });
      }
    }
  }

  return [...groups.values()].sort((a, b) => (a.lastmod < b.lastmod ? 1 : a.lastmod > b.lastmod ? -1 : 0));
}

export { langFromUrl };
