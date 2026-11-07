// ═══════════════════════════════════════════════════════════════
//  Progress-panel refresh requests (О1, reports/2026-11-07/orch-v2-image-scene-run.md)
// ═══════════════════════════════════════════════════════════════
//  The Generator's progress-panel poll (GeneratePage, 1.5 s) is the
//  authoritative source of the task rows. This module lets other parts of
//  the app ask that loop to poll NOW instead of waiting for the next tick:
//   - an SSE `generation_complete`, or a `progress` event of a v2 command
//     (`command_id` present) — the server state just changed;
//   - the tab becomes visible again / the page is restored from bfcache
//     (the poll may have been frozen by the mobile browser).
//  It carries no data: the panel is always re-read from the server.
// ═══════════════════════════════════════════════════════════════

export type PanelRefreshReason = 'sse' | 'visible' | 'pageshow';
type Listener = (reason: PanelRefreshReason) => void;

const listeners = new Set<Listener>();

/** Ask every mounted progress-panel loop to re-poll immediately. */
export function requestPanelRefresh(reason: PanelRefreshReason): void {
  for (const l of [...listeners]) {
    try { l(reason); } catch { /* a listener must not break the others */ }
  }
}

/** Subscribe a progress-panel loop; returns the unsubscribe function. */
export function onPanelRefreshRequested(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Pure: does this raw progress-stream payload mean «re-poll the panel now»?
 *  `generation_complete` (any scope) and v2 `progress` events (they carry
 *  `command_id`, see backend orchestration-v2 progress-adapter) — yes.
 *  Malformed JSON / other events — no. */
export function sseEventRequestsPanelRefresh(data: string): boolean {
  let ev: unknown;
  try { ev = JSON.parse(data); } catch { return false; }
  if (!ev || typeof ev !== 'object') return false;
  const e = ev as { type?: unknown; command_id?: unknown };
  if (e.type === 'generation_complete') return true;
  if (e.type === 'progress' && typeof e.command_id === 'string' && e.command_id !== '') return true;
  return false;
}

/** Interruptible sleep for polling loops: resolves after `ms`, or earlier when
 *  a refresh is requested (or `signal` aborts). */
export function waitForNextPoll(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const unsubscribe = onPanelRefreshRequested(finish);
    if (signal) {
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    }
  });
}
