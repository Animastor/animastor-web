// @vitest-environment happy-dom
// ═══════════════════════════════════════════════════════════════
//  GENERATOR — commands are sent ONLY by explicit clicks
// ═══════════════════════════════════════════════════════════════
//  reports/2026-11-04/regenerate-sweep-fix.md: on 2026-11-04 13:49:28Z a
//  POST /regenerate (audio, scope current_scene) reached the backend from
//  app.animastor.org/generate that the owner did not intend. The web code has
//  exactly two senders (ScopeDialog «Start», row «Retry»), both click
//  handlers. These tests pin it:
//   - mount + polls + restore + position/book changes + a stopped row on
//     screen → ZERO POST /regenerate;
//   - opening the dialog and cancelling (button / backdrop / Escape) → zero;
//   - a tap within SCOPE_DIALOG_ARM_MS of the dialog opening → zero;
//   - «Generate Audio» → current_scene sends exactly ONE command: audio +
//     current_scene + the player's chapter/scene + client_action;
//   - «Generate Images» → current_chapter sends image + current_chapter +
//     chapter only;
//   - startGeneration without a UserAction (timer/effect) is refused.
//  Only the network transport is mocked (same strategy as fileStore.test.ts).
//
//  2026-11-27 — generate API v2 (ADR ORCHESTRATION_V2 §11.1–11.2): the command
//  is POST /generate {scope, layers, mode, client_action_id}, the stops are
//  POST /generate/stop ({command_id} / {layer} / {}), the panel polls
//  GET /generate/progress (the §9 aggregate). The dialog of a layer has two
//  buttons: «Generate missing» (mode missing) and «Regenerate» (mode all,
//  confirmed for a scope wider than one scene). v2 has no blocked /
//  interrupted rows — the stopped-row cases run on a failed command.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

const CH = 'ch-5e5a8c76';
const SC = 'sc-4bb85e02';
const BOOK = 'ba_1788172242081';

let panelTasks: unknown[] = [];

// The panel fixtures are written as rows; the mock serves them as the
// GET /generate/progress aggregate (one command per row).
const LEVEL: Record<string, string> = { whole_book: 'book', current_chapter: 'chapter', current_scene: 'scene', from_current_scene: 'scenes' };
function aggregateOf(rows: unknown[]): unknown {
  const commands = rows.map((r0) => {
    const r = r0 as Record<string, unknown>;
    const st = String(r.status ?? r.state ?? 'active');
    const status = r.failed || st === 'failed' ? 'failed' : st === 'cancelled' || r.cancelled ? 'cancelled'
      : st === 'completed' || r.done ? 'done' : 'active';
    const level = LEVEL[String(r.scope)] ?? 'book';
    const scope = level === 'scenes' ? { level, scene_ids: [r.scene_id] }
      : level === 'chapter' ? { level, chapter_id: r.chapter_id } : level === 'scene' ? { level, chapter_id: r.chapter_id, scene_id: r.scene_id } : { level };
    const ready = Number(r.ready ?? 0); const total = Number(r.total ?? 0);
    return {
      command_id: r.task_id, kind: 'regenerate', status, mode: 'missing', scope, layers: [r.type],
      created_at: new Date(0).toISOString(), finished_at: null, error: (r.error_message as string) ?? null,
      summary: { jobs_created: total, joined: 0, skipped_ready: 0 }, skipped: {},
      labels: { chapter_label: r.chapter_label ?? null, scene_label: r.scene_label ?? null },
      totals: {}, scenes: Array.from({ length: Number(r.target_count ?? 0) }, (_, i) => ({ chapter_id: r.chapter_id ?? CH, scene_id: `s${i}`, layer: r.type })),
      by_layer: { [String(r.type)]: { queued: total - ready, running: 0, done: ready, failed: 0, cancelled: 0, retrying: 0, joined_queued: 0, joined_running: 0, ready, total, percent: Number(r.percent ?? 0), scenes: Number(r.target_count ?? 0) } },
    };
  });
  return { book_id: BOOK, orchestration: 'v2', active: commands.some((c) => c.status === 'active'), totals: {}, commands };
}

vi.mock('../api/client', () => ({
  // authStore (via the reasoning notice) registers the 401 handler at import
  setLoginRequiredHandler: vi.fn(),
  POLL_REQUEST_TIMEOUT_MS: 10_000,
  API_BASE: 'http://test',
  getJson: vi.fn(async (url: string) => {
    if (url.startsWith('/worker/counts')) {
      return { vbook: 0, active_vbook: 0, audio: 1, image: 1, video: 0, active_audio: 0, active_image: 0, active_video: 0 };
    }
    if (url.endsWith('/generate/progress')) return aggregateOf(panelTasks);
    if (url.includes('/assets-state')) return {};
    if (url.startsWith('/book/')) {
      return {
        book_id: BOOK,
        chapters: [{ chapter_id: CH, chapter_title: 'Пролог', display_number: 1, scenes: [
          { scene_id: SC, scene_title: 'Алгоритмы и конфликты', display_index: 4, units: [{}] },
          { scene_id: 'sc-7cd391e4', scene_title: 'B', display_index: 2, units: [{}] },
        ] }],
      };
    }
    return {};
  }),
  putJson: vi.fn(async () => ({})),
  postJson: vi.fn(async (url: string, body?: { task_id?: string | null; command_id?: string; layer?: string }) => (url.endsWith('/generate')
    ? { book_id: BOOK, command_id: 'cmd-1', existing: false, status: 'active', mode: 'missing', summary: { jobs_created: 1, joined: 0, skipped_ready: 0 } }
    : url.endsWith('/generate/stop')
      ? { ok: true, book_id: BOOK, target: body?.command_id ? 'command' : body?.layer ? 'layer' : 'book', ...(body?.command_id ? { command_id: body.command_id } : {}), ...(body?.layer ? { layer: body.layer } : {}) }
      : url.endsWith('/cancel-worker')
        ? { ok: true, book_id: BOOK, task_ids: body?.task_id ? [body.task_id] : [] }
        : {})),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sse: vi.fn(() => new Promise(() => {})),
}));

import * as client from '../api/client';
import { GeneratePage, SCOPE_DIALOG_ARM_MS, STOPPED_ROW_ARM_MS } from './GeneratePage';
import { bookId, startGeneration, emitPlaybackPrepared, dismissedTaskIds } from '../state/generateStore';
import { navigateTo } from '../state/positionStore';

const postJson = client.postJson as unknown as ReturnType<typeof vi.fn>;

/** POST /generate (the command) — and no legacy /regenerate at all. */
function regenerateCalls(): { url: string; body: Record<string, unknown> }[] {
  expect(postJson.mock.calls.filter((c) => String(c[0]).endsWith('/regenerate'))).toEqual([]);
  return postJson.mock.calls
    .filter((c) => String(c[0]).endsWith('/generate'))
    .map((c) => ({ url: String(c[0]), body: c[1] as Record<string, unknown> }));
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function mountGenerator(): Promise<void> {
  render(<GeneratePage path="/generate" />);
  await flush(50);
}

async function openScopeDialog(buttonText: string): Promise<void> {
  fireEvent.click(screen.getAllByText(buttonText)[0]);
  await flush(0);
  expect(screen.getByRole('dialog')).toBeTruthy();
}

/** Pick a scope and press «Generate missing» (layers) / «Start» (VBook «Generate All»). */
async function chooseAndStart(radioLabel: string, button = 'Generate missing'): Promise<void> {
  fireEvent.click(screen.getByLabelText(radioLabel));
  await flush(SCOPE_DIALOG_ARM_MS + 10);
  fireEvent.click(screen.getByText(button));
  await flush(50);
}

describe('Generator sends a GPU command only on an explicit click', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    postJson.mockClear();
    panelTasks = [];
    dismissedTaskIds.value = new Set();
    document.documentElement.setAttribute('lang', 'en');
    bookId.value = BOOK;
    navigateTo({ chapterId: CH, sceneId: SC, unitId: null, chunkId: null, unitIndex: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mount, polls, restore, position/book refresh and a stopped row on screen → ZERO POST /generate', async () => {
    // A failed row with ▶ «Continue» / ■ «Remove» is on screen — never clicked.
    panelTasks = [{
      task_id: 'generation-audio-1', type: 'audio', label: 'Audio', state: 'failed', status: 'failed',
      failed: true, error_message: 'x', scope: 'current_scene', chapter_id: CH, scene_id: SC,
      ready: 0, total: 1, percent: 0, done: false, target_count: 1, visible: true,
    }];
    await mountGenerator();
    // 2.5 s restore check, 1.5 s panel poll, 5 s counts poll — run for 60 s.
    await flush(60_000);
    expect(screen.getByLabelText('Continue')).toBeTruthy(); // the row button IS on screen, never clicked
    // The player picks another scene, playback is prepared again (book reload).
    navigateTo({ chapterId: CH, sceneId: 'sc-7cd391e4', unitId: null, chunkId: null, unitIndex: 0 });
    emitPlaybackPrepared({ bookId: BOOK, buildId: `build_${BOOK}`, scenes: [], softRefresh: true });
    await flush(30_000);
    expect(regenerateCalls()).toEqual([]);
  });

  it('opening the scope dialog and cancelling (button / backdrop / Escape) sends nothing', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    fireEvent.click(screen.getByText('Cancel'));
    await flush(10);
    await openScopeDialog('Generate Images');
    fireEvent.click(document.querySelector('.modal-backdrop') as Element);
    await flush(10);
    await openScopeDialog('Generate Audio');
    fireEvent.keyDown(window, { key: 'Escape' });
    await flush(10);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(regenerateCalls()).toEqual([]);
  });

  it('a tap that lands on «Generate missing» / «Regenerate» right after the dialog opened (double tap) is ignored', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    fireEvent.click(screen.getByLabelText('Current scene'));
    fireEvent.click(screen.getByText('Generate missing')); // < SCOPE_DIALOG_ARM_MS after opening
    fireEvent.click(screen.getByText('Regenerate'));
    await flush(10);
    expect(regenerateCalls()).toEqual([]);
    expect(screen.getByRole('dialog')).toBeTruthy(); // still open — the user must confirm
  });

  it('«Generate Audio» → «Current scene» → «Generate missing» sends exactly ONE audio command for the player scene', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    await chooseAndStart('Current scene');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/book/${BOOK}/generate`);
    expect(calls[0].body).toMatchObject({
      layers: ['audio'], mode: 'missing', scope: { level: 'scene', chapter_id: CH, scene_id: SC },
    });
    expect(calls[0].body.client_action_id).toMatch(/^ua-[0-9a-f]{16}$/);
    expect(calls[0].body).not.toHaveProperty('rebuild_all');
    expect(calls[0].body).not.toHaveProperty('client_action');
    // Nothing else follows by itself.
    await flush(30_000);
    expect(regenerateCalls()).toHaveLength(1);
  });

  it('«Generate Images» → «Current chapter» sends image + current_chapter + chapter only', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Images');
    await chooseAndStart('Current chapter');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ layers: ['image'], mode: 'missing', scope: { level: 'chapter', chapter_id: CH } });
  });

  it('the dialog default is «Whole book» (no scene/chapter unless the user picks one)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    await flush(SCOPE_DIALOG_ARM_MS + 10);
    fireEvent.click(screen.getByText('Generate missing'));
    await flush(50);
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ layers: ['audio'], scope: { level: 'book' } });
  });

  it('«Regenerate» on one scene → mode all without a confirmation', async () => {
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    try {
      await mountGenerator();
      await openScopeDialog('Generate Audio');
      await chooseAndStart('Current scene', 'Regenerate');
      expect(confirm).not.toHaveBeenCalled();
      const calls = regenerateCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ layers: ['audio'], mode: 'all', scope: { level: 'scene', chapter_id: CH, scene_id: SC } });
    } finally { confirm.mockReset(); }
  });

  it('«Regenerate» on a scope wider than a scene asks first: «No» → nothing, «Yes» → one mode all command', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    try {
      await mountGenerator();
      await openScopeDialog('Generate Images');
      await chooseAndStart('Current chapter', 'Regenerate');
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(regenerateCalls()).toEqual([]);
      expect(screen.getByRole('dialog')).toBeTruthy();
      fireEvent.click(screen.getByText('Regenerate'));
      await flush(50);
      expect(confirm).toHaveBeenCalledTimes(2);
      const calls = regenerateCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ layers: ['image'], mode: 'all', scope: { level: 'chapter', chapter_id: CH } });
    } finally { confirm.mockReset(); }
  });

  it('each click is its own client_action_id (two clicks → two ids)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    await chooseAndStart('Current scene');
    await openScopeDialog('Generate Audio');
    await chooseAndStart('Current scene');
    const ids = regenerateCalls().map((c) => c.body.client_action_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('startGeneration without a UserAction (effect / timer path) is refused — no request', async () => {
    const res = await startGeneration(
      { workerTypes: ['audio'], scope: 'current_scene', chapterId: CH, sceneId: SC },
      undefined as never,
    );
    expect(res).toMatchObject({ ok: false, code: 'no_user_action' });
    expect(regenerateCalls()).toEqual([]);
  });

  // ── Integration E §6 (reports/2026-11-04/integration-A-B-C.md): every
  //    Generator button against the click guard. Each generate button → exactly
  //    ONE request; stop buttons → their own endpoints, never /regenerate. ──

  function postCalls(suffix: string): unknown[][] {
    return postJson.mock.calls.filter((c) => String(c[0]).endsWith(suffix));
  }
  const postJsonLong = client.postJsonLong as unknown as ReturnType<typeof vi.fn>;
  function bootstrapCalls(): string[] {
    return postJsonLong.mock.calls.map((c) => String(c[0])).filter((u) => /\/bootstrap(-next-window)?$/.test(u));
  }

  it('«Generate Video» → «From this scene onward» sends exactly ONE video command (chapter + scene)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Video');
    await chooseAndStart('From this scene onward');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      layers: ['video'], mode: 'missing', scope: { level: 'from_current_scene', chapter_id: CH, scene_id: SC },
    });
  });

  it('«Generate Images» → «Whole book» sends ONE image command {level: book} (no chapter/scene)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Images');
    await chooseAndStart('Whole book');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ layers: ['image'], mode: 'missing', scope: { level: 'book' } });
  });

  it('«Generate All» → «Whole book» → «Start» is the VBook window: ONE bootstrap call, ZERO /regenerate', async () => {
    await mountGenerator();
    postJsonLong.mockClear();
    await openScopeDialog('Generate All');
    await chooseAndStart('Whole book', 'Start');
    await flush(1_000);
    expect(regenerateCalls()).toEqual([]);
    expect(bootstrapCalls()).toHaveLength(1);
  });

  it('«Generate VBook» (no dialog) → ONE bootstrap call, ZERO /regenerate', async () => {
    await mountGenerator();
    postJsonLong.mockClear();
    fireEvent.click(screen.getAllByText(/^Generate VBook/)[0]);
    await flush(1_000);
    expect(regenerateCalls()).toEqual([]);
    expect(bootstrapCalls()).toHaveLength(1);
  });

  // Задача K (2026-11-05): a stopped row (failed / blocked / interrupted) has
  // the active-row layout — progress, short status — and two icon buttons
  // ▶ «Continue» (one /generate mode missing) / ■ «Remove» (/generate/stop
  // {command_id}; the row disappears; zero commands). v2: only failed (and
  // partial) commands stop — there is no blocked / interrupted state.
  const STOPPED = [
    ['failed', 'error: Generation failed — Worker did not respond, retries exhausted', { failed: true, error_message: 'Worker did not respond, retries exhausted' }],
  ] as const;
  function stoppedTask(state: string, extra: object): unknown {
    return {
      task_id: `generation-audio-${state}`, type: 'audio', label: 'Audio', state, status: state,
      scope: 'current_chapter', chapter_id: CH, scene_id: null, chapter_label: 'Пролог',
      ready: 1, total: 3, percent: 33, done: false, target_count: 3, visible: true, ...extra,
    };
  }
  async function mountWithStopped(state: string, extra: object): Promise<HTMLElement> {
    panelTasks = [stoppedTask(state, extra)];
    await mountGenerator();
    await flush(6_000); // restore check (2.5 s) + panel poll (1.5 s)
    const row = document.querySelector(`.gen-row[data-state="${state}"]`) as HTMLElement | null;
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  for (const [state, status, extra] of STOPPED) {
    it(`a ${state} row renders progress, «${status}» and the two icon buttons (no big «Continue»)`, async () => {
      const row = await mountWithStopped(state, extra);
      expect(row.querySelector('.gen-row__name')?.textContent).toBe('Audio · Пролог');
      expect(row.querySelector('.gen-row__count')?.textContent).toBe('1/3');
      expect(row.querySelector('.gen-row__pct')?.textContent).toBe('33%');
      expect((row.querySelector('.gen-row__bar-fill') as HTMLElement).style.width).toBe('33%');
      expect(row.querySelector('.gen-row__status')?.textContent).toBe(status);
      const buttons = [...row.querySelectorAll('button')];
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Continue', 'Remove']);
      expect(buttons.every((b) => b.classList.contains('gen-row__stop'))).toBe(true); // same size/style as ■
      expect(row.querySelector('.gen-row__retry')).toBeNull();
      expect(screen.queryByText('Continue')).toBeNull(); // no text button
      expect(regenerateCalls()).toEqual([]);
    });

    it(`a ${state} row ▶ sends exactly ONE command with the row's type/scope (source retry_row)`, async () => {
      const row = await mountWithStopped(state, extra);
      const play = row.querySelector('[aria-label="Continue"]') as Element;
      fireEvent.click(play);
      fireEvent.click(play); // double tap — ignored
      await flush(50);
      const calls = regenerateCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ layers: ['audio'], mode: 'missing', scope: { level: 'chapter', chapter_id: CH } });
      expect(postCalls('/generate/stop')).toEqual([]);
    });

    it(`a ${state} row ■ stops that command (/generate/stop command_id), the row disappears, ZERO commands`, async () => {
      const row = await mountWithStopped(state, extra);
      fireEvent.click(row.querySelector('[aria-label="Remove"]') as Element);
      await flush(50);
      const cancels = postCalls('/generate/stop');
      expect(cancels).toHaveLength(1);
      expect(cancels[0][1]).toEqual({ command_id: `generation-audio-${state}` });
      expect(document.querySelector(`.gen-row[data-state="${state}"]`)).toBeNull();
      // the backend keeps the cancelled task ~30 s — it never comes back as a row
      panelTasks = [{ ...(stoppedTask(state, extra) as object), state: 'cancelled', status: 'cancelled', cancelled: true, interrupted: false, blocked: false, failed: false }];
      await flush(5_000);
      expect(document.querySelector('.gen-row[data-state]')).toBeNull();
      expect(screen.queryByText(/Cancelled/)).toBeNull();
      expect(regenerateCalls()).toEqual([]);
    });
  }

  it('a stopped row ignores taps during the first STOPPED_ROW_ARM_MS after it appeared (double tap on the active ■)', async () => {
    panelTasks = [{
      task_id: 'generation-audio-x', type: 'audio', label: 'Audio', state: 'active', status: 'active',
      scope: 'whole_book', chapter_id: null, scene_id: null,
      ready: 1, total: 3, percent: 33, done: false, target_count: 3, visible: true,
    }];
    await mountGenerator();
    await flush(6_000);
    // the command fails — the next poll swaps the row
    panelTasks = [{ ...(panelTasks[0] as object), state: 'failed', status: 'failed', failed: true, error_message: 'x' }];
    let row: Element | null = null;
    for (let i = 0; i < 40 && !row; i++) {
      await flush(50);
      row = document.querySelector('.gen-row[data-state="failed"]');
    }
    expect(row).toBeTruthy();
    fireEvent.click(row!.querySelector('[aria-label="Continue"]') as Element);
    fireEvent.click(row!.querySelector('[aria-label="Remove"]') as Element);
    await flush(10);
    expect(regenerateCalls()).toEqual([]);
    expect(postCalls('/generate/stop')).toEqual([]);
    await flush(STOPPED_ROW_ARM_MS);
    fireEvent.click(document.querySelector('.gen-row[data-state="failed"] [aria-label="Continue"]') as Element);
    await flush(50);
    expect(regenerateCalls()).toHaveLength(1);
  });

  it('■ on a stopped row: a stop the backend refused (no command_id in the answer) keeps the row', async () => {
    const postJsonMock = postJson;
    postJsonMock.mockImplementationOnce(async () => ({ ok: false }));
    const row = await mountWithStopped('failed', { failed: true, error_message: 'x' });
    fireEvent.click(row.querySelector('[aria-label="Remove"]') as Element);
    await flush(50);
    expect(postCalls('/generate/stop')).toHaveLength(1);
    expect(document.querySelector('.gen-row[data-state="failed"]')).toBeTruthy();
    expect(regenerateCalls()).toEqual([]);
  });

  it('«Stop All», section «Stop» and a row stop: /generate/stop {} / {layer} / {command_id}, never a command', async () => {
    panelTasks = [{
      task_id: 'generation-image-run', type: 'image', label: 'Images', state: 'running', status: 'running',
      scope: 'whole_book', chapter_id: null, scene_id: null,
      ready: 1, total: 4, percent: 25, done: false, target_count: 4, visible: true,
    }];
    await mountGenerator();
    await flush(6_000); // restore check (2.5 s) + panel poll (1.5 s)
    const rowStop = document.querySelector('.gen-row__stop');
    expect(rowStop).toBeTruthy();
    fireEvent.click(rowStop as Element);
    await flush(10);
    const cancelInPopup = document.querySelector('.gen-popup-backdrop button');
    expect(cancelInPopup).toBeTruthy();
    fireEvent.click(cancelInPopup as Element);
    await flush(50);
    fireEvent.click(screen.getAllByText('Stop All')[0]);
    await flush(50);
    for (const b of screen.getAllByText('Stop')) fireEvent.click(b);
    await flush(50);
    expect(regenerateCalls()).toEqual([]);
    expect(postCalls('/cancel-generation')).toEqual([]);
    const stops = postCalls('/generate/stop').map((c) => c[1]);
    expect(stops).toContainEqual({ command_id: 'generation-image-run' });   // row ■
    expect(stops).toContainEqual({});                                        // «Stop All» — the book
    expect(stops.some((b) => (b as { layer?: string }).layer === 'image')).toBe(true);  // section «Stop»
    // the VBook section «Stop» is not an orchestration layer — it keeps cancel-worker type=vbook (задача H)
    expect(postCalls('/cancel-worker').every((c) => (c[1] as { type?: string }).type === 'vbook')).toBe(true);
  });
});

