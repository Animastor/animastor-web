// ═══════════════════════════════════════════════════════════════
//  LAYER-CONFIG SYNC — one PUT per user action, serialized
// ═══════════════════════════════════════════════════════════════
//  E2E 02.11 (12:24:00.311, 12:39:24.724): a single layer-toggle click
//  produced 2–3 PUT /book/:id/layer-config, including a STALE snapshot
//  (image=true for 0.36 s) — the requests overlapped and the older body
//  landed last, so the backend briefly ran with a layer the user had
//  already switched off.
//
//  This module owns the write side of the layer-config contour:
//
//   - requests are coalesced: several setters called in one user action
//     (e.g. "all layers") collapse into ONE PUT with the final flags;
//   - PUTs are serialized: at most one request in flight, so responses can
//     never arrive out of order and install an outdated snapshot;
//   - every PUT carries the CURRENT desired flags (never a snapshot taken
//     before an in-flight request), and a change made while a PUT is in
//     flight is sent once that PUT settles;
//   - `pending` is true from the click until the server confirmed the final
//     state — the UI disables the layer buttons for exactly that window;
//   - a failed PUT keeps `pending` true and stores `lastError`; the next
//     request retries (no automatic retry storm).
//
//  Pure logic: no signals, no transport, no host imports — the store
//  supplies `persist` and mirrors `onChange` into signals.
//  Android parity: ui/LayerConfigSync.kt + LayerConfigSyncTest.

export interface LayerFlags {
  audio_enabled: boolean;
  image_enabled: boolean;
  video_enabled: boolean;
  vbook_enabled: boolean;
}

export interface LayerSyncState {
  /** What the user wants (last requested flags). */
  desired: LayerFlags;
  /** Last flags the server acknowledged (null until the first success). */
  confirmed: LayerFlags | null;
  /** A PUT is on the wire right now. */
  inFlight: boolean;
  /** Desired differs from confirmed, or a PUT is running. */
  pending: boolean;
  lastError: string | null;
}

export interface LayerSyncOptions {
  /** PUT the whole flag set for the current book. */
  persist: (config: LayerFlags) => Promise<unknown>;
  /** Called on every state transition (host mirrors it into signals). */
  onChange?: (state: LayerSyncState) => void;
  /** Flush scheduler; defaults to a microtask (sync setters coalesce). */
  schedule?: (flush: () => void) => void;
}

export interface LayerConfigSync {
  state(): LayerSyncState;
  /** Merge a patch into the desired flags and schedule one coalesced PUT. */
  request(patch: Partial<LayerFlags>): void;
  /** Resolves once nothing is pending (or the last PUT failed). */
  settled(): Promise<void>;
  /** Replace both sides after a fresh GET. No-op while a PUT is in flight. */
  reset(flags: LayerFlags): boolean;
}

function sameFlags(a: LayerFlags, b: LayerFlags): boolean {
  return a.audio_enabled === b.audio_enabled
    && a.image_enabled === b.image_enabled
    && a.video_enabled === b.video_enabled
    && a.vbook_enabled === b.vbook_enabled;
}

export function createLayerConfigSync(
  initial: LayerFlags,
  options: LayerSyncOptions,
): LayerConfigSync {
  let desired: LayerFlags = { ...initial };
  let confirmed: LayerFlags | null = { ...initial };
  let inFlight = false;
  let lastError: string | null = null;
  let scheduled = false;
  let waiters: Array<() => void> = [];

  const schedule = options.schedule ?? ((flush: () => void) => { queueMicrotask(flush); });

  const isPending = (): boolean =>
    inFlight || confirmed === null || !sameFlags(desired, confirmed);

  function snapshot(): LayerSyncState {
    return {
      desired: { ...desired },
      confirmed: confirmed ? { ...confirmed } : null,
      inFlight,
      pending: isPending(),
      lastError,
    };
  }

  function emit(): void {
    options.onChange?.(snapshot());
  }

  function settleWaiters(): void {
    if (isPending()) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  }

  function scheduleFlush(): void {
    if (scheduled) return;
    scheduled = true;
    schedule(() => { void flush(); });
  }

  async function flush(): Promise<void> {
    scheduled = false;
    // A running flush re-reads `desired` before every PUT, so a change made
    // now is picked up there — starting a second loop would only duplicate.
    if (inFlight) return;

    inFlight = true;
    emit();
    try {
      // Serialized loop: one PUT at a time, always the latest desired flags.
      for (;;) {
        if (confirmed !== null && sameFlags(desired, confirmed)) break;
        const target: LayerFlags = { ...desired };
        try {
          await options.persist(target);
        } catch (e) {
          lastError = (e as Error)?.message || String(e);
          break;
        }
        confirmed = target;
        lastError = null;
      }
    } finally {
      inFlight = false;
      emit();
      // Only a successful pass may immediately send a follow-up; after an
      // error the next user request (not a timer) is the retry trigger.
      if (lastError === null && isPending()) scheduleFlush();
      settleWaiters();
    }
  }

  function request(patch: Partial<LayerFlags>): void {
    desired = { ...desired, ...patch };
    emit();
    if (!isPending()) return;
    scheduleFlush();
  }

  function reset(flags: LayerFlags): boolean {
    if (inFlight) return false;
    desired = { ...flags };
    confirmed = { ...flags };
    lastError = null;
    emit();
    settleWaiters();
    return true;
  }

  function settled(): Promise<void> {
    if (!isPending()) return Promise.resolve();
    return new Promise<void>((resolve) => { waiters.push(resolve); });
  }

  return { state: snapshot, request, settled, reset };
}
