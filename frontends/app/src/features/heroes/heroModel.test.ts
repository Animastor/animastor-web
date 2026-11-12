// Hero model — pure logic of the hero card (HERO_CARD.md §4, §5).
import { describe, expect, it } from 'vitest';
import {
  allRuleIds, blockingIssues, diffDraft, draftFromHero, heroKind, heroMonogram, heroStats, heroWarnings,
  isDraftDirty, newRuleId, orderHeroes, portraitIndex, reactionsToText, referenceStatus, textToReactions,
  textToTokens, textToUniqueLines, unsupportedVbook, validateDraft, validateNewHeroId, voiceInstruct,
} from './heroModel';
import type { Hero } from './heroModel';
import { globals, narrator, shopWomen, yura } from './heroFixtures';

describe('heroes: order and kind', () => {
  it('puts the narrator first and keeps the server order of the rest', () => {
    expect(orderHeroes([yura, shopWomen, narrator]).map((h) => h.id)).toEqual(['narrator', 'yura', 'shop_women']);
  });
  it('drops entries that cannot be addressed and survives a non-array', () => {
    expect(orderHeroes([yura, null, { name: 'x' }, { id: '' }, 'yura']).map((h) => h.id)).toEqual(['yura']);
    expect(orderHeroes(undefined)).toEqual([]);
    expect(orderHeroes({ yura })).toEqual([]);
  });
  it('kind follows the blocks: passport = character, no passport = voice only', () => {
    expect(heroKind(yura)).toBe('character');
    expect(heroKind(shopWomen)).toBe('voice_only');
    expect(heroKind(narrator)).toBe('narrator');
    expect(heroKind({ id: 'mute', passport: {} })).toBe('character');
  });
});

describe('heroes: portrait and stats', () => {
  it('portrait is the first ref of kind portrait, else the first ref', () => {
    expect(portraitIndex(yura)).toBe(1);
    expect(portraitIndex({ id: 'a', image_refs: [{ file: 'refs/images/a/x.png', sha256: 'c'.repeat(64) }] })).toBe(0);
    expect(portraitIndex(narrator)).toBe(-1);
  });
  it('monogram: two initials of the name, else of the id', () => {
    expect(heroMonogram(yura)).toBe('Ю');
    expect(heroMonogram(shopWomen)).toBe('ЖВ');
    expect(heroMonogram({ id: 'ponyrev_ivan' })).toBe('PI');
  });
  it('stats count filled fields, enabled rules and the reference state', () => {
    expect(heroStats(yura)).toEqual({ passport: 3, voice: 2, reference: 'pinned', rulesOn: 1, rulesTotal: 2, aliases: 2, images: 2 });
    expect(heroStats(narrator)).toMatchObject({ passport: null, voice: 2, reference: 'none', rulesTotal: 0 });
    expect(heroStats({ id: 'a', passport: { appearance: ' ', video_tokens: [] } }).passport).toBe(0);
  });
  it('reference status: missing / mismatch win over locked', () => {
    const ref = yura.voice!.reference!;
    expect(referenceStatus({ reference: ref, reference_state: 'missing' })).toBe('missing');
    expect(referenceStatus({ reference: ref, reference_state: 'mismatch' })).toBe('mismatch');
    expect(referenceStatus({ reference: { ...ref, locked: false }, reference_state: 'ok' })).toBe('candidate');
    expect(referenceStatus({ timbre: 'x' })).toBe('none');
    expect(referenceStatus(null)).toBe('none');
  });
  it('TTS text is join(timbre, manner)', () => {
    expect(voiceInstruct({ timbre: ' Deep. ', manner: 'Slow.' })).toBe('Deep. Slow.');
    expect(voiceInstruct({ timbre: '', manner: 'Slow.' })).toBe('Slow.');
    expect(voiceInstruct(null)).toBe('');
  });
});

describe('heroes: new id', () => {
  const existing = ['narrator', 'yura'];
  it('empty id is allowed (the server derives it)', () => expect(validateNewHeroId('  ', existing)).toBeNull());
  it('canonical free id passes', () => expect(validateNewHeroId('ponyrev_ivan', existing)).toBeNull());
  it.each(['Юра', 'Ivan', 'a__b', '_a', 'a-b', 'a b', 'x'.repeat(65)])('rejects %s', (id) => {
    expect(validateNewHeroId(id, existing)).toBe('hero_id_invalid');
  });
  it('rejects reserved and taken ids', () => {
    expect(validateNewHeroId('manifest', existing)).toBe('hero_id_reserved');
    expect(validateNewHeroId('behaviour', existing)).toBe('hero_id_reserved');
    expect(validateNewHeroId('yura', existing)).toBe('hero_id_taken');
  });
});

describe('heroes: text round-trips', () => {
  it('reactions keep the rules of the former Behavior tab', () => {
    expect(reactionsToText(yura.behaviour!.profile!.reactions)).toBe('is praised → looks away');
    expect(textToReactions('a -> b\nc → d → e\nlonely')).toEqual([
      { trigger: 'a', reaction: 'b' },
      { trigger: 'c', reaction: 'd → e' },
      { trigger: 'lonely', reaction: null },
    ]);
  });
  it('aliases are unique ignoring case, first spelling wins', () => {
    expect(textToUniqueLines('Юрий\n юрий \n\nЮрка')).toEqual(['Юрий', 'Юрка']);
  });
  it('video tokens split on commas and new lines', () => {
    expect(textToTokens('man, dark hair\nleather jacket,,')).toEqual(['man', 'dark hair', 'leather jacket']);
  });
});

describe('heroes: draft diff → PATCH fields', () => {
  it('an untouched card sends nothing', () => {
    for (const hero of [yura, narrator, shopWomen]) {
      expect(diffDraft(hero, draftFromHero(hero))).toEqual({});
      expect(isDraftDirty(hero, draftFromHero(hero))).toBe(false);
    }
  });
  it('sends only changed fields; empty text clears with null', () => {
    const d = { ...draftFromHero(yura), name: 'Юрий Петрович', clothes: '', manner: 'Fast.' };
    expect(diffDraft(yura, d)).toEqual({ name: 'Юрий Петрович', 'passport.clothes': null, 'voice.manner': 'Fast.' });
  });
  it('lists are sent as arrays', () => {
    const d = { ...draftFromHero(yura), aliases: 'Юрий\nЮра-джан', videoTokens: 'man, coat', quirks: '' };
    expect(diffDraft(yura, d)).toEqual({
      aliases: ['Юрий', 'Юра-джан'],
      'passport.video_tokens': ['man', 'coat'],
      'behaviour.profile.quirks': [],
    });
  });
  it('re-typing the same aliases with other spacing is not a change', () => {
    expect(diffDraft(yura, { ...draftFromHero(yura), aliases: ' Юрий \n\nЮрка\n' })).toEqual({});
  });
  it('untouched reactions are never rewritten (unknown keys survive)', () => {
    const d = { ...draftFromHero(yura), baseline: 'nervous' };
    expect(diffDraft(yura, d)).toEqual({ 'behaviour.profile.baseline': 'nervous' });
  });
  it('removing a block sends null and none of its fields', () => {
    const d = { ...draftFromHero(yura), hasPassport: false, appearance: 'changed', hasVoice: false };
    expect(diffDraft(yura, d)).toEqual({ passport: null, voice: null });
  });
  it('adding a block: its fields create it; an empty block is created explicitly', () => {
    expect(diffDraft(shopWomen, { ...draftFromHero(shopWomen), hasPassport: true, appearance: 'grey shawl' }))
      .toEqual({ 'passport.appearance': 'grey shawl' });
    expect(diffDraft(shopWomen, { ...draftFromHero(shopWomen), hasPassport: true })).toEqual({ passport: {} });
    const mute: Hero = { id: 'mute', name: 'Немой', passport: {} };
    expect(diffDraft(mute, { ...draftFromHero(mute), hasVoice: true })).toEqual({ voice: {} });
  });
});

describe('heroes: draft validation', () => {
  it('a valid card has no errors', () => expect(validateDraft(yura, draftFromHero(yura))).toEqual([]));
  it('a character needs a name; the narrator and voice-only heroes do not', () => {
    expect(validateDraft(yura, { ...draftFromHero(yura), name: ' ' })).toEqual(['hero_err_name_required']);
    expect(validateDraft(narrator, draftFromHero(narrator))).toEqual([]);
    expect(validateDraft(shopWomen, { ...draftFromHero(shopWomen), name: '' })).toEqual([]);
  });
  it('at most 4 video tokens; an alias may not repeat the name', () => {
    expect(validateDraft(yura, { ...draftFromHero(yura), videoTokens: 'a,b,c,d,e' })).toEqual(['hero_err_tokens_max']);
    expect(validateDraft(yura, { ...draftFromHero(yura), aliases: 'юра' })).toEqual(['hero_err_alias_is_name']);
  });
});

describe('heroes: rules', () => {
  it('rule ids of the whole book: globals + every hero', () => {
    expect(allRuleIds([yura, narrator], globals)).toEqual(['global.joyful_smile', 'yura.praised', 'yura.angry']);
  });
  it('new rule id is derived from the action and never collides', () => {
    expect(newRuleId('yura', 'Rubs the bridge of his nose', [])).toBe('yura.rubs_the_bridge');
    expect(newRuleId('yura', 'goes silent', ['yura.goes_silent', 'yura.goes_silent_2'])).toBe('yura.goes_silent_3');
    expect(newRuleId('yura', 'молчит', [])).toBe('yura.rule');
  });
});

describe('heroes: issues and unsupported book', () => {
  const issues = [
    { file: 'characters/berlioz.json', hero_id: 'berlioz', code: 'invalid_json', message: 'Unexpected token', blocking: true },
    { hero_id: 'yura', code: 'unknown_key', message: 'unknown key "voise"', blocking: false },
    { code: 'schema' },
    'junk',
  ];
  it('blocking issues become broken tiles; warnings go to their hero', () => {
    expect(blockingIssues(issues).map((i) => i.code)).toEqual(['invalid_json', 'schema']);
    expect(heroWarnings(issues, 'yura').map((i) => i.code)).toEqual(['unknown_key']);
    expect(heroWarnings(issues, 'berlioz')).toEqual([]);
    expect(blockingIssues(null)).toEqual([]);
  });
  it('recognizes the typed VBook 3.1 error and nothing else', () => {
    expect(unsupportedVbook({ status: 409, body: { error: 'unsupported_vbook_version', vbook_version: '3.1', supported: 4 } }))
      .toEqual({ version: '3.1', supported: 4 });
    expect(unsupportedVbook({ body: { error: 'unsupported_vbook_version' } })).toEqual({ version: '?', supported: 4 });
    expect(unsupportedVbook({ status: 404, body: { error: 'Book not found' } })).toBeNull();
    expect(unsupportedVbook(new Error('x'))).toBeNull();
    expect(unsupportedVbook(null)).toBeNull();
  });
});
