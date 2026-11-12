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

export interface Hero {
  schema?: string;
  id: string;
  name?: string | null;
  role?: string | null;
  aliases?: string[] | null;
  passport?: HeroPassport | null;
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
