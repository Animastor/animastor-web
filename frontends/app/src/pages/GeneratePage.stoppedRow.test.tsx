// @vitest-environment happy-dom
// ═══════════════════════════════════════════════════════════════
//  GENERATOR — stopped row (задача K, 2026-11-05)
// ═══════════════════════════════════════════════════════════════
//  interrupted / blocked / failed rows look like an ordinary progress row:
//  name, ready/total, percent, the bar at its current fill, a short status in
//  place of the timer, two small square icon buttons ▶ «Продолжить» /
//  ■ «Снять». The DOM snapshots (__snapshots__/GeneratePage.stoppedRow.test.tsx.snap)
//  are the state descriptions of reports/2026-11-05/generator-stopped-row.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';

vi.mock('../api/client', () => ({
  // authStore (via the reasoning notice) registers the 401 handler at import
  setLoginRequiredHandler: vi.fn(),
  POLL_REQUEST_TIMEOUT_MS: 10_000,
  API_BASE: 'http://test',
  getJson: vi.fn(async () => ({})),
  putJson: vi.fn(async () => ({})),
  // generate API v2: the row ■ is /generate/stop {command_id}, ▶ is /generate
  postJson: vi.fn(async (url: string, body?: { command_id?: string | null }) => (url.endsWith('/generate/stop')
    ? { ok: true, target: 'command', command_id: body?.command_id }
    : { book_id: 'b1', command_id: 'cmd-1', existing: false, summary: { jobs_created: 1, joined: 0, skipped_ready: 0 } })),
  postJsonLong: vi.fn(async () => ({})),
  deleteJson: vi.fn(async () => ({})),
  getBlob: vi.fn(async () => new Blob([])),
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sse: vi.fn(() => new Promise(() => {})),
}));

import * as client from '../api/client';
import { StoppedRow, STOPPED_ROW_ARM_MS } from './GeneratePage';
import { bookId, dismissedTaskIds } from '../state/generateStore';
import type { TaskRow } from '../state/generateStore';

const postJson = client.postJson as unknown as ReturnType<typeof vi.fn>;

function row(state: 'interrupted' | 'blocked' | 'failed', over: Partial<TaskRow> = {}): TaskRow {
  return {
    taskId: `generation-audio-${state}`, type: 'audio', label: 'Аудио', scope: 'current_chapter',
    chapterId: 'ch-1', sceneId: null, sceneLabel: null, chapterLabel: 'Пролог',
    endSceneLabel: null, endChapterLabel: null,
    ready: 2, total: 5, percent: 40, done: false, countText: null, indeterminate: false,
    cancelled: false, state, blockedType: state === 'blocked' ? 'audio' : null,
    errorClass: state === 'failed' ? 'deterministic' : null, errorCode: null,
    errorMessage: state === 'failed' ? 'bad input' : null, failedScene: null,
    retrying: false, retryNo: null, retryMax: null, retryAt: null,
    elapsedSeconds: 0, frozen: false, ...over,
  };
}

const STATES = [
  ['interrupted', 'прервано'],
  ['blocked', 'ожидает воркер'],
  ['failed', 'ошибка: Ошибка генерации — bad input'],
] as const;

describe('StoppedRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    postJson.mockClear();
    bookId.value = 'b1';
    dismissedTaskIds.value = new Set();
    document.documentElement.setAttribute('lang', 'ru');
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  for (const [state, status] of STATES) {
    it(`${state}: «Аудио · Пролог 2/5 40%», bar 40%, «${status}», ▶ + ■ (DOM snapshot)`, () => {
      const { container } = render(
        <StoppedRow row={row(state)} name="Аудио · Пролог" countText="2/5" status={status} caption={null} />,
      );
      const el = container.firstElementChild as HTMLElement;
      expect(el.getAttribute('data-state')).toBe(state);
      expect(el.querySelector('.gen-row__status')?.textContent).toBe(status);
      expect((el.querySelector('.gen-row__bar-fill') as HTMLElement).style.width).toBe('40%');
      const labels = [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
      expect(labels).toEqual(['Продолжить', 'Снять']);
      expect(el.outerHTML).toMatchSnapshot();
    });
  }

  it('failed with a scene caption keeps the caption under the bar', () => {
    const { container } = render(
      <StoppedRow row={row('failed')} name="Аудио" countText="2/5" status="ошибка: x" caption="Глава 1 · Сцена 3" />,
    );
    expect(container.querySelector('.gen-row__caption')?.textContent).toBe('Глава 1 · Сцена 3');
  });

  it('■ «Снять» → one /generate/stop for the command, the task id is dismissed; double tap ignored; no command', async () => {
    const { container } = render(
      <StoppedRow row={row('interrupted')} name="Аудио" countText="2/5" status="прервано" caption={null} />,
    );
    await vi.advanceTimersByTimeAsync(STOPPED_ROW_ARM_MS + 10);
    const stop = container.querySelector('[aria-label="Снять"]') as Element;
    fireEvent.click(stop);
    fireEvent.click(stop);
    await vi.advanceTimersByTimeAsync(10);
    const urls = postJson.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/book/b1/generate/stop']);
    expect(postJson.mock.calls[0][1]).toEqual({ command_id: 'generation-audio-interrupted' });
    expect([...dismissedTaskIds.value]).toEqual(['generation-audio-interrupted']);
  });

  it('▶ «Продолжить» → exactly one /generate (mode missing, its own client_action_id)', async () => {
    const { container } = render(
      <StoppedRow row={row('blocked')} name="Аудио" countText="2/5" status="ожидает воркер" caption={null} />,
    );
    await vi.advanceTimersByTimeAsync(STOPPED_ROW_ARM_MS + 10);
    const play = container.querySelector('[aria-label="Продолжить"]') as Element;
    fireEvent.click(play);
    fireEvent.click(play);
    await vi.advanceTimersByTimeAsync(10);
    expect(postJson.mock.calls.filter((c) => String(c[0]).endsWith('/regenerate'))).toEqual([]);
    const regen = postJson.mock.calls.filter((c) => String(c[0]).endsWith('/generate'));
    expect(regen).toHaveLength(1);
    expect(regen[0][1]).toMatchObject({ layers: ['audio'], mode: 'missing' });
    expect((regen[0][1] as { client_action_id: string }).client_action_id).toMatch(/^ua-/);
    expect(postJson.mock.calls.filter((c) => String(c[0]).endsWith('/generate/stop'))).toEqual([]);
  });

  it('taps within STOPPED_ROW_ARM_MS of the row appearing are ignored', async () => {
    const { container } = render(
      <StoppedRow row={row('interrupted')} name="Аудио" countText="2/5" status="прервано" caption={null} />,
    );
    fireEvent.click(container.querySelector('[aria-label="Продолжить"]') as Element);
    fireEvent.click(container.querySelector('[aria-label="Снять"]') as Element);
    await vi.advanceTimersByTimeAsync(10);
    expect(postJson.mock.calls).toEqual([]);
  });
});
