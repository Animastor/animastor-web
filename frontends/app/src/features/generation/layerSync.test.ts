// ═══════════════════════════════════════════════════════════════
//  layerSync — unit tests (pure, node/happy-dom, no host imports)
// ═══════════════════════════════════════════════════════════════
//  Regression cover for the E2E 02.11 bug: one user action produced
//  several PUT /layer-config in flight at once, and an older body could
//  land last (image=true for 0.36 s after the user switched image off).

import { describe, it, expect, vi } from 'vitest';
import { createLayerConfigSync } from './layerSync';
import type { LayerFlags } from './layerSync';

const ALL_ON: LayerFlags = {
  audio_enabled: true, image_enabled: true,
  video_enabled: true, vbook_enabled: true,
};

const ALL_OFF: LayerFlags = {
  audio_enabled: false, image_enabled: false,
  video_enabled: false, vbook_enabled: false,
};

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Manual scheduler — the tests decide when the coalesced flush runs. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => { queue.push(fn); },
    get queued(): number { return queue.length; },
    async drain(): Promise<void> {
      while (queue.length) {
        queue.shift()!();
        await Promise.resolve();
      }
    },
  };
}

describe('createLayerConfigSync', () => {
  it('collapses setters from one action into a single PUT with the final flags', async () => {
    const sched = manualScheduler();
    const persist = vi.fn(async () => ({}));
    const sync = createLayerConfigSync(ALL_ON, { persist, schedule: sched.schedule });

    sync.request({ audio_enabled: false });
    sync.request({ image_enabled: false });
    sync.request({ video_enabled: false });

    expect(persist).not.toHaveBeenCalled();
    expect(sched.queued).toBe(1); // one flush scheduled, not one per request

    await sched.drain();
    await sync.settled();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      audio_enabled: false, image_enabled: false,
      video_enabled: false, vbook_enabled: true,
    });
    expect(sync.state().pending).toBe(false);
  });

  it('never has two PUTs in flight and sends the newest flags second', async () => {
    const sched = manualScheduler();
    const first = deferred();
    const second = deferred();
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const bodies: LayerFlags[] = [];
    const persist = vi.fn(async (body: LayerFlags) => {
      calls += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      bodies.push(body);
      try {
        await (calls === 1 ? first.promise : second.promise);
      } finally {
        concurrent -= 1;
      }
    });
    const sync = createLayerConfigSync(ALL_ON, { persist, schedule: sched.schedule });

    sync.request({ image_enabled: false });      // click 1
    await sched.drain();
    expect(bodies).toEqual([{ ...ALL_ON, image_enabled: false }]);

    sync.request({ image_enabled: true });       // click 2 while click 1 is on the wire
    await sched.drain();
    expect(persist).toHaveBeenCalledTimes(1);    // serialized: waits for click 1

    first.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await sched.drain();

    expect(persist).toHaveBeenCalledTimes(2);
    // The second PUT carries the user's LATEST state — not click 1's snapshot.
    expect(bodies[1]).toEqual(ALL_ON);
    expect(maxConcurrent).toBe(1);

    second.resolve();
    await sync.settled();
    expect(sync.state().confirmed).toEqual(ALL_ON);
    expect(sync.state().pending).toBe(false);
  });

  it('stays pending from the click until the server confirms the final state', async () => {
    const sched = manualScheduler();
    const gate = deferred();

    const states: boolean[] = [];
    const withSpy = createLayerConfigSync(ALL_ON, {
      persist: () => gate.promise,
      schedule: sched.schedule,
      onChange: (s) => states.push(s.pending),
    });
    withSpy.request({ video_enabled: false });
    expect(withSpy.state().pending).toBe(true);

    await sched.drain();
    expect(withSpy.state().inFlight).toBe(true);

    gate.resolve();
    await withSpy.settled();

    expect(withSpy.state().pending).toBe(false);
    // first emit = optimistic request, last emit = confirmation
    expect(states[0]).toBe(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it('does not PUT when the requested flags already match the confirmed state', async () => {
    const sched = manualScheduler();
    const persist = vi.fn(async () => ({}));
    const sync = createLayerConfigSync(ALL_ON, { persist, schedule: sched.schedule });

    sync.request({ audio_enabled: true });
    await sched.drain();
    await sync.settled();

    expect(persist).not.toHaveBeenCalled();
  });

  it('keeps pending + lastError after a failed PUT and retries only on the next request', async () => {
    const sched = manualScheduler();
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({});
    const sync = createLayerConfigSync(ALL_ON, { persist, schedule: sched.schedule });

    sync.request({ audio_enabled: false });
    await sched.drain();
    expect(sync.state().pending).toBe(true);
    expect(sync.state().lastError).toBe('network');
    expect(sched.queued).toBe(0); // no automatic retry storm

    sync.request({ audio_enabled: false }); // same intent, user retries
    await sched.drain();
    await sync.settled();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(sync.state().lastError).toBeNull();
    expect(sync.state().confirmed?.audio_enabled).toBe(false);
  });

  it('reset() adopts a fresh GET only while idle', async () => {
    const sched = manualScheduler();
    const gate = deferred();
    const sync = createLayerConfigSync(ALL_ON, {
      persist: () => gate.promise,
      schedule: sched.schedule,
    });

    expect(sync.reset(ALL_OFF)).toBe(true);
    expect(sync.state().desired).toEqual(ALL_OFF);
    expect(sync.state().pending).toBe(false);

    sync.request({ audio_enabled: true });
    await sched.drain();
    expect(sync.reset(ALL_ON)).toBe(false); // a PUT is on the wire — don't clobber
    expect(sync.state().desired.audio_enabled).toBe(true);

    gate.resolve();
    await sync.settled();
  });
});
