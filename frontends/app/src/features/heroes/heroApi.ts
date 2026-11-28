// Hero API — the write side of the hero card (animastor-docs
// architecture/VBOOK_FORMAT_V4.md §8.2, 05-frontend/HERO_CARD.md §6).
//
// One hero = one resource. After every successful mutation the caller re-reads
// GET /book (the backend is the single source of truth — parity rule 2); this
// module never patches local state.
//
// Generation endpoints (designVoiceCandidates) carry `client_action` exactly
// like POST /generate: they may be called from a click handler only.
import { deleteJson, getJson, mediaUrl, patchJson, postForm, postJson } from '../../api/client';
import type { DirtyScene, Hero, HeroRule, LookAssignment, LookFields, VoiceReference } from './heroModel';

const book = (bookId: string): string => `/book/${encodeURIComponent(bookId)}`;
const hero = (bookId: string, heroId: string): string => `${book(bookId)}/heroes/${encodeURIComponent(heroId)}`;

export interface CreateHeroBody {
  id?: string;
  name?: string;
  role?: string;
  passport?: Record<string, unknown>;
  voice?: Record<string, unknown>;
}

/** 201 `{hero_id, hero, rev}` (VBOOK_FORMAT_V4.md §12е). */
export interface CreateHeroResult {
  hero_id: string;
  hero?: Hero;
  rev?: string;
}

export function createHero(bookId: string, body: CreateHeroBody): Promise<CreateHeroResult> {
  return postJson(`${book(bookId)}/heroes`, body);
}

/** 200 of a hero / look mutation — the scenes whose image / video became stale. */
export interface HeroMutationResult {
  hero?: Hero;
  rev?: string;
  dirty_scenes?: DirtyScene[];
  [key: string]: unknown;
}

/** `ifRev` — optimistic lock: 409 rev_conflict when the hero changed elsewhere. */
export function patchHero(bookId: string, heroId: string, fields: Record<string, unknown>, ifRev?: string | null): Promise<HeroMutationResult> {
  return patchJson(hero(bookId, heroId), ifRev ? { fields, if_rev: ifRev } : { fields });
}

export function deleteHero(bookId: string, heroId: string, opts: { broken?: boolean } = {}): Promise<HeroMutationResult> {
  return deleteJson(hero(bookId, heroId) + (opts.broken ? '?broken=1' : ''));
}

/**
 * A broken file of characters/ whose name is not a hero id (`Юра.json`,
 * `notes.txt`) — only a name listed in the current hero_issues (решение В14).
 * `file` is the plain name, without "characters/".
 */
export function deleteBrokenHeroFile(bookId: string, file: string): Promise<{ deleted: boolean; file: string }> {
  return deleteJson(`${book(bookId)}/hero-files?file=${encodeURIComponent(file)}`);
}

// ── Rules ────────────────────────────────────────────────────────────────

export function createRule(bookId: string, heroId: string, rule: HeroRule): Promise<unknown> {
  return postJson(`${hero(bookId, heroId)}/rules`, rule);
}

export function patchRule(bookId: string, heroId: string, ruleId: string, fields: Partial<HeroRule>): Promise<unknown> {
  return patchJson(`${hero(bookId, heroId)}/rules/${encodeURIComponent(ruleId)}`, { fields });
}

export function deleteRule(bookId: string, heroId: string, ruleId: string): Promise<unknown> {
  return deleteJson(`${hero(bookId, heroId)}/rules/${encodeURIComponent(ruleId)}`);
}

// ── Looks (passport overrides) ───────────────────────────────────────────

export function createLook(bookId: string, heroId: string, body: { id?: string; label: string; fields: LookFields; notes?: string }): Promise<{ look_id: string; dirty_scenes?: DirtyScene[] }> {
  return postJson(`${hero(bookId, heroId)}/looks`, body);
}

export function patchLook(bookId: string, heroId: string, lookId: string, fields: Record<string, unknown>): Promise<HeroMutationResult> {
  return patchJson(`${hero(bookId, heroId)}/looks/${encodeURIComponent(lookId)}`, { fields });
}

/** Deleting a look releases every chapter / scene that referenced it. */
export function deleteLook(bookId: string, heroId: string, lookId: string): Promise<HeroMutationResult> {
  return deleteJson(`${hero(bookId, heroId)}/looks/${encodeURIComponent(lookId)}`);
}

/** lookId: a look id, "base" (scenes only — base passport against the chapter) or null (release). */
export function assignLook(bookId: string, heroId: string, lookId: string | null, places: LookAssignment): Promise<HeroMutationResult> {
  return postJson(`${book(bookId)}/looks/assign`, { hero_id: heroId, look_id: lookId, chapters: places.chapters, scenes: places.scenes });
}

/** Reference image of a look (the slot exists; generation is a future task). */
export function lookImageUrl(bookId: string, heroId: string, lookId: string, sha?: string): string {
  return mediaUrl(`${hero(bookId, heroId)}/looks/${encodeURIComponent(lookId)}/image${sha ? `?v=${sha.slice(0, 12)}` : ''}`);
}

// ── Voice reference (endpoints owned by the reference-voices task) ────────

export type CandidateStatus = 'pending' | 'ready' | 'failed';

/** One candidate of GET …/voice/candidates (VBOOK_FORMAT_V4.md §12е). */
export interface VoiceCandidate extends Partial<Omit<VoiceReference, 'verification' | 'model' | 'seed'>> {
  model?: string | null;
  seed?: number | null;
  /** File name `<candidate_id>.wav` inside build_<book>/voices/<hero>/ — the candidate's address. */
  name: string;
  candidate_id?: string;
  status?: CandidateStatus;
  verification?: 'passed' | 'failed' | string | null;
  verification_problems?: string[];
  ref_text_source?: 'user' | 'asr' | string | null;
  duration_ms?: number | null;
  pinned?: boolean;
  error?: string;
}

export interface VoiceCandidatesResponse {
  candidates: VoiceCandidate[];
  /** A design / upload command is running — the card re-reads the list every 3 s. */
  pending?: boolean;
  reference_status?: string;
  /** The pinned reference was made from another timbre (designed only). */
  reference_outdated?: boolean;
  design_description?: string;
  phrase?: { id: string; version: number; style: string; text: string; language: string } | null;
  duration_bounds_sec?: [number, number];
}

export function listVoiceCandidates(bookId: string, heroId: string): Promise<VoiceCandidatesResponse> {
  return getJson(`${hero(bookId, heroId)}/voice/candidates`, { cache: 'no-store' });
}

export interface UserClick {
  kind: 'user_click';
  source: string;
  action_id: string;
  trusted: boolean;
}

/** Build the click proof from a real DOM event — never synthesize one. */
export function userClick(event: Event, source: string): UserClick {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { kind: 'user_click', source, action_id: id, trusted: event.isTrusted === true };
}

/** EXPLICIT generation command: design `count` reference candidates from voice.timbre. */
export function designVoiceCandidates(bookId: string, heroId: string, action: UserClick, count = 3): Promise<unknown> {
  return postJson(`${hero(bookId, heroId)}/voice/candidates/design`, { count, client_action: action });
}

/**
 * EXPLICIT command too (the transcription runs on a GPU worker): the form
 * carries `client_action` as a JSON string — without it 400 no_user_action.
 */
export function uploadVoiceCandidate(bookId: string, heroId: string, file: File, refText: string, action: UserClick): Promise<{ name: string }> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (refText.trim() !== '') form.append('ref_text', refText.trim());
  form.append('client_action', JSON.stringify(action));
  return postForm(`${hero(bookId, heroId)}/voice/candidates/upload`, form);
}

/** Delete a candidate (the pinned one — 409 candidate_locked, a pending one — 409 candidate_pending). */
export function deleteVoiceCandidate(bookId: string, heroId: string, name: string): Promise<unknown> {
  return deleteJson(`${hero(bookId, heroId)}/voice/candidates/${encodeURIComponent(name)}`);
}

/** Pin a candidate as voice.reference with locked: true; `refText` — a corrected text of an uploaded sample. */
export function pinVoiceReference(bookId: string, heroId: string, name: string, refText?: string): Promise<unknown> {
  return postJson(`${hero(bookId, heroId)}/voice/reference`, refText !== undefined ? { name, locked: true, ref_text: refText } : { name, locked: true });
}

export function clearVoiceReference(bookId: string, heroId: string): Promise<unknown> {
  return deleteJson(`${hero(bookId, heroId)}/voice/reference`);
}

export function voiceFileUrl(bookId: string, heroId: string, name: string): string {
  return mediaUrl(`${hero(bookId, heroId)}/voice/file/${encodeURIComponent(name)}`);
}

// ── Image references (backend step 7 — until then 404: the card degrades) ─

export function uploadImageRef(bookId: string, heroId: string, file: File, kind: string): Promise<unknown> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('kind', kind);
  return postForm(`${hero(bookId, heroId)}/image-refs`, form);
}

export function patchImageRef(bookId: string, heroId: string, index: number, fields: Record<string, unknown>): Promise<unknown> {
  return patchJson(`${hero(bookId, heroId)}/image-refs/${index}`, { fields });
}

export function deleteImageRef(bookId: string, heroId: string, index: number): Promise<unknown> {
  return deleteJson(`${hero(bookId, heroId)}/image-refs/${index}`);
}

/** `sha` busts the browser cache when the file behind the same index changes. */
export function imageRefUrl(bookId: string, heroId: string, index: number, sha?: string): string {
  return mediaUrl(`${hero(bookId, heroId)}/image-refs/${index}/file${sha ? `?v=${sha.slice(0, 12)}` : ''}`);
}

/** File name of a reference path ("voices/yura/ref_02.wav" → "ref_02.wav"). */
export function refFileName(file: string): string {
  return file.split('/').pop() ?? file;
}
