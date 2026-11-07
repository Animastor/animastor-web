// О1: progress-panel refresh requests (SSE / visible / pageshow → re-poll now).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestPanelRefresh, onPanelRefreshRequested, sseEventRequestsPanelRefresh, waitForNextPoll } from './panelRefresh';

describe('sseEventRequestsPanelRefresh', () => {
  it('generation_complete → yes', () => {
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'generation_complete', scope: 'scene' }))).toBe(true);
  });
  it('v2 progress with command_id → yes', () => {
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'progress', command_id: 'c-1', ready: 1, total: 1 }))).toBe(true);
  });
  it('progress without command_id, other events, malformed → no', () => {
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'progress' }))).toBe(false);
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'progress', command_id: '' }))).toBe(false);
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'vbook', stage: 'x' }))).toBe(false);
    expect(sseEventRequestsPanelRefresh(JSON.stringify({ type: 'import_complete' }))).toBe(false);
    expect(sseEventRequestsPanelRefresh('not json')).toBe(false);
    expect(sseEventRequestsPanelRefresh('null')).toBe(false);
  });
});

describe('waitForNextPoll', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resolves after the interval when nothing happens', async () => {
    vi.useFakeTimers();
    let done = false;
    void waitForNextPoll(1500).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('resolves at once on requestPanelRefresh (SSE / visible / pageshow)', async () => {
    vi.useFakeTimers();
    for (const reason of ['sse', 'visible', 'pageshow'] as const) {
      let done = false;
      void waitForNextPoll(60_000).then(() => { done = true; });
      requestPanelRefresh(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    }
  });

  it('resolves on abort and unsubscribes', async () => {
    const ac = new AbortController();
    const p = waitForNextPoll(60_000, ac.signal);
    ac.abort();
    await p;
    const seen: string[] = [];
    const off = onPanelRefreshRequested((r) => seen.push(r));
    requestPanelRefresh('sse');
    off();
    requestPanelRefresh('visible');
    expect(seen).toEqual(['sse']);
  });
});
