import { requireEnv } from './env.js';

const URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(`${URL}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res;
    } catch (err) {
      attempt++;
      if (attempt > 6) throw err;
      await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
    }
  }
}

export async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  await rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

export async function countRows(table: string): Promise<number> {
  const res = await rest(`${table}?select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range');
  return cr ? Number(cr.split('/')[1]) : 0;
}
