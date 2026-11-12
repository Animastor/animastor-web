// Minimal voice-references block of the Voices tab (VOICE_REFERENCES.md).
// The full character card is a separate task — this block only lets the user
// create candidates, listen, lock one, upload an own sample and unlock.
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t, tf } from '../../app/i18n';
import {
  canLock, candidateState, errorMessage, hasPending, newActionId, statusKey, voiceRefsApi, voicesNeedingReference,
} from './voiceReferences';
import type { VoiceCandidate, VoiceReferencesResponse, VoiceWithReferences } from './voiceReferences';

const POLL_MS = 5000;

export function VoiceReferencesBlock({ bookId }: { bookId: string }): JSX.Element {
  const [data, setData] = useState<VoiceReferencesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refTexts, setRefTexts] = useState<Record<string, string>>({});
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const r = await voiceRefsApi.list(bookId);
      if (alive.current) { setData(r); setError(null); }
    } catch (e) {
      const m = errorMessage(e);
      if (alive.current) setError(m.code === 'book_not_v2' ? t('voice_ref_err_not_v2') : m.message);
    }
  }, [bookId]);

  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);
  useEffect(() => {
    if (!data || !hasPending(data.voices)) return undefined;
    const id = setTimeout(() => { void reload(); }, POLL_MS);
    return () => clearTimeout(id);
  }, [data, reload]);

  // Every GPU action runs from the click handler with its own action id.
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); setError(null); } catch (e) {
      const m = errorMessage(e);
      setError(m.ids.length ? `${m.message} (${m.ids.join(', ')})` : m.message);
    } finally { setBusy(false); await reload(); }
  };

  const createAll = () => run(() => voiceRefsApi.createCandidates(bookId, newActionId(), null));
  const createFor = (id: string) => run(() => voiceRefsApi.createCandidates(bookId, newActionId(), [id]));
  const upload = (id: string, file: File | undefined) => {
    if (!file) return;
    void run(() => voiceRefsApi.upload(bookId, id, newActionId(), file));
  };

  if (error && !data) return <div class="edit-card voice-refs"><div class="edit-empty-inline">{error}</div></div>;
  if (!data) return <div class="edit-card voice-refs"><div class="edit-empty-inline">{t('voice_ref_loading')}</div></div>;

  const missing = voicesNeedingReference(data.voices);
  return (
    <div class="edit-card voice-refs" data-testid="voice-references">
      <div class="edit-card__head">
        <span class="edit-card__title">{t('voice_ref_title')}</span>
      </div>
      <p class="voice-refs__hint">{t('voice_ref_hint')}</p>
      <button type="button" class="btn" disabled={busy || missing.length === 0} onClick={() => { void createAll(); }}>
        {missing.length ? tf('voice_ref_create_all', missing.length) : t('voice_ref_all_locked')}
      </button>
      {error && <div class="voice-refs__error" role="alert">{error}</div>}
      {data.voices.map((v) => (
        <VoiceRow key={v.id} v={v} busy={busy}
          onCreate={() => { void createFor(v.id); }}
          onUpload={(f) => upload(v.id, f)}
          onUnlock={() => { void run(() => voiceRefsApi.unlock(bookId, v.id)); }}
          onLock={(c) => { void run(() => voiceRefsApi.lock(bookId, v.id, c.candidate_id, c.source === 'uploaded' ? (refTexts[c.candidate_id] ?? c.ref_text ?? '') : undefined)); }}
          onDelete={(c) => { void run(() => voiceRefsApi.deleteCandidate(bookId, v.id, c.candidate_id)); }}
          refTextOf={(c) => refTexts[c.candidate_id] ?? c.ref_text ?? ''}
          setRefText={(c, text) => setRefTexts((m) => ({ ...m, [c.candidate_id]: text }))}
          audioUrl={(c) => voiceRefsApi.audioUrl(bookId, v.id, c.candidate_id)} />
      ))}
    </div>
  );
}

interface RowProps {
  v: VoiceWithReferences;
  busy: boolean;
  onCreate: () => void;
  onUpload: (f: File | undefined) => void;
  onUnlock: () => void;
  onLock: (c: VoiceCandidate) => void;
  onDelete: (c: VoiceCandidate) => void;
  refTextOf: (c: VoiceCandidate) => string;
  setRefText: (c: VoiceCandidate, text: string) => void;
  audioUrl: (c: VoiceCandidate) => string;
}

function VoiceRow({ v, busy, onCreate, onUpload, onUnlock, onLock, onDelete, refTextOf, setRefText, audioUrl }: RowProps): JSX.Element {
  const ok = v.reference_status === 'ok';
  return (
    <div class="voice-refs__voice" data-voice={v.id}>
      <div class="voice-refs__row">
        <strong>{v.id}</strong>
        <span class={`voice-refs__status voice-refs__status--${ok ? 'ok' : 'todo'}`}>{t(statusKey(v.reference_status))}</span>
      </div>
      <div class="voice-refs__desc">{v.design_description || t('voice_ref_no_description')}</div>
      {v.timbre_source === 'cleaned' && <div class="voice-refs__hint">{t('voice_ref_cleaned_hint')}</div>}
      <div class="voice-refs__actions">
        {!ok && <button type="button" class="btn btn--outlined" disabled={busy || !v.design_description} onClick={onCreate}>{t('voice_ref_create_one')}</button>}
        {!ok && (
          <label class="btn btn--outlined">
            {t('voice_ref_upload')}
            <input type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/ogg,audio/flac" hidden disabled={busy}
              onChange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; onUpload(f); (e.currentTarget as HTMLInputElement).value = ''; }} />
          </label>
        )}
        {ok && <button type="button" class="btn btn--outlined" disabled={busy} onClick={onUnlock}>{t('voice_ref_unlock')}</button>}
      </div>
      {v.candidates.map((c) => {
        const st = candidateState(c);
        return (
          <div class="voice-refs__cand" key={c.candidate_id}>
            {c.status === 'ready' && <audio controls preload="none" src={audioUrl(c)} />}
            <div>
              {t(st.key)}{st.detail ? `: ${st.detail}` : ''}{c.selected ? ` · ${t('voice_ref_selected')}` : ''}
              {typeof c.duration_sec === 'number' ? ` · ${c.duration_sec.toFixed(1)} s` : ''}
            </div>
            {c.status === 'ready' && c.asr_transcript != null && c.source === 'designed' && (
              <div class="voice-refs__transcript">{tf('voice_ref_heard', c.asr_transcript)}</div>
            )}
            {c.status === 'ready' && c.source === 'uploaded' && !c.selected && (
              <textarea class="voice-refs__reftext" rows={2} value={refTextOf(c)} placeholder={t('voice_ref_reftext_placeholder')}
                onInput={(e) => setRefText(c, (e.currentTarget as HTMLTextAreaElement).value)} />
            )}
            <div class="voice-refs__actions">
              {!c.selected && canLock(c) && !ok && <button type="button" class="btn" disabled={busy} onClick={() => onLock(c)}>{t('voice_ref_lock')}</button>}
              {!c.selected && c.status !== 'pending' && <button type="button" class="btn btn--outlined" disabled={busy} onClick={() => onDelete(c)}>{t('voice_ref_delete')}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
