// @vitest-environment happy-dom
// ═══════════════════════════════════════════════════════════════
//  GENERATOR — the worker-counts chip must not freeze
// ═══════════════════════════════════════════════════════════════
//  reports/2026-11-05/release-J.md §6.6: the «Audio Workers» chip stayed at
//  the 08:02:11 snapshot for 30 minutes — GET /worker/counts stopped reaching
//  the network while progress-panel kept polling. Pinned here:
//   - counts are requested with `cache: 'no-store'`;
//   - one request on mount;
//   - the chip follows a changed response (0 → 1) without a reload;
//   - the tab becoming visible again → an immediate request (not the next tick);
//   - the counts poll runs as long as the progress-panel poll does, and both
//     stop on unmount.
//  Only the network transport is mocked (same strategy as GeneratePage.commands.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';

const BOOK = 'ba_worker_counts_test';
let audioWorkers = 0;

vi.mock('../api/client', () => ({
  API_BASE: 'http://test',
  getJson: vi.fn(async (url: string) => {
    if (url.startsWith('/worker/counts')) {
      return {
        vbook: 0, active_vbook: 0, audio: 0, image: 0, video: 0,
        active_audio: 0, active_image: 0, active_video: 0, active_scenes: 0,
        available_audio: audioWorkers, available_image: 0, available_video: 0,
        available_active_audio: 0, available_active_image: 0, available_active_video: 0,
      };
    }
    if (url.endsWith('/progress-panel')) return { tasks: [], overall_percent: 0, any_incomplete: false };
    if (url.includes('/assets-state')) return {};
    if (url.startsWith('/book/')) return { book_id: BOOK, chapters: [] };
    return {};
  }),
  putJson: vi.fn(async () => ({})),
  postJson: vi.fn(async () => ({})),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sse: vi.fn(() => new Promise(() => {})),
}));

import * as client from '../api/client';
import { GeneratePage } from './GeneratePage';
import { bookId } from '../state/generateStore';

const getJson = client.getJson as unknown as ReturnType<typeof vi.fn>;

function callsTo(pred: (url: string) => boolean): unknown[][] {
  return getJson.mock.calls.filter((c) => pred(String(c[0])));
}
const countsCalls = () => callsTo((u) => u.startsWith('/worker/counts'));
const panelCalls = () => callsTo((u) => u.endsWith('/progress-panel'));

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Generator worker-counts poll does not freeze', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getJson.mockClear();
    audioWorkers = 0;
    document.documentElement.setAttribute('lang', 'en');
    bookId.value = BOOK;
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mount → exactly one /worker/counts request, with cache: no-store', async () => {
    render(<GeneratePage path="/generate" />);
    await flush(50);
    expect(countsCalls()).toHaveLength(1);
    expect(countsCalls()[0][1]).toEqual({ cache: 'no-store' });
    expect(screen.getByText('Audio Workers: 0')).toBeTruthy();
  });

  it('the chip follows a changed response (0 → 1) without a reload', async () => {
    render(<GeneratePage path="/generate" />);
    await flush(50);
    expect(screen.getByText('Audio Workers: 0')).toBeTruthy();
    audioWorkers = 1; // the node starts beaconing
    await flush(7_000); // ≥ one counts period on the shared panel timer
    expect(screen.getByText('Audio Workers: 1')).toBeTruthy();
    audioWorkers = 0; // and goes offline again
    await flush(7_000);
    expect(screen.getByText('Audio Workers: 0')).toBeTruthy();
    for (const c of countsCalls()) expect(c[1]).toEqual({ cache: 'no-store' });
  });

  it('tab visible again → an immediate request, not the next tick', async () => {
    render(<GeneratePage path="/generate" />);
    await flush(50);
    setVisibility('hidden');
    await flush(10);
    const before = countsCalls().length;
    audioWorkers = 1;
    setVisibility('visible');
    await flush(0); // no timer advance: the request comes from the event itself
    expect(countsCalls().length).toBe(before + 1);
    expect(screen.getByText('Audio Workers: 1')).toBeTruthy();
  });

  it('hidden → no extra request from the event; the poll keeps running with the panel', async () => {
    render(<GeneratePage path="/generate" />);
    await flush(50);
    const before = countsCalls().length;
    setVisibility('hidden');
    await flush(0);
    expect(countsCalls().length).toBe(before);
    // 10 minutes: counts keep pace with the panel poll (≈ every 4th panel tick).
    const p0 = panelCalls().length;
    const c0 = countsCalls().length;
    await flush(600_000);
    const panelTicks = panelCalls().length - p0;
    const countTicks = countsCalls().length - c0;
    expect(panelTicks).toBeGreaterThan(300);
    expect(countTicks).toBeGreaterThanOrEqual(Math.floor(600_000 / 6_000) - 1);
  });

  it('unmount stops both polls and the visibility listener', async () => {
    render(<GeneratePage path="/generate" />);
    await flush(50);
    cleanup();
    await flush(2_000); // let a pending sleep finish
    const c0 = countsCalls().length;
    const p0 = panelCalls().length;
    setVisibility('hidden');
    setVisibility('visible');
    await flush(30_000);
    expect(countsCalls().length).toBe(c0);
    expect(panelCalls().length).toBe(p0);
  });
});
