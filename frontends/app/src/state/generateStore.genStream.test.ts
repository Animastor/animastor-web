// Generate API v2: GET /generate/stream — the store keeps the §9 aggregate of
// every event (connect and notify) and asks the panel loop to re-poll at once.
// The VBook /progress-stream stays open next to it (задача H).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Frame = { data: string };
const streams: { path: string; push: (f: Frame) => void; end: () => void }[] = [];

vi.mock('../api/client', () => ({
  setLoginRequiredHandler: vi.fn(),
  POLL_REQUEST_TIMEOUT_MS: 10_000,
  API_BASE: 'http://test',
  getJson: vi.fn(async () => ({})),
  putJson: vi.fn(async () => ({})),
  postJson: vi.fn(async () => ({})),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  // a controllable SSE: frames are pushed by the test
  sse: vi.fn((path: string, signal?: AbortSignal) => {
    const queue: Frame[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    streams.push({
      path,
      push: (f) => { queue.push(f); wake?.(); },
      end: () => { ended = true; wake?.(); },
    });
    signal?.addEventListener('abort', () => { ended = true; wake?.(); });
    return (async function* gen() {
      while (true) {
        if (queue.length) { yield queue.shift() as Frame; continue; }
        if (ended) return;
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    })();
  }),
}));

import { genProgress, startProgressStream, stopProgressStream } from './generateStore';
import { onPanelRefreshRequested } from './panelRefresh';

const tick = () => new Promise((r) => setTimeout(r, 0));
const event = (reason: string, active: boolean) => ({
  data: JSON.stringify({ type: 'gen_progress', reason, command_ids: [], progress: { book_id: 'b1', active, totals: {}, commands: [] } }),
});

describe('generate stream (GET /generate/stream)', () => {
  afterEach(() => { stopProgressStream(); streams.length = 0; });

  it('opens /generate/stream next to the VBook /progress-stream; each event → genProgress + panel re-poll', async () => {
    const refreshes: string[] = [];
    const off = onPanelRefreshRequested((r) => refreshes.push(r));
    try {
      startProgressStream('b1');
      await tick();
      const paths = streams.map((s) => s.path).sort();
      expect(paths).toEqual(['/book/b1/generate/stream', '/book/b1/progress-stream']);
      const gen = streams.find((s) => s.path.endsWith('/generate/stream'))!;
      gen.push(event('connect', true));
      await tick();
      expect(genProgress.value?.active).toBe(true);
      expect(refreshes).toContain('sse');
      gen.push({ data: '{"type":"progress","layer":"audio"}' });     // not a gen_progress event — ignored
      gen.push(event('notify', false));
      await tick();
      expect(genProgress.value?.active).toBe(false);
    } finally { off(); }
  });

  it('reconnects after the stream ends; the first event after reconnect is applied', async () => {
    vi.useFakeTimers();
    try {
      startProgressStream('b1');
      await vi.advanceTimersByTimeAsync(0);
      streams.find((s) => s.path.endsWith('/generate/stream'))!.end();
      await vi.advanceTimersByTimeAsync(1_100);
      const gens = streams.filter((s) => s.path.endsWith('/generate/stream'));
      expect(gens).toHaveLength(2);
      gens[1].push(event('connect', true));
      await vi.advanceTimersByTimeAsync(0);
      expect(genProgress.value?.active).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('stopProgressStream closes it and clears the aggregate', async () => {
    startProgressStream('b1');
    await tick();
    streams.find((s) => s.path.endsWith('/generate/stream'))!.push(event('connect', true));
    await tick();
    stopProgressStream();
    expect(genProgress.value).toBeNull();
  });
});
