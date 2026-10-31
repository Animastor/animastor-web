// Stage 155 (command-only generation): progress-panel task status helpers.
import { describe, expect, it } from 'vitest';
import { blockedWorkerType, commandWorkerType, isStoppedState, retryCommandFor, taskRowState } from '../src/taskStatus';

describe('taskRowState', () => {
  it('classifies the Stage 155 statuses', () => {
    expect(taskRowState({ status: 'active' })).toBe('active');
    expect(taskRowState({ status: 'completed' })).toBe('done');
    expect(taskRowState({ status: 'cancelled', cancelled: true })).toBe('cancelled');
    expect(taskRowState({ status: 'blocked', blocked: true, blocked_reason: 'no_worker:audio' })).toBe('blocked');
    expect(taskRowState({ status: 'interrupted', interrupted: true })).toBe('interrupted');
  });

  it('works with a pre-Stage-155 backend (no status fields)', () => {
    expect(taskRowState({ done: false, cancelled: false })).toBe('active');
    expect(taskRowState({ done: true })).toBe('done');
    expect(taskRowState({ cancelled: true })).toBe('cancelled');
  });

  it('a stopped command is never shown as done or running', () => {
    expect(taskRowState({ status: 'blocked', done: true })).toBe('blocked');
    expect(taskRowState({ interrupted: true }, true)).toBe('interrupted');
    expect(isStoppedState('blocked')).toBe(true);
    expect(isStoppedState('interrupted')).toBe(true);
    expect(isStoppedState('cancelled')).toBe(false);
    expect(isStoppedState('active')).toBe(false);
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
  it('blocked / interrupted → a new command with the same type and scope', () => {
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'current_scene' }))
      .toEqual({ workerTypes: ['audio'], scope: 'current_scene', chapterId: 'ch-1', sceneId: 'sc-1' });
    expect(retryCommandFor({ ...base, state: 'interrupted', scope: 'current_chapter' }))
      .toEqual({ workerTypes: ['audio'], scope: 'current_chapter', chapterId: 'ch-1', sceneId: null });
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'whole_book' }))
      .toEqual({ workerTypes: ['audio'], scope: 'whole_book', chapterId: null, sceneId: null });
    expect(retryCommandFor({ ...base, state: 'blocked', scope: 'from_current_scene' }))
      .toEqual({ workerTypes: ['audio'], scope: 'from_current_scene', chapterId: 'ch-1', sceneId: 'sc-1' });
    expect(retryCommandFor({ ...base, type: 'cover', state: 'blocked', scope: 'whole_book' })?.workerTypes).toEqual(['image']);
  });
  it('nothing to repeat for active / done / cancelled rows or unknown types', () => {
    for (const state of ['active', 'done', 'cancelled'] as const) {
      expect(retryCommandFor({ ...base, state, scope: 'whole_book' })).toBe(null);
    }
    expect(retryCommandFor({ ...base, type: 'vbook', state: 'blocked', scope: 'whole_book' })).toBe(null);
  });
});
