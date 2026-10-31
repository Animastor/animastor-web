import { describe, expect, it } from 'vitest';
import { classifyStartError, layerLabels } from './commandErrors';

describe('classifyStartError (Stage 155 /regenerate 409 layer_disabled)', () => {
  it('409 layer_disabled → the disabled types from the body', () => {
    const e = { status: 409, message: 'layer_disabled', body: { error: 'layer_disabled', disabled_worker_types: ['image'] } };
    expect(classifyStartError(e, ['image'])).toEqual({ kind: 'layer_disabled', workerTypes: ['image'] });
  });
  it('409 layer_disabled without a list → falls back to the requested types', () => {
    const e = { status: 409, body: { error: 'layer_disabled' } };
    expect(classifyStartError(e, ['video'])).toEqual({ kind: 'layer_disabled', workerTypes: ['video'] });
  });
  it('other 409 (regeneration already in progress) keeps the generic path', () => {
    const e = { status: 409, message: 'Regeneration already in progress for this book', body: { error: 'Regeneration already in progress for this book' } };
    expect(classifyStartError(e, ['audio'])).toEqual({ kind: 'other', message: 'Regeneration already in progress for this book' });
  });
  it('network / 500 errors keep the generic path', () => {
    expect(classifyStartError(new Error('boom'), ['audio'])).toEqual({ kind: 'other', message: 'boom' });
    expect(classifyStartError({ status: 500, message: 'x', body: { error: 'layer_disabled' } }, ['audio']).kind).toBe('other');
  });
  it('layerLabels joins section labels for the «…» message', () => {
    const label = (t: string) => ({ audio: 'Аудио', image: 'Изображения' } as Record<string, string>)[t] ?? t;
    expect(layerLabels(['image'], label)).toBe('Изображения');
    expect(layerLabels(['audio', 'image'], label)).toBe('Аудио», «Изображения');
  });
});
