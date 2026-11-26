// ═══════════════════════════════════════════════════════════════
//  Bootstrap idempotency — client side (2026-11-26)
// ═══════════════════════════════════════════════════════════════
//  ba_1795695606197: two POST /bootstrap → two runs → two «Пролог»
//  chapters. The client sends the POST once (no retry), ignores a repeated
//  start while it is in flight, and follows the progress on the server's
//  409 bootstrap_in_progress instead of failing.
//  animastor-docs architecture/BOOTSTRAP_IDEMPOTENCY.md

import { describe, it, expect, vi } from 'vitest';
import {
  createVBookPollState,
  isBootstrapInProgressError,
  startVBookGeneration,
} from '../src/index';
import type { VBookAgentPorts } from '../src/index';
import { createIdleVBookProgress } from '@animastor/web-generator';
import type { VBookProgress } from '@animastor/web-generator';

const FAST = { pollIntervalMs: 1, errorIntervalMs: 1, maxInactive: 2, maxPollMs: 1_000 };

function harness(opts: { guard?: boolean } = {}) {
  const pollState = createVBookPollState();
  let progress: VBookProgress = createIdleVBookProgress();
  const rec = { clears: 0, finalized: 0, status: [] as string[] };
  const transport = {
    getJson: vi.fn(async (path: string): Promise<unknown> => {
      if (path.endsWith('/status')) return { ready: false };
      return { active: false };
    }),
    postJsonLong: vi.fn(async (): Promise<unknown> => ({})),
  };
  const guard = opts.guard !== false;
  const ports: VBookAgentPorts = {
    identity: { getBookId: () => 'ba_1795695606197' },
    transport: transport as unknown as VBookAgentPorts['transport'],
    poll: {
      getPollToken: () => pollState.token,
      bumpPollToken: () => ++pollState.token,
      ...(guard ? {
        isBootstrapInFlight: () => !!pollState.bootstrapInFlight,
        setBootstrapInFlight: (v: boolean) => { pollState.bootstrapInFlight = v; },
      } : {}),
    },
    state: {
      getVBookProgress: () => progress,
      setVBookProgress: (p) => { progress = p; },
      setGenerationStatus: (s) => { rec.status.push(s); },
      getIsRegenerating: () => false,
      setIsRegenerating: () => {},
      setNewGenerationPending: () => {},
      setImportCompleteReceived: () => {},
      getImportCompleteReceived: () => false,
    },
    lifecycle: {
      startTimer: () => {},
      stopTimer: () => {},
      startStream: () => {},
      onVBookCleared: () => { rec.clears++; },
      onGenerationFinalized: () => { rec.finalized++; },
    },
  };
  const bootstrapPosts = () => transport.postJsonLong.mock.calls.filter((c) => String(c[0]).endsWith('/bootstrap')).length;
  return { ports, transport, pollState, rec, bootstrapPosts };
}

class FakeApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: unknown) { super(message); }
}

describe('bootstrap idempotency — client', () => {
  it('a network failure of POST /bootstrap is NOT retried (one POST)', async () => {
    const h = harness();
    h.transport.postJsonLong.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await startVBookGeneration(h.ports, FAST);
    expect(h.bootstrapPosts()).toBe(1);
    // reconciled with /agent-status (inactive) → torn down, not re-posted
    expect(h.rec.clears).toBe(1);
    expect(h.pollState.bootstrapInFlight).toBe(false);
  });

  it('a timeout (408) of POST /bootstrap is NOT retried', async () => {
    const h = harness();
    h.transport.postJsonLong.mockRejectedValueOnce(new FakeApiError('Request timeout', 408));
    await startVBookGeneration(h.ports, FAST);
    expect(h.bootstrapPosts()).toBe(1);
  });

  it('repeated start while the POST is in flight → ignored, one POST', async () => {
    const h = harness();
    let release!: () => void;
    h.transport.postJsonLong.mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }));
    const first = startVBookGeneration(h.ports, FAST);
    await vi.waitFor(() => expect(h.transport.postJsonLong).toHaveBeenCalledTimes(1));
    expect(h.pollState.bootstrapInFlight).toBe(true);
    await startVBookGeneration(h.ports, FAST); // double click
    await startVBookGeneration(h.ports, FAST); // and once more
    expect(h.bootstrapPosts()).toBe(1);
    release();
    await first;
    expect(h.pollState.bootstrapInFlight).toBe(false);
    expect(h.rec.finalized).toBe(1);
  });

  it('after the POST finished a new start is allowed again (next click = next window)', async () => {
    const h = harness();
    await startVBookGeneration(h.ports, FAST);
    await startVBookGeneration(h.ports, FAST);
    expect(h.transport.postJsonLong).toHaveBeenCalledTimes(2);
  });

  it('409 bootstrap_in_progress → follows the running window (poll), not an error', async () => {
    const h = harness();
    h.transport.postJsonLong.mockRejectedValueOnce(
      new FakeApiError('Книга уже обрабатывается', 409, 'bootstrap_in_progress',
        { error: 'bootstrap_in_progress', session_id: 'sess-A' }),
    );
    let agentPolls = 0;
    h.transport.getJson.mockImplementation(async (path: string) => {
      if (path.endsWith('/status')) return { ready: false };
      agentPolls++;
      return agentPolls <= 2
        ? { active: true, session_status: 'running', progress_msg: 'Окно 1' }
        : { active: false };
    });
    await startVBookGeneration(h.ports, FAST);
    expect(h.bootstrapPosts()).toBe(1);
    expect(agentPolls).toBeGreaterThanOrEqual(3); // tracked the other run to its end
    expect(h.rec.clears).toBe(0);                 // no teardown
    expect(h.rec.finalized).toBe(1);
    expect(h.rec.status).toContain('SUCCESS');
    expect(h.rec.status).not.toContain('ERROR');
  });

  it('host without the in-flight binding (0.1.x contract) still works', async () => {
    const h = harness({ guard: false });
    await startVBookGeneration(h.ports, FAST);
    expect(h.transport.postJsonLong).toHaveBeenCalledTimes(1);
    expect(h.rec.finalized).toBe(1);
  });

  it('isBootstrapInProgressError reads code / body.error / message, only on 409', () => {
    expect(isBootstrapInProgressError(new FakeApiError('x', 409, 'bootstrap_in_progress'))).toBe(true);
    expect(isBootstrapInProgressError(new FakeApiError('x', 409, undefined, { error: 'bootstrap_in_progress' }))).toBe(true);
    expect(isBootstrapInProgressError(new FakeApiError('bootstrap_in_progress', 409))).toBe(true);
    expect(isBootstrapInProgressError(new FakeApiError('x', 400, 'bootstrap_in_progress'))).toBe(false);
    expect(isBootstrapInProgressError(new FakeApiError('layer_disabled', 409, 'layer_disabled'))).toBe(false);
    expect(isBootstrapInProgressError(null)).toBe(false);
  });
});
