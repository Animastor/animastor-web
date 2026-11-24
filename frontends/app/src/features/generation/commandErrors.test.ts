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

// 2026-11-24: a blank book is refused up front with 422 book_has_no_text —
// the UI shows its own localized text, not the English server message.
describe('classifyStartError — 422 book_has_no_text', () => {
  it('422 book_has_no_text → its own kind', () => {
    const e = {
      status: 422,
      message: 'The book has no text yet — add text to its scenes, then start the generation.',
      body: {
        error: 'book_has_no_text',
        code: 'book_has_no_text',
        message: 'The book has no text yet — add text to its scenes, then start the generation.',
      },
    };
    expect(classifyStartError(e, ['audio'])).toEqual({ kind: 'book_has_no_text' });
  });
  it('422 with the code only in `error` (older shape) is still recognised', () => {
    const e = { status: 422, body: { error: 'book_has_no_text' } };
    expect(classifyStartError(e, ['image'])).toEqual({ kind: 'book_has_no_text' });
  });
  it('unknown 422 → server message, generic path', () => {
    const e = { status: 422, message: 'Some text from the server', body: { code: 'other_code', message: 'Some text from the server' } };
    expect(classifyStartError(e, ['audio'])).toEqual({ kind: 'other', message: 'Some text from the server' });
  });
});

describe('classifyStartError — voice references (VOICE_REFERENCES.md)', () => {
  it('409 voice_reference_required → its own kind with the character ids', () => {
    const e = { status: 409, message: 'x', body: { code: 'voice_reference_required', character_ids: ['narrator', 'anna', 3] } };
    expect(classifyStartError(e, ['audio'])).toEqual({ kind: 'voice_reference_required', characterIds: ['narrator', 'anna'] });
  });
});
