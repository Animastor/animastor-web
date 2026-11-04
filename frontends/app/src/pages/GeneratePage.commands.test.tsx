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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

const CH = 'ch-5e5a8c76';
const SC = 'sc-4bb85e02';
const BOOK = 'ba_1788172242081';

let panelTasks: unknown[] = [];

vi.mock('../api/client', () => ({
  API_BASE: 'http://test',
  getJson: vi.fn(async (url: string) => {
    if (url.startsWith('/worker/counts')) {
      return { vbook: 0, active_vbook: 0, audio: 1, image: 1, video: 0, active_audio: 0, active_image: 0, active_video: 0 };
    }
    if (url.endsWith('/progress-panel')) return { tasks: panelTasks, overall_percent: 0, any_incomplete: panelTasks.length > 0 };
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
  postJson: vi.fn(async (url: string) => (url.endsWith('/regenerate')
    ? { book_id: BOOK, build_id: `build_${BOOK}`, scope: 'current_scene', dirty_scenes: [{ chapter_id: CH, scene_id: SC }] }
    : {})),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sse: vi.fn(() => new Promise(() => {})),
}));

import * as client from '../api/client';
import { GeneratePage, SCOPE_DIALOG_ARM_MS } from './GeneratePage';
import { bookId, startGeneration, emitPlaybackPrepared } from '../state/generateStore';
import { navigateTo } from '../state/positionStore';

const postJson = client.postJson as unknown as ReturnType<typeof vi.fn>;

function regenerateCalls(): { url: string; body: Record<string, unknown> }[] {
  return postJson.mock.calls
    .filter((c) => String(c[0]).endsWith('/regenerate'))
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

async function chooseAndStart(radioLabel: string): Promise<void> {
  fireEvent.click(screen.getByLabelText(radioLabel));
  await flush(SCOPE_DIALOG_ARM_MS + 10);
  fireEvent.click(screen.getByText('Start'));
  await flush(50);
}

describe('Generator sends a GPU command only on an explicit click', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    postJson.mockClear();
    panelTasks = [];
    document.documentElement.setAttribute('lang', 'en');
    bookId.value = BOOK;
    navigateTo({ chapterId: CH, sceneId: SC, unitId: null, chunkId: null, unitIndex: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mount, polls, restore, position/book refresh and a stopped row on screen → ZERO POST /regenerate', async () => {
    // A blocked row with a «Retry» button is on screen — never clicked.
    panelTasks = [{
      task_id: 'generation-audio-1', type: 'audio', label: 'Audio', state: 'blocked', status: 'blocked',
      blocked_reason: 'no_worker:audio', scope: 'current_scene', chapter_id: CH, scene_id: SC,
      ready: 0, total: 1, percent: 0, done: false, target_count: 1, visible: true,
    }];
    await mountGenerator();
    // 2.5 s restore check, 1.5 s panel poll, 5 s counts poll — run for 60 s.
    await flush(60_000);
    expect(screen.getByText('Retry')).toBeTruthy(); // the row button IS on screen, never clicked
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

  it('a tap that lands on «Start» right after the dialog opened (double tap) is ignored', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    fireEvent.click(screen.getByLabelText('Current scene'));
    fireEvent.click(screen.getByText('Start')); // < SCOPE_DIALOG_ARM_MS after opening
    await flush(10);
    expect(regenerateCalls()).toEqual([]);
    expect(screen.getByRole('dialog')).toBeTruthy(); // still open — the user must confirm
  });

  it('«Generate Audio» → «Current scene» → «Start» sends exactly ONE audio command for the player scene', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    await chooseAndStart('Current scene');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/book/${BOOK}/regenerate`);
    expect(calls[0].body).toMatchObject({
      rebuild_all: true, worker_types: ['audio'], scope: 'current_scene', chapter_id: CH, scene_id: SC,
    });
    expect(calls[0].body.client_action).toMatchObject({ kind: 'user_click', source: 'generator.scope_dialog' });
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
    expect(calls[0].body).toMatchObject({ worker_types: ['image'], scope: 'current_chapter', chapter_id: CH, scene_id: null });
  });

  it('the dialog default is «Whole book» (no scene/chapter unless the user picks one)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Audio');
    await flush(SCOPE_DIALOG_ARM_MS + 10);
    fireEvent.click(screen.getByText('Start'));
    await flush(50);
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ worker_types: ['audio'], scope: 'whole_book', chapter_id: null, scene_id: null });
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
      rebuild_all: true, worker_types: ['video'], scope: 'from_current_scene', chapter_id: CH, scene_id: SC,
    });
    expect(calls[0].body.client_action).toMatchObject({ kind: 'user_click', source: 'generator.scope_dialog', trusted: false });
  });

  it('«Generate Images» → «Whole book» sends ONE image command whole_book + rebuild_all (no chapter/scene)', async () => {
    await mountGenerator();
    await openScopeDialog('Generate Images');
    await chooseAndStart('Whole book');
    const calls = regenerateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ rebuild_all: true, worker_types: ['image'], scope: 'whole_book', chapter_id: null, scene_id: null });
  });

  it('«Generate All» → «Whole book» → «Start» is the VBook window: ONE bootstrap call, ZERO /regenerate', async () => {
    await mountGenerator();
    postJsonLong.mockClear();
    await openScopeDialog('Generate All');
    await chooseAndStart('Whole book');
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

  for (const [state, label, extra] of [
    ['failed', 'Retry', { failed: true, error_class: 'transient', error_code: 'network' }],
    ['blocked', 'Retry', { blocked_reason: 'no_worker:audio' }],
    ['interrupted', 'Continue', { interrupted: true }],
  ] as const) {
    it(`a ${state} row «${label}» sends exactly ONE command with the row's type/scope (source retry_row)`, async () => {
      panelTasks = [{
        task_id: `generation-audio-${state}`, type: 'audio', label: 'Audio', state, status: state,
        scope: 'current_chapter', chapter_id: CH, scene_id: null,
        ready: 0, total: 3, percent: 0, done: false, target_count: 3, visible: true, ...extra,
      }];
      await mountGenerator();
      await flush(6_000); // restore check (2.5 s) + panel poll (1.5 s)
      fireEvent.click(screen.getByText(label));
      await flush(50);
      const calls = regenerateCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ worker_types: ['audio'], scope: 'current_chapter', chapter_id: CH, scene_id: null });
      expect(calls[0].body.client_action).toMatchObject({ kind: 'user_click', source: 'generator.retry_row' });
    });
  }

  it('«Stop All», section «Stop» and a row stop never send /regenerate (cancel endpoints only)', async () => {
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
    expect(postCalls('/cancel-generation')).toHaveLength(1);
    // row stop (task_id) + one per section «Stop»
    expect(postCalls('/cancel-worker').length).toBeGreaterThanOrEqual(2);
    expect(postCalls('/cancel-worker').some((c) => (c[1] as { task_id?: string }).task_id === 'generation-image-run')).toBe(true);
  });
});

