// О1 (reports/2026-11-07/orch-v2-image-scene-run.md): polling / restore GETs
// must never be answered from the browser HTTP cache. Pure path predicate +
// boundary test on the real getJson()/sse() → fetch() init.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isNoStorePath, defaultGetCache, getJson, sse, POLL_REQUEST_TIMEOUT_MS, ApiError } from './client';

const POLL_PATHS = [
  '/book/ba_1/progress-panel',
  '/book/ba_1/progress-stream',
  '/book/ba_1/assets-state',
  '/book/ba_1/status',
  '/book/ba_1/agent-status',
  '/book/ba_1/layer-config',
  '/book/ba_1/generation-status',
  '/book/ba%201/progress-panel?x=1',
  '/scene/ba_1/ch-1/sc-1/status',
  '/scene/ba_1/ch-1/sc-1/status?build_id=b1',
  '/worker/counts',
  '/generate/commands/abc',
  '/generate',
];
const CACHEABLE_PATHS = [
  '/book/ba_1',
  '/books',
  '/scene/ba_1/ch-1/sc-1/waveform?build_id=b1',
  '/scene/ba_1/ch-1/sc-1/storyboard',
  '/scene/ba_1/ch-1/sc-1/timings',
  '/connectors/x/status-page',
  '/worker/counts-history',
  '/generated/x',
];

describe('isNoStorePath', () => {
  it.each(POLL_PATHS)('no-store: %s', (p) => {
    expect(isNoStorePath(p)).toBe(true);
    expect(defaultGetCache(p)).toBe('no-store');
  });
  it.each(CACHEABLE_PATHS)('browser default: %s', (p) => {
    expect(isNoStorePath(p)).toBe(false);
    expect(defaultGetCache(p)).toBeUndefined();
  });
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('getJson → fetch (boundary)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('polling paths go out with cache: no-store, without any caller option', async () => {
    const fetchMock = vi.fn(async () => okJson({ tasks: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await getJson('/book/ba_1/progress-panel');
    await getJson('/worker/counts');
    await getJson('/book/ba_1/assets-state');
    await getJson('/scene/b/ch/sc/status');
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].cache).toBe('no-store');
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('other GETs keep the browser default (no cache key in init)', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    await getJson('/book/ba_1');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect('cache' in init).toBe(false);
  });

  it('an explicit cache option wins', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    await getJson('/book/ba_1', { cache: 'no-store' });
    await getJson('/worker/counts', { cache: 'no-cache' });
    const inits = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map((c) => c[1].cache);
    expect(inits).toEqual(['no-store', 'no-cache']);
  });

  it('progress-stream SSE is opened with cache: no-store', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const it = sse('/book/ba_1/progress-stream');
    await it.next();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].cache).toBe('no-store');
  });

  it('a hung poll request is aborted after POLL_REQUEST_TIMEOUT_MS (408)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const p = getJson('/book/ba_1/progress-panel', { timeoutMs: POLL_REQUEST_TIMEOUT_MS });
    const assertion = expect(p).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(POLL_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(POLL_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(ApiError).toBeDefined();
  });
});
