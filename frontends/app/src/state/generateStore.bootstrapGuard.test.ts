// @vitest-environment happy-dom
// ═══════════════════════════════════════════════════════════════
//  GENERATE STORE — bootstrap repeated-click guard (2026-11-26)
// ═══════════════════════════════════════════════════════════════
//  ba_1795695606197: two POST /bootstrap → two runs → duplicate «Пролог».
//  The host binds @animastor/web-generator-vbook 0.2.0 isBootstrapInFlight /
//  setBootstrapInFlight to vbookPollState: a second «Генерировать VBook»
//  while the POST is in flight sends nothing; closing the book releases the
//  guard. animastor-docs architecture/BOOTSTRAP_IDEMPOTENCY.md.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  POLL_REQUEST_TIMEOUT_MS: 10_000,
  API_BASE: 'http://test',
  getJson: vi.fn(async () => ({ ready: false, active: false })),
  putJson: vi.fn(async () => ({})),
  postJson: vi.fn(async () => ({})),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sse: vi.fn(),
}));

import * as client from '../api/client';
import { bookId, startVBookGeneration, stopGenerationSession } from './generateStore';

const postJsonLong = client.postJsonLong as unknown as ReturnType<typeof vi.fn>;
const bootstrapPosts = () =>
  postJsonLong.mock.calls.map((c) => String(c[0])).filter((u) => /\/bootstrap(-next-window)?$/.test(u)).length;

describe('generateStore — bootstrap repeated-click guard', () => {
  afterEach(() => { stopGenerationSession(); postJsonLong.mockReset(); });

  it('a second start while POST /bootstrap is in flight sends no second POST', async () => {
    bookId.value = 'ba_guard_book';
    let release!: () => void;
    postJsonLong.mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }));
    void startVBookGeneration();
    await vi.waitFor(() => expect(bootstrapPosts()).toBe(1));
    await startVBookGeneration(); // double click
    expect(bootstrapPosts()).toBe(1);
    release();
  });

  it('closing the book (stopGenerationSession) releases the guard', async () => {
    bookId.value = 'ba_guard_book';
    postJsonLong.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    void startVBookGeneration();
    await vi.waitFor(() => expect(bootstrapPosts()).toBe(1));
    stopGenerationSession();
    postJsonLong.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));
    void startVBookGeneration();
    await vi.waitFor(() => expect(bootstrapPosts()).toBe(2));
  });
});
