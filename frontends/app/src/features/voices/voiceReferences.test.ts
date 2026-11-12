import { describe, expect, it } from 'vitest';
import { buildCandidatesRequest, canLock, candidateState, hasPending, statusKey, voicesNeedingReference } from './voiceReferences';
import type { VoiceCandidate, VoiceWithReferences } from './voiceReferences';

const voice = (id: string, status: VoiceWithReferences['reference_status'], candidates: VoiceCandidate[] = []): VoiceWithReferences => ({
  id, timbre: 't', manner: '', timbre_source: 'user', design_description: 't', reference: null, reference_status: status, phrase: null, candidates,
});
const cand = (over: Partial<VoiceCandidate>): VoiceCandidate => ({ candidate_id: 'c', source: 'designed', status: 'ready', ...over });

describe('voice references block helpers (VOICE_REFERENCES.md)', () => {
  it('«Создать референсы голосов» targets every voice without a usable reference', () => {
    expect(voicesNeedingReference([voice('narrator', 'ok'), voice('anna', 'missing'), voice('boris', 'sha_mismatch')])).toEqual(['anna', 'boris']);
  });
  it('polls only while a candidate is pending', () => {
    expect(hasPending([voice('a', 'missing', [cand({ status: 'ready' })])])).toBe(false);
    expect(hasPending([voice('a', 'missing', [cand({ status: 'pending' })])])).toBe(true);
  });
  it('lock: designed needs verification passed; uploaded needs no hard problem', () => {
    expect(canLock(cand({ verification: 'passed' }))).toBe(true);
    expect(canLock(cand({ verification: 'failed', verification_problems: ['transcript_mismatch'] }))).toBe(false);
    expect(canLock(cand({ status: 'pending' }))).toBe(false);
    expect(canLock(cand({ source: 'uploaded', verification: 'failed', verification_problems: ['no_transcript'] }))).toBe(true);
    expect(canLock(cand({ source: 'uploaded', verification: 'failed', verification_problems: ['too_short'] }))).toBe(false);
  });
  it('candidate state lines and status keys', () => {
    expect(candidateState(cand({ status: 'pending' })).key).toBe('voice_ref_cand_pending');
    expect(candidateState(cand({ verification: 'failed', verification_problems: ['too_long'] }))).toEqual({ key: 'voice_ref_cand_rejected', detail: 'too_long' });
    expect(statusKey('ok')).toBe('voice_ref_status_ok');
    expect(statusKey('sha_mismatch')).toBe('voice_ref_status_broken');
  });
  it('the candidates request always carries the click action id; null ids = all missing', () => {
    expect(buildCandidatesRequest('ua-1', null)).toEqual({ count: 3, client_action: { kind: 'user_click', source: 'editor.voice_references', action_id: 'ua-1' } });
    expect(buildCandidatesRequest('ua-2', ['anna'], 2).character_ids).toEqual(['anna']);
  });
});
