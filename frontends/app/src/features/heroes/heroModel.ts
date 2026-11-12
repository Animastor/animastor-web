// Hero model — VBook v4 «файл на героя» (animastor-docs
// architecture/VBOOK_FORMAT_V4.md, 05-frontend/HERO_CARD.md).
//
// A hero is ONE object everywhere: characters/<id>.json on disk, book.heroes[]
// in memory, heroes[] in GET /book. This module is the pure half of the hero
// card: types, ordering, the editable draft and its diff into PATCH fields.
// No I/O, no DOM — Android parity lives in repository/HeroModel.kt with the
// same fixtures (HERO_CARD.md §8).

export type RefState = 'ok' | 'missing' | 'mismatch';

export interface HeroPassport {
  appearance?: string | null;
  clothes?: string | null;
  video_tokens?: string[] | null;
  [key: string]: unknown;
}

export interface VoiceReference {
  file: string;
  sha256: string;
  ref_text?: string;
  source?: 'designed' | 'uploaded' | string;
  model?: string;
  seed?: number;
  verification?: string;
  locked?: boolean;
  [key: string]: unknown;
}

export interface HeroVoice {
  timbre?: string | null;
  manner?: string | null;
  reference?: VoiceReference | null;
  /** Computed by the server, never stored. */
  reference_state?: RefState | null;
  [key: string]: unknown;
}

export interface HeroReaction {
  trigger?: string | null;
  reaction?: string | null;
  [key: string]: unknown;
}

export interface HeroBehaviourProfile {
  baseline?: string | null;
  quirks?: string[] | null;
  reactions?: HeroReaction[] | null;
  [key: string]: unknown;
}

/** Behaviour rule of a hero — no scope / character_id (implied by the file). */
export interface HeroRule {
  id: string;
  when?: { emotion?: string[]; unit_type?: string[] } | null;
  then?: { action?: string } | null;
  strength?: number;
  probability?: number;
  cooldown_iu?: number;
  priority?: number;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface HeroBehaviour {
  profile?: HeroBehaviourProfile | null;
  rules?: HeroRule[] | null;
}

export interface HeroImageRef {
  file: string;
  sha256: string;
  kind?: 'portrait' | 'full_body' | 'other' | string;
  source?: 'generated' | 'uploaded' | string;
  locked?: boolean;
  note?: string;
  /** Computed by the server, never stored. */
  state?: RefState | null;
  [key: string]: unknown;
}

/** Fields a look replaces — each one REPLACES the base passport field as a whole. */
export interface LookFields {
  appearance?: string;
  clothes?: string;
  video_tokens?: string[];
}

/** Named look of a hero — a passport override (VBOOK_FORMAT_V4.md §4a). */
export interface HeroLook {
  id: string;
  label: string;
  fields: LookFields;
  image_ref?: HeroImageRef | null;
  notes?: string;
  evidence?: { quote?: string; basis?: string; status?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface Hero {
  schema?: string;
  id: string;
  name?: string | null;
  role?: string | null;
  aliases?: string[] | null;
  passport?: HeroPassport | null;
  looks?: HeroLook[] | null;
  voice?: HeroVoice | null;
  behaviour?: HeroBehaviour | null;
  image_refs?: HeroImageRef[] | null;
  notes?: string | null;
  /** Computed by the server (optimistic lock), never stored. */
  rev?: string | null;
  [key: string]: unknown;
}

/** A hero file problem reported by the loader (VBOOK_FORMAT_V4.md §10.3). */
export interface HeroIssue {
  file?: string | null;
  hero_id?: string | null;
  code: string;
  message?: string | null;
  blocking?: boolean;
}

/** Global behaviour document — behaviour.json. */
export interface BehaviourGlobals {
  schema?: string;
  defaults?: { max_per_scene?: number; [key: string]: unknown } | null;
  rules?: HeroRule[] | null;
  [key: string]: unknown;
}

export const NARRATOR_ID = 'narrator';
export const HERO_ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const HERO_ID_MAX = 64;
export const RESERVED_HERO_IDS: readonly string[] = [
  'manifest', 'book', 'bible', 'locations', 'voices', 'characters', 'behavior', 'behaviour', 'mentions', 'index',
];
export const VIDEO_TOKENS_MAX = 4;
export const ALIASES_MAX = 64;

/** Emotion dictionary of unit.state (VBOOK_BEHAVIOUR.md §3) — rule `when.emotion`. */
export const BEHAVIOUR_EMOTIONS: readonly string[] = [
  'neutral', 'joyful', 'sad', 'angry', 'afraid', 'surprised', 'disgusted', 'embarrassed',
  'anxious', 'proud', 'confused', 'determined', 'thoughtful', 'tender', 'tense',
];

export type HeroKind = 'narrator' | 'character' | 'voice_only';

export function isNarrator(hero: Pick<Hero, 'id'>): boolean {
  return hero.id === NARRATOR_ID;
}

/** character = has a passport (a real on-screen person); otherwise voice only. */
export function heroKind(hero: Hero): HeroKind {
  if (isNarrator(hero)) return 'narrator';
  return hero.passport ? 'character' : 'voice_only';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Heroes of a book in display order: the narrator first, then the server
 * order (book.json structure.characters_order is applied server-side).
 * Entries without a string id are dropped — a card must be addressable.
 */
export function orderHeroes(raw: unknown): Hero[] {
  if (!Array.isArray(raw)) return [];
  const heroes = raw.filter((h): h is Hero => isPlainObject(h) && typeof h.id === 'string' && h.id !== '');
  const narrators = heroes.filter(isNarrator);
  return [...narrators.slice(0, 1), ...heroes.filter((h) => !isNarrator(h))];
}

export function findHero(heroes: Hero[], id: string | null | undefined): Hero | null {
  if (!id) return null;
  return heroes.find((h) => h.id === id) ?? null;
}

/** Card portrait: the first image ref of kind "portrait", else the first ref. */
export function portraitIndex(hero: Hero): number {
  const refs = hero.image_refs ?? [];
  if (refs.length === 0) return -1;
  const i = refs.findIndex((r) => r?.kind === 'portrait');
  return i >= 0 ? i : 0;
}

/** Monogram for the empty portrait frame: up to two initials of name, else id. */
export function heroMonogram(hero: Hero): string {
  const source = (hero.name ?? '').trim() || hero.id;
  const words = source.split(/[\s_\-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** The text TTS receives while there is no reference: join(timbre, manner). */
export function voiceInstruct(voice: HeroVoice | null | undefined): string {
  if (!voice) return '';
  return [voice.timbre, voice.manner].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}

export type ReferenceStatus = 'none' | 'candidate' | 'pinned' | 'missing' | 'mismatch';

/**
 * One status word for the voice reference badge:
 *   none      — no reference in the hero file
 *   missing / mismatch — the file is gone or its sha256 differs (regenerate by command)
 *   pinned    — locked and intact
 *   candidate — referenced but not locked
 */
export function referenceStatus(voice: HeroVoice | null | undefined): ReferenceStatus {
  const ref = voice?.reference;
  if (!ref) return 'none';
  if (voice?.reference_state === 'missing') return 'missing';
  if (voice?.reference_state === 'mismatch') return 'mismatch';
  return ref.locked ? 'pinned' : 'candidate';
}

export interface HeroStats {
  /** Filled passport fields out of 3 (appearance, clothes, video_tokens); null without a passport. */
  passport: number | null;
  /** Filled voice fields out of 2 (timbre, manner); null without a voice. */
  voice: number | null;
  reference: ReferenceStatus;
  rulesOn: number;
  rulesTotal: number;
  aliases: number;
  images: number;
}

function filled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === 'string' && x.trim() !== '');
  return typeof v === 'string' && v.trim() !== '';
}

/** The "characteristics" row of a grid card. */
export function heroStats(hero: Hero): HeroStats {
  const p = hero.passport;
  const v = hero.voice;
  const rules = hero.behaviour?.rules ?? [];
  return {
    passport: p ? [p.appearance, p.clothes, p.video_tokens].filter(filled).length : null,
    voice: v ? [v.timbre, v.manner].filter(filled).length : null,
    reference: referenceStatus(v),
    rulesOn: rules.filter((r) => r && r.enabled !== false).length,
    rulesTotal: rules.length,
    aliases: (hero.aliases ?? []).length,
    images: (hero.image_refs ?? []).length,
  };
}

// ── New hero id ──────────────────────────────────────────────────────────

export type HeroIdError = 'hero_id_invalid' | 'hero_id_reserved' | 'hero_id_taken';

/**
 * Validate an id typed into the add dialog. An empty id is fine — the server
 * derives it from the name (transliteration is never duplicated on the client).
 */
export function validateNewHeroId(id: string, existing: Iterable<string>): HeroIdError | null {
  const value = id.trim();
  if (value === '') return null;
  if (!HERO_ID_RE.test(value) || value.length > HERO_ID_MAX) return 'hero_id_invalid';
  if (RESERVED_HERO_IDS.includes(value)) return 'hero_id_reserved';
  for (const e of existing) if (e === value) return 'hero_id_taken';
  return null;
}

// ── Line-based text ⇄ arrays (same round-trip rules as the old Behavior tab) ──

export function linesToText(items: readonly (string | null | undefined)[] | null | undefined): string {
  return (items ?? []).filter((s): s is string => typeof s === 'string').join('\n');
}

export function textToLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Unique lines; uniqueness ignores case and surrounding spaces, first spelling wins. */
export function textToUniqueLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of textToLines(text)) {
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function tokensToText(tokens: readonly string[] | string | null | undefined): string {
  if (typeof tokens === 'string') return tokens;
  return (tokens ?? []).filter((s) => typeof s === 'string').join(', ');
}

export function textToTokens(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

export function reactionsToText(reactions: readonly HeroReaction[] | null | undefined): string {
  return (reactions ?? []).map((r) => {
    const trigger = (r?.trigger ?? '').trim();
    const reaction = (r?.reaction ?? '').trim();
    return reaction ? `${trigger} → ${reaction}` : trigger;
  }).join('\n');
}

/**
 * "trigger → reaction" per line ("→" or "->", the earliest separator wins); a
 * line without a separator keeps the whole text as the trigger with an empty
 * reaction. Same rules as the former Behavior tab and Android.
 */
export function textToReactions(text: string): HeroReaction[] {
  return textToLines(text).map((line) => {
    const seps = [line.indexOf('→'), line.indexOf('->')].filter((i) => i >= 0);
    if (seps.length === 0) return { trigger: line, reaction: null };
    const at = Math.min(...seps);
    const sepLen = line[at] === '→' ? 1 : 2;
    return { trigger: line.slice(0, at).trim(), reaction: line.slice(at + sepLen).trim() || null };
  });
}

// ── Draft ────────────────────────────────────────────────────────────────

/** Editable copy of a hero: every field is text, blocks are toggled by flags. */
export interface HeroDraft {
  name: string;
  role: string;
  aliases: string;
  notes: string;
  hasPassport: boolean;
  appearance: string;
  clothes: string;
  videoTokens: string;
  hasVoice: boolean;
  timbre: string;
  manner: string;
  baseline: string;
  quirks: string;
  reactions: string;
}

export function draftFromHero(hero: Hero): HeroDraft {
  const p = hero.passport;
  const v = hero.voice;
  const profile = hero.behaviour?.profile;
  return {
    name: hero.name ?? '',
    role: hero.role ?? '',
    aliases: linesToText(hero.aliases),
    notes: hero.notes ?? '',
    hasPassport: !!p,
    appearance: p?.appearance ?? '',
    clothes: p?.clothes ?? '',
    videoTokens: tokensToText(p?.video_tokens),
    hasVoice: !!v,
    timbre: v?.timbre ?? '',
    manner: v?.manner ?? '',
    baseline: profile?.baseline ?? '',
    quirks: linesToText(profile?.quirks),
    reactions: reactionsToText(profile?.reactions),
  };
}

export type HeroDraftError = 'hero_err_name_required' | 'hero_err_tokens_max' | 'hero_err_aliases_max' | 'hero_err_alias_is_name';

export function validateDraft(hero: Hero, draft: HeroDraft): HeroDraftError[] {
  const errors: HeroDraftError[] = [];
  // A hero with a passport is shown to people by name; the narrator and
  // voice-only heroes may stay unnamed (the id is shown instead).
  if (draft.hasPassport && draft.name.trim() === '' && !isNarrator(hero)) errors.push('hero_err_name_required');
  if (draft.hasPassport && textToTokens(draft.videoTokens).length > VIDEO_TOKENS_MAX) errors.push('hero_err_tokens_max');
  const aliases = textToUniqueLines(draft.aliases);
  if (aliases.length > ALIASES_MAX) errors.push('hero_err_aliases_max');
  const name = draft.name.trim().toLocaleLowerCase();
  if (name && aliases.some((a) => a.toLocaleLowerCase() === name)) errors.push('hero_err_alias_is_name');
  return errors;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Draft → PATCH /heroes/:id `fields` — ONLY what the user changed.
 *
 * Text fields compare against the stored value; list fields compare after
 * round-tripping the stored array through the same text form the card renders,
 * so an untouched card never rewrites an array (unknown keys inside stored
 * reactions survive). An empty text clears the field (null). Removing a block
 * sends `passport: null` / `voice: null`; a block added in the draft sends its
 * fields, which creates it server-side.
 */
export function diffDraft(hero: Hero, draft: HeroDraft): Record<string, unknown> {
  const orig = draftFromHero(hero);
  const fields: Record<string, unknown> = {};
  const text = (key: string, next: string, prev: string) => {
    if (next !== prev) fields[key] = next.trim() === '' ? null : next;
  };

  text('name', draft.name, orig.name);
  text('role', draft.role, orig.role);
  text('notes', draft.notes, orig.notes);
  if (draft.aliases !== orig.aliases) {
    const next = textToUniqueLines(draft.aliases);
    if (!sameList(next, hero.aliases ?? [])) fields.aliases = next;
  }

  if (!draft.hasPassport) {
    if (orig.hasPassport) fields.passport = null;
  } else {
    text('passport.appearance', draft.appearance, orig.appearance);
    text('passport.clothes', draft.clothes, orig.clothes);
    if (draft.videoTokens !== orig.videoTokens) fields['passport.video_tokens'] = textToTokens(draft.videoTokens);
    // A block added empty still has to be created.
    if (!orig.hasPassport && !Object.keys(fields).some((k) => k.startsWith('passport.'))) fields.passport = {};
  }

  if (!draft.hasVoice) {
    if (orig.hasVoice) fields.voice = null;
  } else {
    text('voice.timbre', draft.timbre, orig.timbre);
    text('voice.manner', draft.manner, orig.manner);
    if (!orig.hasVoice && !Object.keys(fields).some((k) => k.startsWith('voice.'))) fields.voice = {};
  }

  text('behaviour.profile.baseline', draft.baseline, orig.baseline);
  if (draft.quirks !== orig.quirks) fields['behaviour.profile.quirks'] = textToLines(draft.quirks);
  if (draft.reactions !== orig.reactions) fields['behaviour.profile.reactions'] = textToReactions(draft.reactions);

  return fields;
}

export function isDraftDirty(hero: Hero, draft: HeroDraft): boolean {
  return Object.keys(diffDraft(hero, draft)).length > 0;
}

// ── Rules ────────────────────────────────────────────────────────────────

/** A unique rule id "<hero>.<slug>" that is free among the book's rule ids. */
export function newRuleId(heroId: string, action: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = action.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').split('_').slice(0, 3).join('_') || 'rule';
  const base = `${heroId}.${slug}`;
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}

/** Every rule id of the book: global rules + rules of all heroes. */
export function allRuleIds(heroes: Hero[], globals: BehaviourGlobals | null | undefined): string[] {
  const ids: string[] = [];
  for (const r of globals?.rules ?? []) if (r?.id) ids.push(r.id);
  for (const h of heroes) for (const r of h.behaviour?.rules ?? []) if (r?.id) ids.push(r.id);
  return ids;
}

// ── Issues ───────────────────────────────────────────────────────────────

export function blockingIssues(issues: unknown): HeroIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter((i): i is HeroIssue => isPlainObject(i) && typeof i.code === 'string' && i.blocking !== false);
}

export function heroWarnings(issues: unknown, heroId: string): HeroIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter((i): i is HeroIssue =>
    isPlainObject(i) && typeof i.code === 'string' && i.blocking === false && i.hero_id === heroId);
}

// ── Unsupported book version (VBOOK_FORMAT_V4.md §9) ─────────────────────

export interface UnsupportedVbook {
  version: string;
  supported: number;
}

/** The typed "book is VBook 3.1" error of GET /book and import, or null. */
export function unsupportedVbook(err: unknown): UnsupportedVbook | null {
  const body = (err as { body?: unknown } | null)?.body;
  if (!isPlainObject(body) || body.error !== 'unsupported_vbook_version') return null;
  const version = body.vbook_version;
  return {
    version: typeof version === 'string' || typeof version === 'number' ? String(version) : '?',
    supported: typeof body.supported === 'number' ? body.supported : 4,
  };
}

// ── Looks (passport overrides, VBOOK_FORMAT_V4.md §4a) ────────────────────

export const BASE_LOOK = 'base';
export const LOOK_FIELDS = ['appearance', 'clothes', 'video_tokens'] as const;
export type LookField = typeof LOOK_FIELDS[number];

/** The parts of a chapter / scene the resolver reads. */
export interface LookChapter {
  chapter_id?: string | null;
  chapter_title?: string | null;
  display_number?: number | null;
  looks?: Record<string, string> | null;
  scenes?: LookScene[] | null;
}
export interface LookScene {
  scene_id?: string | null;
  scene_title?: string | null;
  display_index?: number | null;
  participants?: string[] | null;
  looks?: Record<string, string> | null;
  look_patch?: Record<string, LookPatch | null> | null;
}
/** One-off scene patch as it arrives from the API (nulls tolerated). */
export interface LookPatch {
  appearance?: string | null;
  clothes?: string | null;
  video_tokens?: string[] | string | null;
}

export interface LookValues {
  appearance: string;
  clothes: string;
  video_tokens: string[];
}

export interface ResolvedLook extends LookValues {
  hero_id: string;
  /** Look id, or "base". */
  look_id: string;
  /** Where the look was taken from. */
  source: 'scene' | 'chapter' | 'base';
  base: LookValues;
  /** Fields that differ from the base passport. */
  changed: LookField[];
  /** Fields that came from the scene's one-off patch. */
  patched: LookField[];
  image_ref: HeroImageRef | null;
  warnings: string[];
}

function baseValues(hero: Hero): LookValues {
  const p = hero.passport ?? {};
  const tokens = p.video_tokens;
  return {
    appearance: typeof p.appearance === 'string' ? p.appearance : '',
    clothes: typeof p.clothes === 'string' ? p.clothes : '',
    video_tokens: Array.isArray(tokens) ? tokens.filter((x): x is string => typeof x === 'string') : [],
  };
}

function applyFields(target: LookValues, fields: LookPatch | null | undefined): LookField[] {
  const applied: LookField[] = [];
  if (!fields) return applied;
  if (typeof fields.appearance === 'string' && fields.appearance !== '') { target.appearance = fields.appearance; applied.push('appearance'); }
  if (typeof fields.clothes === 'string' && fields.clothes !== '') { target.clothes = fields.clothes; applied.push('clothes'); }
  if (Array.isArray(fields.video_tokens) && fields.video_tokens.length > 0) { target.video_tokens = [...fields.video_tokens]; applied.push('video_tokens'); }
  return applied;
}

function changedFields(a: LookValues, b: LookValues): LookField[] {
  return LOOK_FIELDS.filter((f) => (f === 'video_tokens' ? !sameList(a.video_tokens, b.video_tokens) : a[f] !== b[f]));
}

export function findLook(hero: Hero, lookId: string | null | undefined): HeroLook | null {
  if (!lookId || lookId === BASE_LOOK) return null;
  return (hero.looks ?? []).find((l) => l?.id === lookId) ?? null;
}

/**
 * The final look of a hero in a scene — client copy of vbook-runtime
 * resolveHeroLook (same cases, same fixtures):
 *   scene.looks[id] → chapter.looks[id] → base; then the look's fields over
 *   the passport; then scene.look_patch[id] over the result.
 * An unknown look id is skipped with a warning. null — no passport, no look.
 */
export function resolveLook(hero: Hero, chapter?: LookChapter | null, scene?: LookScene | null): ResolvedLook | null {
  if (!hero.passport) return null;
  const base = baseValues(hero);
  const warnings: string[] = [];
  let lookId = BASE_LOOK;
  let source: ResolvedLook['source'] = 'base';
  let look: HeroLook | null = null;
  const candidates: [ResolvedLook['source'], string | undefined][] = [
    ['scene', scene?.looks?.[hero.id]],
    ['chapter', chapter?.looks?.[hero.id]],
  ];
  for (const [from, id] of candidates) {
    if (!id) continue;
    if (id === BASE_LOOK) { source = from; break; }
    const found = findLook(hero, id);
    if (found) { look = found; lookId = id; source = from; break; }
    warnings.push(`unknown_look:${id}`);
  }
  const values: LookValues = { ...base, video_tokens: [...base.video_tokens] };
  applyFields(values, look?.fields);
  const patched = applyFields(values, scene?.look_patch?.[hero.id]);
  return {
    hero_id: hero.id, look_id: lookId, source, ...values, base,
    changed: changedFields(values, base), patched,
    image_ref: look?.image_ref ?? null, warnings,
  };
}

/** A look as the card shows it: its fields over the base passport, no scene context. */
export function previewLook(hero: Hero, lookId: string): ResolvedLook | null {
  return resolveLook(hero, null, lookId === BASE_LOOK ? null : { looks: { [hero.id]: lookId } });
}

export interface LookPlace {
  chapterId: string;
  /** null — the whole chapter. */
  sceneId: string | null;
  chapterNumber: number | null;
  chapterTitle: string;
  sceneNumber: number | null;
  sceneTitle: string;
}

/**
 * Where each look of a hero is assigned: look id → chapters and scenes that
 * REFERENCE it (a scene inside an assigned chapter is not repeated). The key
 * "base" lists scenes that force the base passport against their chapter.
 */
export function lookUsage(chapters: readonly LookChapter[] | null | undefined, heroId: string): Record<string, LookPlace[]> {
  const out: Record<string, LookPlace[]> = {};
  const add = (id: string, place: LookPlace) => { (out[id] ??= []).push(place); };
  (chapters ?? []).forEach((ch, ci) => {
    const chapterId = ch?.chapter_id;
    if (!chapterId) return;
    const head = { chapterId, chapterNumber: ch.display_number ?? ci + 1, chapterTitle: ch.chapter_title ?? '' };
    const own = ch.looks?.[heroId];
    if (own) add(own, { ...head, sceneId: null, sceneNumber: null, sceneTitle: '' });
    (ch.scenes ?? []).forEach((sc, si) => {
      const id = sc?.looks?.[heroId];
      if (!id || !sc.scene_id) return;
      add(id, { ...head, sceneId: sc.scene_id, sceneNumber: sc.display_index ?? si + 1, sceneTitle: sc.scene_title ?? '' });
    });
  });
  return out;
}

export type LookIdError = 'look_id_invalid' | 'look_id_reserved' | 'look_id_taken';

/** Id typed for a new look; empty is fine — the server derives it from the label. */
export function validateNewLookId(id: string, hero: Hero): LookIdError | null {
  const value = id.trim();
  if (value === '') return null;
  if (!HERO_ID_RE.test(value) || value.length > HERO_ID_MAX) return 'look_id_invalid';
  if (value === BASE_LOOK) return 'look_id_reserved';
  if ((hero.looks ?? []).some((l) => l?.id === value)) return 'look_id_taken';
  return null;
}

/** Editable copy of a look: an empty field means "as in the base passport". */
export interface LookDraft {
  label: string;
  notes: string;
  appearance: string;
  clothes: string;
  videoTokens: string;
}

export function draftFromLook(look: HeroLook | null): LookDraft {
  return {
    label: look?.label ?? '',
    notes: look?.notes ?? '',
    appearance: look?.fields?.appearance ?? '',
    clothes: look?.fields?.clothes ?? '',
    videoTokens: tokensToText(look?.fields?.video_tokens),
  };
}

/** Draft → `fields` of a look (only what the look really overrides). */
export function lookFieldsFromDraft(draft: LookDraft): LookFields {
  const fields: LookFields = {};
  if (draft.appearance.trim() !== '') fields.appearance = draft.appearance.trim();
  if (draft.clothes.trim() !== '') fields.clothes = draft.clothes.trim();
  const tokens = textToTokens(draft.videoTokens);
  if (tokens.length > 0) fields.video_tokens = tokens;
  return fields;
}

export type LookDraftError = 'look_err_label_required' | 'look_err_empty' | 'hero_err_tokens_max';

export function validateLookDraft(draft: LookDraft): LookDraftError[] {
  const errors: LookDraftError[] = [];
  if (draft.label.trim() === '') errors.push('look_err_label_required');
  const fields = lookFieldsFromDraft(draft);
  if (Object.keys(fields).length === 0) errors.push('look_err_empty');
  if ((fields.video_tokens?.length ?? 0) > VIDEO_TOKENS_MAX) errors.push('hero_err_tokens_max');
  return errors;
}

/** Draft → PATCH /looks/:id `fields`: only changes; null removes a field from the look. */
export function diffLook(look: HeroLook, draft: LookDraft): Record<string, unknown> {
  const orig = draftFromLook(look);
  const out: Record<string, unknown> = {};
  if (draft.label.trim() !== orig.label) out.label = draft.label.trim();
  if (draft.notes !== orig.notes) out.notes = draft.notes;
  if (draft.appearance.trim() !== orig.appearance) out['fields.appearance'] = draft.appearance.trim() || null;
  if (draft.clothes.trim() !== orig.clothes) out['fields.clothes'] = draft.clothes.trim() || null;
  if (draft.videoTokens !== orig.videoTokens) {
    const tokens = textToTokens(draft.videoTokens);
    if (!sameList(tokens, look.fields?.video_tokens ?? [])) out['fields.video_tokens'] = tokens.length > 0 ? tokens : null;
  }
  return out;
}

export interface LookAssignment {
  chapters: string[];
  scenes: { chapter_id: string; scene_id: string }[];
}

const placeKey = (chapterId: string, sceneId: string | null): string => `${chapterId}/${sceneId ?? ''}`;

/**
 * The assign dialog: places checked now vs. places that reference the look →
 * what to assign and what to release (two calls of POST /looks/assign).
 */
export function diffAssignment(current: readonly LookPlace[], checked: ReadonlySet<string>): { assign: LookAssignment; release: LookAssignment } {
  const had = new Set(current.map((p) => placeKey(p.chapterId, p.sceneId)));
  const split = (keys: string[]): LookAssignment => {
    const out: LookAssignment = { chapters: [], scenes: [] };
    for (const key of keys) {
      const at = key.indexOf('/');
      const chapterId = key.slice(0, at);
      const sceneId = key.slice(at + 1);
      if (sceneId) out.scenes.push({ chapter_id: chapterId, scene_id: sceneId }); else out.chapters.push(chapterId);
    }
    return out;
  };
  return {
    assign: split([...checked].filter((k) => !had.has(k))),
    release: split([...had].filter((k) => !checked.has(k))),
  };
}

export { placeKey as lookPlaceKey };

export function isEmptyAssignment(a: LookAssignment): boolean {
  return a.chapters.length === 0 && a.scenes.length === 0;
}
