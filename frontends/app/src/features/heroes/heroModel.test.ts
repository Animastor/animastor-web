// Hero model — pure logic of the hero card (HERO_CARD.md §4, §5).
import { describe, expect, it } from 'vitest';
import {
  allRuleIds, blockingIssues, brokenFileTarget, canDeleteCandidate, canPinCandidate, candidateLine, diffDraft,
  dirtySummary, duplicateWarnings, unknownParticipants, draftFromHero, heroKind, heroMonogram, heroStats, heroWarnings,
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

// ── Step 4 contract helpers (HERO_CARD.md §7, §10) ─────────────────────────

describe('step 4 helpers', () => {
  it('canPinCandidate: only ready + passed, never the pinned one', () => {
    expect(canPinCandidate({ status: 'ready', verification: 'passed' })).toBe(true);
    expect(canPinCandidate({ status: 'ready', verification: 'failed' })).toBe(false);
    expect(canPinCandidate({ status: 'ready', verification: 'user' })).toBe(false);
    expect(canPinCandidate({ status: 'pending', verification: 'passed' })).toBe(false);
    expect(canPinCandidate({ status: 'ready', verification: 'passed', pinned: true })).toBe(false);
    expect(canDeleteCandidate({ status: 'pending' })).toBe(false);
    expect(canDeleteCandidate({ status: 'ready', pinned: true })).toBe(false);
    expect(canDeleteCandidate({ status: 'failed' })).toBe(true);
  });
  it('candidateLine: pending / failed (error) / passed / rejected (problems)', () => {
    expect(candidateLine({ status: 'pending' })).toEqual({ key: 'hero_ref_cand_pending', detail: '' });
    expect(candidateLine({ status: 'failed', error: 'timeout' })).toEqual({ key: 'hero_ref_cand_failed', detail: 'timeout' });
    expect(candidateLine({ status: 'ready', verification: 'passed' })).toEqual({ key: 'hero_ref_cand_passed', detail: '' });
    expect(candidateLine({ status: 'ready', verification: 'failed', verification_problems: ['too_short', 'asr_mismatch'] }))
      .toEqual({ key: 'hero_ref_cand_rejected', detail: 'too_short, asr_mismatch' });
  });
  it('duplicateWarnings: only possible_duplicate of this hero, evidence cleaned', () => {
    const issues = [
      { code: 'possible_duplicate', hero_id: 'koroviev', of: 'fagot', evidence: ['клетчатый', '', 3], blocking: false },
      { code: 'possible_duplicate', hero_id: 'fagot', of: 'koroviev', blocking: false },
      { code: 'unknown_key', hero_id: 'koroviev', blocking: false },
    ];
    expect(duplicateWarnings(issues, 'koroviev')).toEqual([{ of: 'fagot', evidence: ['клетчатый'] }]);
    expect(duplicateWarnings(issues, 'fagot')).toEqual([{ of: 'koroviev', evidence: [] }]);
    expect(duplicateWarnings(null, 'x')).toEqual([]);
  });
  it('heroWarnings leaves possible_duplicate to its own line', () => {
    const issues = [{ code: 'possible_duplicate', hero_id: 'a', of: 'b', blocking: false }, { code: 'unknown_key', hero_id: 'a', blocking: false }];
    expect(heroWarnings(issues, 'a').map((i) => i.code)).toEqual(['unknown_key']);
  });
  it('unknownParticipants: the participant with its scenes', () => {
    const issues = [{ code: 'unknown_participant', participant: 'berlioz', message: 'm', scenes: [{ chapter_id: 'c1', scene_id: 's1' }, { bad: 1 }], blocking: false }];
    expect(unknownParticipants(issues)).toEqual([{ participant: 'berlioz', message: 'm', scenes: [{ chapter_id: 'c1', scene_id: 's1' }] }]);
  });
  it('brokenFileTarget: by hero id, else by the plain file name', () => {
    expect(brokenFileTarget({ code: 'invalid_json', hero_id: 'anna', file: 'characters/anna.json' })).toEqual({ kind: 'hero', heroId: 'anna' });
    expect(brokenFileTarget({ code: 'invalid_file_name', file: 'characters/Юра.json' })).toEqual({ kind: 'file', file: 'Юра.json' });
    expect(brokenFileTarget({ code: 'x', file: 'characters/sub/a.json' })).toBeNull();
    expect(brokenFileTarget({ code: 'x' })).toBeNull();
  });
  it('dirtySummary: unique scenes and layers', () => {
    expect(dirtySummary([
      { chapter_id: 'c1', scene_id: 's1', dirty_layers: ['video', 'image'] },
      { chapter_id: 'c1', scene_id: 's1', dirty_layers: ['image'] },
      { chapter_id: 'c2', scene_id: 's1' },
    ])).toEqual({ scenes: 2, layers: ['image', 'video'] });
    expect(dirtySummary(undefined)).toEqual({ scenes: 0, layers: [] });
  });
  it('validateDraft: removing the passport of a hero with looks is an error (400 invalid_character)', () => {
    const hero = { id: 'yura', name: 'Юра', passport: { appearance: 'a' }, looks: [{ id: 'coat', label: 'c', fields: { clothes: 'x' } }] };
    const draft = { ...draftFromHero(hero), hasPassport: false };
    expect(validateDraft(hero, draft)).toContain('hero_err_passport_has_looks');
    expect(validateDraft({ ...hero, looks: [] }, draft)).not.toContain('hero_err_passport_has_looks');
  });
});
