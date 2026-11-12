// Hero API — the write side of the hero card (animastor-docs
// architecture/VBOOK_FORMAT_V4.md §8.2, 05-frontend/HERO_CARD.md §6).
//
// One hero = one resource. After every successful mutation the caller re-reads
// GET /book (the backend is the single source of truth — parity rule 2); this
// module never patches local state.
//
// Generation endpoints (designVoiceCandidates) carry `client_action` exactly
// like /regenerate: they may be called from a click handler only.
import { deleteJson, getJson, mediaUrl, patchJson, postForm, postJson } from '../../api/client';
import type { HeroRule, VoiceReference } from './heroModel';

const book = (bookId: string): string => `/book/${encodeURIComponent(bookId)}`;
const hero = (bookId: string, heroId: string): string => `${book(bookId)}/heroes/${encodeURIComponent(heroId)}`;

export interface CreateHeroBody {
  id?: string;
  name?: string;
  role?: string;
  passport?: Record<string, unknown>;
  voice?: Record<string, unknown>;
}

export function createHero(bookId: string, body: CreateHeroBody): Promise<{ hero_id: string }> {
  return postJson(`${book(bookId)}/heroes`, body);
}

/** `ifRev` — optimistic lock: 409 rev_conflict when the hero changed elsewhere. */
export function patchHero(bookId: string, heroId: string, fields: Record<string, unknown>, ifRev?: string | null): Promise<unknown> {
  return patchJson(hero(bookId, heroId), ifRev ? { fields, if_rev: ifRev } : { fields });
}

export function deleteHero(bookId: string, heroId: string, opts: { broken?: boolean } = {}): Promise<unknown> {
  return deleteJson(hero(bookId, heroId) + (opts.broken ? '?broken=1' : ''));
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

// ── Voice reference (endpoints owned by the reference-voices task) ────────

export interface VoiceCandidate extends VoiceReference {
  /** File name inside build_<book>/voices/<hero>/ — the candidate's address. */
  name: string;
  duration_ms?: number;
  pinned?: boolean;
  state?: 'ok' | 'missing' | 'mismatch';
}

export interface VoiceCandidatesResponse {
  candidates: VoiceCandidate[];
  /** A design command is running — poll again. */
  pending?: boolean;
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

export function uploadVoiceCandidate(bookId: string, heroId: string, file: File, refText: string): Promise<unknown> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('ref_text', refText);
  return postForm(`${hero(bookId, heroId)}/voice/candidates/upload`, form);
}

/** Pin a candidate as voice.reference with locked: true. */
export function pinVoiceReference(bookId: string, heroId: string, name: string): Promise<unknown> {
  return postJson(`${hero(bookId, heroId)}/voice/reference`, { name, locked: true });
}

export function clearVoiceReference(bookId: string, heroId: string): Promise<unknown> {
  return deleteJson(`${hero(bookId, heroId)}/voice/reference`);
}

export function voiceFileUrl(bookId: string, heroId: string, name: string): string {
  return mediaUrl(`${hero(bookId, heroId)}/voice/file/${encodeURIComponent(name)}`);
}

// ── Image references ─────────────────────────────────────────────────────

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
