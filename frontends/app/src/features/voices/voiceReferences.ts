// Voice references (animastor-docs architecture/VOICE_REFERENCES.md) — data,
// pure helpers and API calls of the minimal block on the Voices tab.
// GPU work (candidates, upload) is sent ONLY from a click handler with a
// client action id (COMMAND_ONLY_GENERATION) — buildCandidatesRequest /
// uploadPath take the action id the click produced.

import { ApiError, deleteJson, getJson, mediaUrl, postJson, postRaw } from '../../api/client';
import type { StrKey } from '../../app/i18n';

export type ReferenceStatus =
  | 'ok' | 'missing' | 'unlocked' | 'not_verified' | 'file_missing' | 'sha_mismatch' | 'malformed' | 'missing_voice';

export interface VoiceReference {
  file: string;
  ref_text: string;
  source: 'designed' | 'uploaded';
  model: string | null;
  seed: number | null;
  sha256: string;
  verification: 'passed' | 'failed';
  locked: boolean;
  candidate_id?: string;
}

export interface VoiceCandidate {
  candidate_id: string;
  source: 'designed' | 'uploaded';
  status: 'pending' | 'ready' | 'failed';
  verification?: 'passed' | 'failed';
  verification_problems?: string[];
  ref_text?: string;
  asr_transcript?: string | null;
  duration_sec?: number;
  seed?: number;
  error?: string;
  selected?: boolean;
  created_at?: string;
}

export interface VoiceWithReferences {
  id: string;
  timbre: string;
  manner: string;
  timbre_source: 'cleaned' | 'user' | 'analysis' | null;
  design_description: string;
  reference: VoiceReference | null;
  reference_status: ReferenceStatus;
  phrase: { id: string; version: number; style: string; text: string; language: string } | null;
  candidates: VoiceCandidate[];
}

export interface VoiceReferencesResponse {
  book_id: string;
  language: string | null;
  duration_bounds_sec: [number, number];
  voices: VoiceWithReferences[];
}

const STATUS_KEYS: Record<ReferenceStatus, StrKey> = {
  ok: 'voice_ref_status_ok',
  missing: 'voice_ref_status_missing',
  unlocked: 'voice_ref_status_missing',
  not_verified: 'voice_ref_status_broken',
  file_missing: 'voice_ref_status_broken',
  sha_mismatch: 'voice_ref_status_broken',
  malformed: 'voice_ref_status_broken',
  missing_voice: 'voice_ref_status_missing',
};

/** i18n key of a reference status (pure). */
export function statusKey(s: ReferenceStatus): StrKey {
  return STATUS_KEYS[s] ?? 'voice_ref_status_missing';
}

/** voices whose reference must be (re)created — the «Создать референсы голосов» set. */
export function voicesNeedingReference(voices: VoiceWithReferences[]): string[] {
  return voices.filter((v) => v.reference_status !== 'ok').map((v) => v.id);
}

/** true while any candidate is being generated — the block polls then. */
export function hasPending(voices: VoiceWithReferences[]): boolean {
  return voices.some((v) => v.candidates.some((c) => c.status === 'pending'));
}

/** A candidate may be locked: ready + (designed: passed | uploaded: no hard problem). */
export function canLock(c: VoiceCandidate): boolean {
  if (c.status !== 'ready') return false;
  if (c.source === 'designed') return c.verification === 'passed';
  return (c.verification_problems ?? []).every((p) => p === 'no_transcript');
}

/** i18n key + optional details of a candidate's state line (pure). */
export function candidateState(c: VoiceCandidate): { key: StrKey; detail: string } {
  if (c.status === 'pending') return { key: 'voice_ref_cand_pending', detail: '' };
  if (c.status === 'failed') return { key: 'voice_ref_cand_failed', detail: c.error ?? '' };
  if (c.verification === 'passed') return { key: 'voice_ref_cand_passed', detail: '' };
  return { key: 'voice_ref_cand_rejected', detail: (c.verification_problems ?? []).join(', ') };
}

export function newActionId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `ua-${hex}`;
}

/** Body of POST …/voices/references/candidates. null ids = every voice without a reference. */
export function buildCandidatesRequest(actionId: string, ids: string[] | null, count = 3) {
  return {
    ...(ids && ids.length ? { character_ids: ids } : {}),
    count,
    client_action: { kind: 'user_click', source: 'editor.voice_references', action_id: actionId },
  };
}

const base = (bookId: string) => `/book/${encodeURIComponent(bookId)}/voices`;

export const voiceRefsApi = {
  list: (bookId: string) => getJson<VoiceReferencesResponse>(`${base(bookId)}/references`),
  createCandidates: (bookId: string, actionId: string, ids: string[] | null) =>
    postJson<{ command_id: string | null; character_ids: string[] }>(`${base(bookId)}/references/candidates`, buildCandidatesRequest(actionId, ids)),
  upload: (bookId: string, voiceId: string, actionId: string, file: File) =>
    postRaw<{ candidate_id: string }>(`${base(bookId)}/${encodeURIComponent(voiceId)}/references/upload?action_id=${encodeURIComponent(actionId)}`,
      file, file.type || 'audio/wav'),
  lock: (bookId: string, voiceId: string, candidateId: string, refText?: string) =>
    postJson<{ reference: VoiceReference }>(`${base(bookId)}/${encodeURIComponent(voiceId)}/reference`,
      { candidate_id: candidateId, ...(refText !== undefined ? { ref_text: refText } : {}) }),
  unlock: (bookId: string, voiceId: string) => deleteJson(`${base(bookId)}/${encodeURIComponent(voiceId)}/reference`),
  deleteCandidate: (bookId: string, voiceId: string, candidateId: string) =>
    deleteJson(`${base(bookId)}/${encodeURIComponent(voiceId)}/references/candidates/${encodeURIComponent(candidateId)}`),
  audioUrl: (bookId: string, voiceId: string, candidateId: string) =>
    mediaUrl(`${base(bookId)}/${encodeURIComponent(voiceId)}/references/candidates/${encodeURIComponent(candidateId)}/audio`),
};

/** A readable message for an API error of this block (pure). */
export function errorMessage(e: unknown): { code: string; ids: string[]; message: string } {
  if (e instanceof ApiError) {
    const b = (e.body ?? {}) as { code?: string; error?: string; character_ids?: string[] };
    return { code: b.code ?? String(e.status), ids: b.character_ids ?? [], message: b.error ?? e.message };
  }
  return { code: 'error', ids: [], message: e instanceof Error ? e.message : String(e) };
}
