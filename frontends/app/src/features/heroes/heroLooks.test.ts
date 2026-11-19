// Looks — passport overrides (VBOOK_FORMAT_V4.md §4a). resolveLook is the
// client copy of vbook-runtime resolveHeroLook: the same table of cases.
import { describe, expect, it } from 'vitest';
import {
  diffAssignment, diffLook, draftFromLook, isEmptyAssignment, lookFieldsFromDraft, lookPlaceKey, lookUsage,
  previewLook, resolveLook, validateLookDraft, validateNewLookId,
} from './heroModel';
import { chapters, narrator, shopWomen, yura } from './heroFixtures';

const [ch1, ch2, ch3] = chapters;
const base = { appearance: 'man in his early thirties, short dark hair', clothes: 'worn brown leather jacket', video_tokens: ['man', 'dark hair', 'leather jacket'] };

describe('resolveLook', () => {
  it('no references → the base passport', () => {
    expect(resolveLook(yura, ch1, ch1.scenes![0])).toMatchObject({ look_id: 'base', source: 'base', ...base, changed: [], patched: [], warnings: [] });
  });
  it('chapter look replaces whole fields, the rest stays base', () => {
    const r = resolveLook(yura, ch2, ch2.scenes![0])!;
    expect(r).toMatchObject({ look_id: 'coat', source: 'chapter', appearance: base.appearance, clothes: 'long dark grey wool coat', video_tokens: ['man', 'grey coat'] });
    expect(r.changed).toEqual(['clothes', 'video_tokens']);
    expect(r.base).toEqual(base);
  });
  it('"base" in a scene wins over the chapter look', () => {
    expect(resolveLook(yura, ch2, ch2.scenes![1])).toMatchObject({ look_id: 'base', source: 'scene', ...base, changed: [] });
  });
  it('scene look wins; the one-off patch goes on top of it', () => {
    const r = resolveLook(yura, ch3, ch3.scenes![0])!;
    expect(r).toMatchObject({ look_id: 'beard', source: 'scene', appearance: 'man in his early thirties, thick dark beard', clothes: base.clothes, video_tokens: ['man', 'beard', 'scarf'] });
    expect(r.changed).toEqual(['appearance', 'video_tokens']);
    expect(r.patched).toEqual(['video_tokens']);
  });
  it('scene look wins over the chapter look', () => {
    expect(resolveLook(yura, ch2, { looks: { yura: 'beard' } })).toMatchObject({ look_id: 'beard', source: 'scene', clothes: base.clothes });
  });
  it('an unknown look is skipped with a warning: next source, then base', () => {
    expect(resolveLook(yura, ch2, { looks: { yura: 'gone' } })).toMatchObject({ look_id: 'coat', source: 'chapter', warnings: ['unknown_look:gone'] });
    expect(resolveLook(yura, { looks: { yura: 'gone' } }, null)).toMatchObject({ look_id: 'base', source: 'base', ...base, warnings: ['unknown_look:gone'] });
  });
  it('empty patch values do not erase anything', () => {
    const r = resolveLook(yura, ch1, { look_patch: { yura: { appearance: '', clothes: null, video_tokens: [] } } })!;
    expect(r).toMatchObject({ ...base, patched: [] });
  });
  it('a hero without a passport has no look', () => {
    expect(resolveLook(shopWomen, ch2, ch2.scenes![2])).toBeNull();
    expect(resolveLook(narrator, ch1, null)).toBeNull();
  });
  it('does not mutate the hero, the chapter or the scene', () => {
    const snapshot = JSON.stringify([yura, chapters]);
    const r = resolveLook(yura, ch3, ch3.scenes![0])!;
    r.video_tokens.push('x'); r.base.video_tokens.push('y');
    expect(JSON.stringify([yura, chapters])).toBe(snapshot);
  });
  it('previewLook shows a look without a scene', () => {
    expect(previewLook(yura, 'coat')).toMatchObject({ look_id: 'coat', changed: ['clothes', 'video_tokens'] });
    expect(previewLook(yura, 'base')).toMatchObject({ look_id: 'base', changed: [] });
  });
});

describe('lookUsage', () => {
  it('lists the places that reference each look; forced base scenes go under "base"', () => {
    const u = lookUsage(chapters, 'yura');
    expect(Object.keys(u).sort()).toEqual(['base', 'beard', 'coat']);
    expect(u.coat).toEqual([{ chapterId: 'ch-000002', sceneId: null, chapterNumber: 2, chapterTitle: '', sceneNumber: null, sceneTitle: '' }]);
    expect(u.beard).toMatchObject([{ chapterId: 'ch-000003', sceneId: 'sc-000031', chapterTitle: 'Зима', sceneNumber: 1 }]);
    expect(u.base).toMatchObject([{ chapterId: 'ch-000002', sceneId: 'sc-000022', sceneTitle: 'Дома' }]);
  });
  it('another hero and an empty book have no usage', () => {
    expect(lookUsage(chapters, 'shop_women')).toEqual({});
    expect(lookUsage(null, 'yura')).toEqual({});
  });
});

describe('look draft', () => {
  const coat = yura.looks![0];
  it('an untouched look sends nothing', () => expect(diffLook(coat, draftFromLook(coat))).toEqual({}));
  it('sends only changes; clearing a field removes it from the look', () => {
    expect(diffLook(coat, { ...draftFromLook(coat), label: ' В сером пальто ', clothes: '', appearance: 'older, grey temples' }))
      .toEqual({ label: 'В сером пальто', 'fields.clothes': null, 'fields.appearance': 'older, grey temples' });
    expect(diffLook(coat, { ...draftFromLook(coat), videoTokens: 'man,  grey coat' })).toEqual({});
    expect(diffLook(coat, { ...draftFromLook(coat), videoTokens: '' })).toEqual({ 'fields.video_tokens': null });
  });
  it('a look needs a label and at least one field, at most 4 tokens', () => {
    expect(validateLookDraft(draftFromLook(coat))).toEqual([]);
    expect(validateLookDraft(draftFromLook(null))).toEqual(['look_err_label_required', 'look_err_empty']);
    expect(validateLookDraft({ ...draftFromLook(coat), videoTokens: 'a,b,c,d,e' })).toEqual(['hero_err_tokens_max']);
  });
  it('fields of a new look carry only what is filled', () => {
    expect(lookFieldsFromDraft({ label: 'x', notes: '', appearance: ' ', clothes: ' red dress ', videoTokens: 'woman, red dress' }))
      .toEqual({ clothes: 'red dress', video_tokens: ['woman', 'red dress'] });
  });
  it('new look id: free canonical id, not "base", not taken', () => {
    expect(validateNewLookId('', yura)).toBeNull();
    expect(validateNewLookId('wounded', yura)).toBeNull();
    expect(validateNewLookId('base', yura)).toBe('look_id_reserved');
    expect(validateNewLookId('coat', yura)).toBe('look_id_taken');
    expect(validateNewLookId('В пальто', yura)).toBe('look_id_invalid');
  });
});

describe('diffAssignment', () => {
  const current = lookUsage(chapters, 'yura').coat;
  it('no change → nothing to send', () => {
    const d = diffAssignment(current, new Set([lookPlaceKey('ch-000002', null)]));
    expect(isEmptyAssignment(d.assign) && isEmptyAssignment(d.release)).toBe(true);
  });
  it('splits newly checked and unchecked places into chapters and scenes', () => {
    const d = diffAssignment(current, new Set([lookPlaceKey('ch-000003', null), lookPlaceKey('ch-000001', 'sc-000011')]));
    expect(d.assign).toEqual({ chapters: ['ch-000003'], scenes: [{ chapter_id: 'ch-000001', scene_id: 'sc-000011' }] });
    expect(d.release).toEqual({ chapters: ['ch-000002'], scenes: [] });
  });
});
