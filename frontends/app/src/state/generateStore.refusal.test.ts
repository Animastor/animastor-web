// @vitest-environment happy-dom
// ═══════════════════════════════════════════════════════════════
//  GENERATE STORE — a refused start leaves no timer / progress stream
// ═══════════════════════════════════════════════════════════════
//  startGeneration arms the timer and opens the progress stream BEFORE
//  POST /regenerate. When the server refuses the command up front — 409
//  layer_disabled, 422 book_has_no_text, 409 voice_reference_required — no
//  task exists, so the timer must not tick and the stream must be closed
//  (stage171; before, both kept running after the refusal toast).
//  A generation that was already running keeps its timer and stream.
//  Fake timers; real store module; the transport (api/client) is mocked and
//  the progress stream's AbortSignal is captured.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signals: AbortSignal[] = [];

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number; code?: string; body?: unknown;
    constructor(message: string, status: number, code?: string, body?: unknown) {
      super(message); this.status = status; this.code = code; this.body = body; this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    POLL_REQUEST_TIMEOUT_MS: 10_000,
    API_BASE: 'http://test',
    getJson: vi.fn(async () => ({})),
    putJson: vi.fn(async () => ({})),
    postJson: vi.fn(async () => ({})),
    postJsonLong: vi.fn(async () => ({})),
    deleteJson: vi.fn(async () => ({})),
    getBlob: vi.fn(async () => new Blob([])),
    retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    // The progress stream: stays open until its signal aborts.
    sse: vi.fn((_path: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return (async function* () {
        await new Promise<void>((resolve) => {
          if (!signal || signal.aborted) return resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })();
    }),
  };
});

type Store = typeof import('./generateStore');
type Client = typeof import('../api/client');
let store: Store;
let client: Client;

const REQ = { workerTypes: ['audio'], scope: 'whole_book', chapterId: null, sceneId: null } as const;

const REFUSALS = [
  { name: '409 layer_disabled', status: 409, body: { error: 'layer_disabled', message: 'off', disabled_worker_types: ['audio'] }, code: 'layer_disabled' },
  { name: '422 book_has_no_text', status: 422, body: { error: 'book_has_no_text', code: 'book_has_no_text', message: 'no text' }, code: 'book_has_no_text' },
  { name: '409 voice_reference_required', status: 409, body: { error: 'voice_reference_required', code: 'voice_reference_required', character_ids: ['hero'] }, code: 'voice_reference_required' },
];

function refuseWith(r: (typeof REFUSALS)[number]): void {
  vi.mocked(client.postJson).mockImplementationOnce(async () => {
    throw new client.ApiError(`HTTP ${r.status}`, r.status, r.body.code ?? r.body.error, r.body);
  });
}

/** Lets the stream generator reach its first await (sse() is called lazily). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function click() {
  return store.userAction('generator.scope_dialog', { isTrusted: true });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
  vi.resetModules();
  signals.length = 0;
  client = await import('../api/client');
  store = await import('./generateStore');
  store.bookId.value = 'test-book';
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('startGeneration — a refused start stops the timer and the progress stream', () => {
  for (const r of REFUSALS) {
    it(`${r.name}: no timer ticks, the stream is closed, the session is idle`, async () => {
      refuseWith(r);
      const res = await store.startGeneration({ ...REQ, workerTypes: [...REQ.workerTypes] }, click());
      await flush();
      expect(res.ok).toBe(false);
      expect(res.ok ? null : res.code).toBe(r.code);

      expect(store.getTimerStartedAt()).toBeLessThanOrEqual(0);
      vi.advanceTimersByTime(7_000);
      expect(store.liveElapsedSeconds()).toBe(0); // the previous (none) final time, not a ticking one
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((s) => s.aborted)).toBe(true);
      expect(store.isRegenerating.value).toBe(false);
      expect(store.generationStatus.value).toBe('IDLE');
    });
  }

  it('a running generation keeps its timer and stream when a second start is refused', async () => {
    vi.mocked(client.postJson).mockImplementationOnce(async () => ({ build_id: 'b1', summary: null, dirty_scenes: [] }) as never);
    const ok = await store.startGeneration({ ...REQ, workerTypes: [...REQ.workerTypes] }, click());
    await flush();
    expect(ok.ok).toBe(true);
    const startedAt = store.getTimerStartedAt();
    expect(startedAt).toBeGreaterThan(0);

    refuseWith(REFUSALS[1]);
    vi.advanceTimersByTime(3_000);
    await store.startGeneration({ ...REQ, workerTypes: [...REQ.workerTypes] }, click());
    await flush();
    expect(store.getTimerStartedAt()).toBe(startedAt);
    vi.advanceTimersByTime(2_000);
    expect(store.liveElapsedSeconds()).toBe(5);
    expect(signals[signals.length - 1].aborted).toBe(false); // the live stream stays open
  });

  it('a transport error is not treated as a refusal (the server may have started the command)', async () => {
    vi.mocked(client.postJson).mockImplementationOnce(async () => { throw new Error('network down'); });
    const res = await store.startGeneration({ ...REQ, workerTypes: [...REQ.workerTypes] }, click());
    await flush();
    expect(res.ok).toBe(false);
    expect(store.generationStatus.value).toBe('ERROR');
    expect(store.getTimerStartedAt()).toBeGreaterThan(0);
  });
});
