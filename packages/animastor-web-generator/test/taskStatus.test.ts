// Stage 155 (command-only generation): progress-panel task status helpers.
import { describe, expect, it } from 'vitest';
import { blockedWorkerType, commandWorkerType, failedSceneCaption, failureText, formatFailureText, formatRetryCountdown, isStoppedState, retryCommandFor, retryLine, taskRowState } from '../src/taskStatus';

describe('taskRowState', () => {
  it('classifies the Stage 155 statuses', () => {
    expect(taskRowState({ status: 'active' })).toBe('active');
    expect(taskRowState({ status: 'completed' })).toBe('done');
    expect(taskRowState({ status: 'cancelled', cancelled: true })).toBe('cancelled');
    expect(taskRowState({ status: 'blocked', blocked: true, blocked_reason: 'no_worker:audio' })).toBe('blocked');
    expect(taskRowState({ status: 'interrupted', interrupted: true })).toBe('interrupted');
    expect(taskRowState({ status: 'failed', failed: true })).toBe('failed');
    expect(taskRowState({ failed: true })).toBe('failed');
  });

  it('works with a pre-Stage-155 backend (no status fields)', () => {
    expect(taskRowState({ done: false, cancelled: false })).toBe('active');
    expect(taskRowState({ done: true })).toBe('done');
    expect(taskRowState({ cancelled: true })).toBe('cancelled');
    expect(taskRowState({ status: null, done: false })).toBe('active');
  });

  it('a stopped command is never shown as done or running', () => {
    expect(taskRowState({ status: 'blocked', done: true })).toBe('blocked');
    expect(taskRowState({ interrupted: true }, true)).toBe('interrupted');
    expect(taskRowState({ status: 'failed', done: true })).toBe('failed');
    expect(isStoppedState('blocked')).toBe(true);
    expect(isStoppedState('interrupted')).toBe(true);
    expect(isStoppedState('failed')).toBe(true);
    expect(isStoppedState('cancelled')).toBe(false);
    expect(isStoppedState('active')).toBe(false);
    expect(isStoppedState('done')).toBe(false);
  });

  it('precedence: cancelled > blocked > interrupted > failed > done > active', () => {
    expect(taskRowState({ cancelled: true, blocked: true, interrupted: true, failed: true, done: true })).toBe('cancelled');
    expect(taskRowState({ blocked: true, interrupted: true, failed: true, done: true })).toBe('blocked');
    expect(taskRowState({ interrupted: true, failed: true, done: true })).toBe('interrupted');
    expect(taskRowState({ failed: true, done: true })).toBe('failed');
    expect(taskRowState({ done: true })).toBe('done');
    expect(taskRowState({})).toBe('active');
  });
});

describe('blockedWorkerType / commandWorkerType', () => {
  it('parses no_worker:<type>', () => {
    expect(blockedWorkerType('no_worker:audio', 'audio')).toBe('audio');
    expect(blockedWorkerType('no_worker:image', 'cover')).toBe('image');
    expect(blockedWorkerType('no_worker:video', 'video')).toBe('video');
  });
  it('falls back to the row type for an absent/odd reason', () => {
    expect(blockedWorkerType(null, 'cover')).toBe('image');
    expect(blockedWorkerType('weird', 'audio')).toBe('audio');
    expect(blockedWorkerType(undefined, 'vbook')).toBe(null);
    expect(commandWorkerType('cover')).toBe('image');
    expect(commandWorkerType('vbook')).toBe(null);
  });
});

describe('retryCommandFor', () => {
  const base = { type: 'audio', chapterId: 'ch-1', sceneId: 'sc-1' };
  it('blocked / interrupted / failed → a new command with the same type and scope', () => {
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'current_scene' }))
      .toEqual({ workerTypes: ['audio'], scope: 'current_scene', chapterId: 'ch-1', sceneId: 'sc-1' });
    expect(retryCommandFor({ ...base, state: 'interrupted', scope: 'current_chapter' }))
      .toEqual({ workerTypes: ['audio'], scope: 'current_chapter', chapterId: 'ch-1', sceneId: null });
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'whole_book' }))
      .toEqual({ workerTypes: ['audio'], scope: 'whole_book', chapterId: null, sceneId: null });
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'from_current_scene' }))
      .toEqual({ workerTypes: ['audio'], scope: 'from_current_scene', chapterId: 'ch-1', sceneId: 'sc-1' });
    expect(retryCommandFor({ ...base, type: 'cover', state: 'blocked', scope: 'whole_book' })?.workerTypes).toEqual(['image']);
    expect(retryCommandFor({ ...base, state: 'failed', scope: 'current_scene' }))
      .toEqual({ workerTypes: ['audio'], scope: 'current_scene', chapterId: 'ch-1', sceneId: 'sc-1' });
    expect(retryCommandFor({ ...base, type: 'cover', state: 'failed', scope: 'whole_book' })?.workerTypes).toEqual(['image']);
  });
  it('nothing to repeat for active / done / cancelled rows or unknown types', () => {
    for (const state of ['active', 'done', 'cancelled'] as const) {
      expect(retryCommandFor({ ...base, state, scope: 'whole_book' })).toBe(null);
    }
    expect(retryCommandFor({ ...base, type: 'vbook', state: 'blocked', scope: 'whole_book' })).toBe(null);
    expect(retryCommandFor({ ...base, type: 'vbook', state: 'failed', scope: 'whole_book' })).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════
//  GPU retry policy (reports/2026-11-02/gpu-retry-policy.md §ТЗ фронтам)
// ═══════════════════════════════════════════════════════════════

describe('failureText', () => {
  const MSG_6323 = 'No prompt_id: invalid_prompt: Cannot execute because node Qwen3TTSGenerate does not exist.';

  it('maps the six class/code combinations of the ТЗ table', () => {
    expect(failureText(null, 'comfy_missing_node', MSG_6323, 'image').key).toBe('task_failed_comfy_nodes');
    expect(failureText(null, 'comfy_model_missing', 'value not in list: model', 'image').key).toBe('task_failed_comfy_model');
    expect(failureText('deterministic', 'comfy_rejected', 'No prompt_id: invalid_prompt', 'audio').key).toBe('task_failed_comfy_rejected');
    expect(failureText('deterministic', 'comfy_invalid_workflow', 'invalid workflow', 'audio').key).toBe('task_failed_comfy_rejected');
    expect(failureText('transient', 'execution_timeout', 'Timeout waiting result', 'video').key).toBe('task_failed_transient');
    expect(failureText('oom', 'cuda_oom', 'CUDA out of memory', 'image').key).toBe('task_failed_oom');
    expect(failureText('unknown', null, 'something broke', 'image').key).toBe('task_failed_unknown');
    expect(failureText(null, null, null, 'image').key).toBe('task_failed_unknown');
    expect(failureText(undefined, undefined, undefined, 'cover').key).toBe('task_failed_unknown');
  });

  it('passes the server message as the argument (6323 example)', () => {
    expect(failureText('deterministic', 'comfy_missing_node', MSG_6323, 'image'))
      .toEqual({ key: 'task_failed_comfy_nodes', arg: MSG_6323 });
  });

  it('an empty message gives a null argument; a multi-line one is cut to one line', () => {
    expect(failureText('deterministic', 'comfy_rejected', '', 'image').arg).toBe(null);
    expect(failureText('deterministic', 'comfy_rejected', '   \n  ', 'image').arg).toBe(null);
    expect(failureText('transient', 'network', 'first line\nsecond line', 'image').arg).toBe('first line…');
  });
});

describe('formatFailureText', () => {
  it('substitutes the argument into web {0} and Android %1$s templates alike', () => {
    expect(formatFailureText('ComfyUI: нет нужных нод — {0}', 'boom')).toBe('ComfyUI: нет нужных нод — boom');
    expect(formatFailureText('ComfyUI: required nodes missing — %1$s', 'boom')).toBe('ComfyUI: required nodes missing — boom');
  });

  it('drops the « — …» suffix when the argument is empty', () => {
    expect(formatFailureText('ComfyUI: нет нужных нод — {0}', null)).toBe('ComfyUI: нет нужных нод');
    expect(formatFailureText('ComfyUI: required nodes missing — %1$s', null)).toBe('ComfyUI: required nodes missing');
    expect(formatFailureText('Не хватило видеопамяти GPU', null)).toBe('Не хватило видеопамяти GPU');
    expect(formatFailureText('Не хватило видеопамяти GPU', 'CUDA OOM')).toBe('Не хватило видеопамяти GPU');
  });
});

describe('retryLine / formatRetryCountdown', () => {
  const NOW = 1_700_000_000_000;

  it('null when the row is not waiting out a pause', () => {
    expect(retryLine(false, 1, 2, NOW + 30_000, NOW)).toBe(null);
  });

  it('counts down to retry_at by the client clock', () => {
    expect(retryLine(true, 1, 2, NOW + 45_000, NOW))
      .toEqual({ key: 'task_retrying', args: [1, 2, '00:45'] });
    expect(retryLine(true, 2, 2, NOW + 1_999, NOW + 999))
      .toEqual({ key: 'task_retrying', args: [2, 2, '00:01'] });
  });

  it('«Повтор…» once retry_at has passed (or is absent) — until the next poll', () => {
    expect(retryLine(true, 1, 2, NOW, NOW)).toEqual({ key: 'task_retrying_now', args: [] });
    expect(retryLine(true, 1, 2, NOW - 1, NOW)).toEqual({ key: 'task_retrying_now', args: [] });
    expect(retryLine(true, null, null, null, NOW)).toEqual({ key: 'task_retrying_now', args: [] });
    expect(retryLine(true, null, null, NOW + 30_000, NOW))
      .toEqual({ key: 'task_retrying', args: [0, 0, '00:30'] });
  });

  it('the countdown never goes below zero and is mm:ss', () => {
    expect(formatRetryCountdown(-5_000)).toBe('00:00');
    expect(formatRetryCountdown(0)).toBe('00:00');
    expect(formatRetryCountdown(45_999)).toBe('00:45');
    expect(formatRetryCountdown(120_000)).toBe('02:00');
    expect(formatRetryCountdown(3_600_000)).toBe('60:00');
  });
});

describe('failedSceneCaption', () => {
  const chapters = [
    {
      chapter_id: 'ch-1', display_number: 2, chapter_title: 'The Road',
      scenes: [
        { scene_id: 'sc-1', display_index: 1, scene_title: 'Departure', type: null },
        { scene_id: 'sc-2', display_index: 2, scene_title: null, type: null },
        { scene_id: 'sc-3', display_index: 0, scene_title: '  ', type: null },
      ],
    },
    { chapter_id: 'ch-cover', scenes: [{ scene_id: 'sc-cover', display_index: 0, scene_title: null, type: 'cover' }] },
  ];

  it('computes the scene label from the loaded book (backend scene_label format)', () => {
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-1', scene_id: 'sc-1' })).toBe('Scene 1 — Departure');
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-1', scene_id: 'sc-2' })).toBe('Scene 2');
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-1', scene_id: 'sc-3' })).toBe('ch-1/sc-3');
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-cover', scene_id: 'sc-cover' })).toBe('Cover');
  });

  it('falls back to chapter_id/scene_id when the scene is not in the book', () => {
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-x', scene_id: 'sc-x' })).toBe('ch-x/sc-x');
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-1', scene_id: 'sc-x' })).toBe('ch-1/sc-x');
    expect(failedSceneCaption([], { chapter_id: 'ch-1', scene_id: 'sc-1' })).toBe('ch-1/sc-1');
    expect(failedSceneCaption(null, { chapter_id: 'ch-1', scene_id: 'sc-1' })).toBe('ch-1/sc-1');
  });

  it('null without a failed_scene or without ids', () => {
    expect(failedSceneCaption(chapters, null)).toBe(null);
    expect(failedSceneCaption(chapters, {})).toBe(null);
    expect(failedSceneCaption(chapters, { chapter_id: 'ch-1' })).toBe(null);
  });
});
