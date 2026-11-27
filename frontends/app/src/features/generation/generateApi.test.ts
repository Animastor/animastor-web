// Generate API v2 (ADR ORCHESTRATION_V2 §11.1–11.2) — pure helpers of the web front.
// Mirrors Android GenerateApiV2Test.kt.
import { describe, expect, it } from 'vitest';
import {
  aggregateToPanel, newClientActionId, parseGenStreamEvent, regenerateNeedsConfirm, stopBody, toGenerateScope,
} from './generateApi';
import type { GenProgress } from './generateApi';
import { classifyStartError } from './commandErrors';

const zero = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, retrying: 0, joined_queued: 0, joined_running: 0 };

function agg(commands: Partial<GenProgress['commands'][number]>[]): GenProgress {
  return {
    book_id: 'b1', active: true, totals: { ...zero },
    commands: commands.map((c, i) => ({
      command_id: `c${i}`, kind: 'regenerate', status: 'active', mode: 'missing', scope: { level: 'book' },
      layers: ['audio'], totals: { ...zero }, by_layer: {}, scenes: [], ...c,
    })),
  };
}

describe('toGenerateScope', () => {
  it('maps the dialog scopes onto the /generate scope', () => {
    expect(toGenerateScope('whole_book', 'ch', 'sc')).toEqual({ level: 'book' });
    expect(toGenerateScope('current_chapter', 'ch', 'sc')).toEqual({ level: 'chapter', chapter_id: 'ch' });
    expect(toGenerateScope('current_scene', 'ch', 'sc')).toEqual({ level: 'scene', chapter_id: 'ch', scene_id: 'sc' });
    expect(toGenerateScope('from_current_scene', 'ch', 'sc')).toEqual({ level: 'from_current_scene', chapter_id: 'ch', scene_id: 'sc' });
  });
  it('null without the position the scope needs / for an unknown scope', () => {
    expect(toGenerateScope('current_scene', 'ch', null)).toBeNull();
    expect(toGenerateScope('current_chapter', null, null)).toBeNull();
    expect(toGenerateScope('whatever', 'ch', 'sc')).toBeNull();
  });
});

describe('two buttons (ADR §11.2)', () => {
  it('«Regenerate» is confirmed only for a scope wider than one scene', () => {
    expect(regenerateNeedsConfirm('current_scene')).toBe(false);
    for (const s of ['current_chapter', 'from_current_scene', 'whole_book']) expect(regenerateNeedsConfirm(s)).toBe(true);
  });
  it('a fresh client_action_id per click', () => {
    const a = newClientActionId(); const b = newClientActionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});

describe('stopBody — three kinds of stop', () => {
  it('row ■ → {command_id}; section ■ → {layer}; «Stop all» → {}', () => {
    expect(stopBody('audio', 'cmd-1')).toEqual({ command_id: 'cmd-1' });
    expect(stopBody('image')).toEqual({ layer: 'image' });
    expect(stopBody(null)).toEqual({});
    expect(stopBody('book')).toEqual({});
  });
  it('VBook / cover are not orchestration layers → null (caller keeps cancel-worker)', () => {
    expect(stopBody('vbook')).toBeNull();
    expect(stopBody('cover')).toBeNull();
  });
});

describe('aggregateToPanel', () => {
  it('one row per command × layer, task_id = command_id, counts and labels from the aggregate', () => {
    const p = aggregateToPanel(agg([{
      command_id: 'cmd-a', layers: ['audio', 'image'], scope: { level: 'scene', chapter_id: 'ch-1', scene_id: 'sc-1' },
      created_at: '2026-11-27T10:00:00.000Z', labels: { chapter_label: 'Chapter 1', scene_label: 'Scene 2' },
      by_layer: {
        audio: { ...zero, queued: 1, done: 1, ready: 1, total: 3, percent: 33, scenes: 1 },
        image: { ...zero, queued: 2, ready: 0, total: 2, percent: 0, scenes: 1, retrying: 1 },
      },
      scenes: [{ ...zero, chapter_id: 'ch-1', scene_id: 'sc-1', layer: 'audio' }, { ...zero, chapter_id: 'ch-1', scene_id: 'sc-1', layer: 'image' }],
    }]));
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks[0]).toMatchObject({
      task_id: 'cmd-a', type: 'audio', scope: 'current_scene', chapter_id: 'ch-1', scene_id: 'sc-1',
      chapter_label: 'Chapter 1', scene_label: 'Scene 2', ready: 1, total: 3, percent: 33, done: false,
      status: 'active', target_count: 1, started_at: Date.parse('2026-11-27T10:00:00.000Z'),
    });
    expect(p.tasks[1]).toMatchObject({ type: 'image', retrying: true, ready: 0, total: 2 });
    expect(p.any_incomplete).toBe(true);
    expect(p.overall_percent).toBe(17);
  });
  it('done → 100 % completed; failed / partial → failed with the error; cancelled', () => {
    const p = aggregateToPanel(agg([
      { command_id: 'd', status: 'done', by_layer: { audio: { ...zero, ready: 2, total: 4, percent: 50, scenes: 1 } } },
      { command_id: 'f', status: 'partial', error: 'boom', by_layer: { audio: { ...zero, ready: 1, total: 2, percent: 50, scenes: 1 } } },
      { command_id: 'x', status: 'cancelled', by_layer: {} },
    ]));
    expect(p.tasks[0]).toMatchObject({ done: true, status: 'completed', ready: 4, total: 4, percent: 100 });
    expect(p.tasks[1]).toMatchObject({ failed: true, status: 'failed', error_message: 'boom', error_class: 'gen_v2' });
    expect(p.tasks[2]).toMatchObject({ cancelled: true, status: 'cancelled' });
    expect(p.any_incomplete).toBe(false);
  });
  it('scope scenes (from the current scene on) → from_current_scene, chapter of the first scene', () => {
    const p = aggregateToPanel(agg([{
      scope: { level: 'scenes', scene_ids: ['sc-2', 'sc-3'] },
      scenes: [{ ...zero, chapter_id: 'ch-1', scene_id: 'sc-2', layer: 'audio' }, { ...zero, chapter_id: 'ch-2', scene_id: 'sc-3', layer: 'audio' }],
    }]));
    expect(p.tasks[0]).toMatchObject({ scope: 'from_current_scene', chapter_id: 'ch-1', scene_id: 'sc-2', target_count: 2 });
  });
  it('null / empty aggregate → no rows', () => {
    expect(aggregateToPanel(null)).toEqual({ book_id: null, tasks: [], overall_percent: 0, any_incomplete: false });
  });
});

describe('parseGenStreamEvent', () => {
  it('reads gen_progress events (connect / notify)', () => {
    const progress = agg([]);
    expect(parseGenStreamEvent(JSON.stringify({ type: 'gen_progress', reason: 'connect', command_ids: [], progress })))
      .toEqual({ type: 'gen_progress', reason: 'connect', command_ids: [], progress });
    expect(parseGenStreamEvent(JSON.stringify({ type: 'gen_progress', reason: 'notify', command_ids: ['c', 1], progress }))?.command_ids).toEqual(['c']);
  });
  it('drops malformed / other payloads', () => {
    expect(parseGenStreamEvent('{bad')).toBeNull();
    expect(parseGenStreamEvent(JSON.stringify({ type: 'progress', layer: 'audio' }))).toBeNull();
    expect(parseGenStreamEvent(JSON.stringify({ type: 'gen_progress', progress: {} }))).toBeNull();
  });
});

describe('classifyStartError — /generate error format {code, error}', () => {
  it('409 {code: layer_disabled, disabled_layers}', () => {
    expect(classifyStartError({ status: 409, body: { code: 'layer_disabled', error: 'x', disabled_layers: ['image'] } }, ['audio']))
      .toEqual({ kind: 'layer_disabled', workerTypes: ['image'] });
  });
  it('409 book_not_v2 is a plain error with the server text', () => {
    expect(classifyStartError({ status: 409, message: 'book b is not on orchestration v2', body: { code: 'book_not_v2', error: 'book b is not on orchestration v2' } }, ['audio']))
      .toEqual({ kind: 'other', message: 'book b is not on orchestration v2' });
  });
});
