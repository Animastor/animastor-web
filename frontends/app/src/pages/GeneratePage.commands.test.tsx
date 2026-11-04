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
      ready: 0, total: 1, percent: 0, done: false, target_count: 1,
    }];
    await mountGenerator();
    // 2.5 s restore check, 1.5 s panel poll, 5 s counts poll — run for 60 s.
    await flush(60_000);
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
});
