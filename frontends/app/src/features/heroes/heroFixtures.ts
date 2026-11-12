// Shared hero fixtures — the same objects as animastor-docs
// architecture/schemas/examples/*.json (Android HeroModelTest uses them too).
import type { BehaviourGlobals, Hero, LookChapter } from './heroModel';

export const yura: Hero = {
  schema: 'animastor.character/1',
  id: 'yura',
  name: 'Юра',
  role: 'protagonist',
  aliases: ['Юрий', 'Юрка'],
  passport: {
    appearance: 'man in his early thirties, short dark hair',
    clothes: 'worn brown leather jacket',
    video_tokens: ['man', 'dark hair', 'leather jacket'],
  },
  looks: [
    { id: 'coat', label: 'В пальто', fields: { clothes: 'long dark grey wool coat', video_tokens: ['man', 'grey coat'] }, image_ref: null },
    { id: 'beard', label: 'С бородой', fields: { appearance: 'man in his early thirties, thick dark beard' }, image_ref: null },
  ],
  voice: {
    timbre: 'A Russian male voice in his early thirties, warm low baritone.',
    manner: 'Speaks unhurriedly, pauses before important words.',
    reference: {
      file: 'voices/yura/ref_02.wav',
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      ref_text: 'Я вернулся домой поздно вечером.',
      source: 'designed',
      model: 'qwen3-tts-voicedesign',
      seed: 421337,
      verification: 'passed',
      locked: true,
    },
    reference_state: 'ok',
  },
  behaviour: {
    profile: {
      baseline: 'calm, attentive',
      quirks: ['rubs the bridge of his nose when thinking'],
      reactions: [{ trigger: 'is praised', reaction: 'looks away', weight: 2 }],
    },
    rules: [
      { id: 'yura.praised', when: { emotion: ['proud', 'embarrassed'] }, then: { action: 'looks away and rubs the bridge of his nose' }, probability: 0.6, enabled: true },
      { id: 'yura.angry', when: { emotion: ['angry'] }, then: { action: 'goes silent' }, probability: 0.3, enabled: false },
    ],
  },
  image_refs: [
    { file: 'refs/images/yura/full_01.png', sha256: 'a'.repeat(64), kind: 'full_body', state: 'ok' },
    { file: 'refs/images/yura/portrait_01.png', sha256: 'b'.repeat(64), kind: 'portrait', state: 'ok' },
  ],
  notes: 'В третьей главе меняет куртку на пальто.',
  rev: '0123456789abcdef',
};

export const narrator: Hero = {
  schema: 'animastor.character/1',
  id: 'narrator',
  role: 'narrator',
  voice: { timbre: 'A mature Russian male voice, deep and calm.', manner: 'Slow, reflective literary narration.' },
  rev: 'aaaaaaaaaaaaaaaa',
};

export const shopWomen: Hero = {
  schema: 'animastor.character/1',
  id: 'shop_women',
  name: 'Женщина в будочке',
  voice: { timbre: 'A middle-aged Russian female voice, sharp.', manner: 'Irritated, clipped phrases.' },
  rev: 'bbbbbbbbbbbbbbbb',
};

export const globals: BehaviourGlobals = {
  schema: 'animastor.behaviour-globals/1',
  defaults: { max_per_scene: 2 },
  rules: [{ id: 'global.joyful_smile', when: { emotion: ['joyful'] }, then: { action: 'breaks into a wide smile' } }],
};

/** Three chapters: ch-1 nothing, ch-2 «coat» for the chapter with one scene back to base, ch-3 one scene with «beard». */
export const chapters: LookChapter[] = [
  { chapter_id: 'ch-000001', chapter_title: 'Пролог', display_number: 1, scenes: [
    { scene_id: 'sc-000011', display_index: 1, participants: ['yura'] },
  ] },
  { chapter_id: 'ch-000002', chapter_title: '', display_number: 2, looks: { yura: 'coat' }, scenes: [
    { scene_id: 'sc-000021', display_index: 1, participants: ['yura'] },
    { scene_id: 'sc-000022', display_index: 2, scene_title: 'Дома', participants: ['yura'], looks: { yura: 'base' } },
    { scene_id: 'sc-000023', display_index: 3, participants: ['shop_women'] },
  ] },
  { chapter_id: 'ch-000003', chapter_title: 'Зима', display_number: 3, scenes: [
    { scene_id: 'sc-000031', display_index: 1, participants: ['yura'], looks: { yura: 'beard' }, look_patch: { yura: { video_tokens: ['man', 'beard', 'scarf'] } } },
  ] },
];
