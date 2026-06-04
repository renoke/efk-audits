import { MIN_REQUEST_INTERVAL_MS, MAX_RETRIES, USER_AGENT } from './config.js';

let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - now);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) throw err;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      console.warn(`  retry ${attempt}/${MAX_RETRIES} (${label}): ${(err as Error).message} — waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

async function request(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    redirect: 'follow',
  });
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(throttle).then(task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function fetchText(url: string): Promise<{ status: number; body: string }> {
  return serialize(() =>
    withRetry(async () => {
      const res = await request(url);
      const body = res.ok ? await res.text() : '';
      return { status: res.status, body };
    }, url),
  );
}

export function fetchBuffer(url: string): Promise<{ status: number; body: Buffer }> {
  return serialize(() =>
    withRetry(async () => {
      const res = await request(url);
      const body = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
      return { status: res.status, body };
    }, url),
  );
}
