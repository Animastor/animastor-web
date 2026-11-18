// HeroCard — the RPG-style character sheet of one hero (HERO_CARD.md §3–§6).
//
//   portrait · name · role            ← identity
//   passport (appearance / clothes / video tokens)   ← "characteristics"
//   voice (timbre / manner / reference + candidates)
//   habits (behaviour profile + rules with on/off)
//   references (images) · aliases · notes
//
// Text fields are edited in a local draft and saved with ONE PATCH carrying
// only the changed fields (diffDraft) plus `if_rev`. Rule switches, reference
// pinning and uploads are immediate actions. Nothing here starts a generation
// by itself: the only generation command is the «Create candidates» button.
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError } from '../../api/client';
import { t, tf } from '../../app/i18n';
import type { StrKey } from '../../app/i18n';
import { IconAdd, IconCheck, IconChevronLeft, IconClose, IconImage, IconSave, IconSparkle, IconVolumeUp } from '../../app/icons';
import { Modal, Switch } from '../../lib/ui';
import {
  clearVoiceReference, createRule, deleteHero, deleteImageRef, deleteRule, deleteVoiceCandidate, designVoiceCandidates, imageRefUrl,
  listVoiceCandidates, patchHero, patchImageRef, patchRule, pinVoiceReference, refFileName, uploadImageRef,
  uploadVoiceCandidate, userClick, voiceFileUrl,
} from './heroApi';
import type { VoiceCandidate } from './heroApi';
import {
  BEHAVIOUR_EMOTIONS, allRuleIds, canDeleteCandidate, canPinCandidate, candidateLine, diffDraft, dirtySummary, draftFromHero,
  duplicateWarnings, findHero, heroKind, heroMonogram, heroWarnings, isNarrator,
  newRuleId, portraitIndex, referenceStatus, validateDraft, voiceInstruct,
} from './heroModel';
import type { BehaviourGlobals, Hero, HeroDraft, HeroIssue, HeroRule, LookChapter, ReferenceStatus } from './heroModel';
import { HeroLooks } from './HeroLooks';

const KIND_KEYS: Record<ReturnType<typeof heroKind>, StrKey> = {
  narrator: 'hero_kind_narrator',
  character: 'hero_kind_character',
  voice_only: 'hero_kind_voice_only',
};

export const REF_STATUS_KEYS: Record<ReferenceStatus, StrKey> = {
  none: 'hero_ref_none',
  candidate: 'hero_ref_candidate',
  pinned: 'hero_ref_pinned',
  missing: 'hero_ref_missing',
  mismatch: 'hero_ref_mismatch',
};

/** The candidate list is re-read this often while a command runs (HERO_CARD.md §6). */
export const CANDIDATES_POLL_MS = 3000;

/** Endpoints that are not deployed yet answer 404/405/501 — the block degrades, the card keeps working. */
function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

/**
 * The text of a failed action. VBook 4 errors are `{error: <code>, message}`:
 * the message is shown (ApiError.message), the code only picks a clearer text
 * where the card knows one (HERO_CARD.md §7, §10 п.5).
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { error?: string } | undefined)?.error;
    if (e.status === 409 && code === 'rev_conflict') return t('hero_rev_conflict');
    if (e.status === 400 && code === 'invalid_character' && /look/i.test(e.message)) return t('hero_err_passport_has_looks');
    return e.message || `${e.status}`;
  }
  return (e as Error)?.message || 'unknown';
}

/** «N scenes will be redrawn (image, video)» after a mutation — or null. */
export function dirtyNotice(result: unknown): string | null {
  const sum = dirtySummary((result as { dirty_scenes?: unknown } | null)?.dirty_scenes);
  if (sum.scenes === 0) return null;
  return tf('hero_dirty_scenes', sum.scenes, sum.layers.join(', ') || '—');
}

export function Portrait({ bookId, hero, size }: { bookId: string; hero: Hero; size: 'grid' | 'card' }): JSX.Element {
  const index = portraitIndex(hero);
  const ref = index >= 0 ? hero.image_refs?.[index] : null;
  const [failed, setFailed] = useState(false);
  const url = ref && ref.state !== 'missing' ? imageRefUrl(bookId, hero.id, index, ref.sha256) : null;
  useEffect(() => { setFailed(false); }, [url]);
  return (
    <div class={`hero-portrait hero-portrait--${size} hero-portrait--${heroKind(hero)}`}>
      {url && !failed
        ? <img class="hero-portrait__img" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span class="hero-portrait__mono" aria-hidden="true">{isNarrator(hero) ? <IconVolumeUp width={size === 'card' ? 44 : 30} height={size === 'card' ? 44 : 30} /> : heroMonogram(hero)}</span>}
    </div>
  );
}

function Field({ label, hint, value, onInput, multiline, readonly, rows }: {
  label: string; hint?: string; value: string; onInput?: (v: string) => void; multiline?: boolean; readonly?: boolean; rows?: number;
}): JSX.Element {
  return (
    <label class="edit-field hero-field">
      <span class="edit-field__label">{label}</span>
      {multiline
        ? <textarea class="edit-field__input edit-field__input--area" rows={rows ?? 3} value={value} readOnly={readonly}
            onInput={(e) => onInput?.((e.target as HTMLTextAreaElement).value)} />
        : <input class="edit-field__input" type="text" value={value} readOnly={readonly}
            onInput={(e) => onInput?.((e.target as HTMLInputElement).value)} />}
      {hint && <span class="hero-field__hint">{hint}</span>}
    </label>
  );
}

function Section({ title, badge, action, children }: {
  title: string; badge?: JSX.Element | null; action?: JSX.Element | null; children: JSX.Element | JSX.Element[] | null | false | (JSX.Element | null | false)[];
}): JSX.Element {
  return (
    <section class="hero-section">
      <header class="hero-section__head">
        <h3 class="hero-section__title">{title}</h3>
        {badge}
        <span class="hero-section__spacer" />
        {action}
      </header>
      <div class="hero-section__body">{children}</div>
    </section>
  );
}

export function HeroCard({ bookId, hero, heroes, globals, issues, chapters, onNavigate, onChanged, onClose }: {
  bookId: string;
  hero: Hero;
  heroes: Hero[];
  /** Chapters of the book — where looks are assigned. */
  chapters: LookChapter[];
  onNavigate: (chapterId: string, sceneId: string | null) => void;
  globals: BehaviourGlobals | null;
  issues: HeroIssue[];
  /** Re-read GET /book; resolves when fresh data has been applied. */
  onChanged: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<HeroDraft>(() => draftFromHero(hero));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showInstruct, setShowInstruct] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fields = useMemo(() => diffDraft(hero, draft), [hero, draft]);
  const dirty = Object.keys(fields).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftErrors = useMemo(() => validateDraft(hero, draft), [hero, draft]);

  // Fresh server data replaces the draft only when the user has no pending
  // edits (after a save the diff is empty, so the draft follows the server).
  const heroKey = `${hero.id}:${hero.rev ?? ''}`;
  const lastKey = useRef(heroKey);
  useEffect(() => {
    if (lastKey.current === heroKey) return;
    const sameHero = lastKey.current.split(':')[0] === hero.id;
    lastKey.current = heroKey;
    if (!sameHero || !dirtyRef.current) setDraft(draftFromHero(hero));
  }, [heroKey, hero]);

  const set = useCallback(<K extends keyof HeroDraft>(key: K, value: HeroDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  /** Run an immediate action, then re-read the book. */
  const act = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(dirtyNotice(await fn()));
      await onChanged();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const save = useCallback(async () => {
    if (!dirty || draftErrors.length > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(dirtyNotice(await patchHero(bookId, hero.id, fields, hero.rev)));
      // The draft equals what was sent — let the fresh hero replace it.
      dirtyRef.current = false;
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [bookId, dirty, draftErrors, fields, hero.id, hero.rev, onChanged]);

  const requestClose = useCallback(() => {
    if (dirty) setConfirmLeave(true);
    else onClose();
  }, [dirty, onClose]);

  const removeHero = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteHero(bookId, hero.id);
      setConfirmDelete(false);
      onClose();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [bookId, hero.id, onChanged, onClose]);

  const kind = heroKind(hero);
  const warnings = heroWarnings(issues, hero.id);
  const duplicates = duplicateWarnings(issues, hero.id);
  const title = draft.name.trim() || (isNarrator(hero) ? t('hero_kind_narrator') : hero.id);

  return (
    <div class="hero-sheet" role="region" aria-label={title}>
      <div class="hero-sheet__bar">
        <button class="hero-sheet__back" type="button" onClick={requestClose} aria-label={t('hero_back')}>
          <IconChevronLeft width={20} height={20} /> <span>{t('hero_back')}</span>
        </button>
        <span class="hero-section__spacer" />
        <button class="btn hero-sheet__save" type="button" disabled={busy || !dirty || draftErrors.length > 0} onClick={() => void save()}>
          <IconSave width={16} height={16} /> {busy && dirty ? t('edit_saving') : dirty ? `${t('edit_save')} *` : t('edit_save')}
        </button>
      </div>

      {error && <div class="hero-sheet__error" role="alert">{error}</div>}
      {draftErrors.map((code) => <div class="hero-sheet__error" key={code}>{tf(code, 4, 64)}</div>)}
      {warnings.map((w, i) => <div class="hero-sheet__warn" key={`${w.code}:${i}`}>{w.message || w.code}</div>)}
      {duplicates.map((d) => {
        const other = findHero(heroes, d.of);
        return (
          <div class="hero-sheet__warn hero-sheet__warn--duplicate" key={`dup:${d.of}`} data-testid="hero-duplicate">
            {tf('hero_possible_duplicate', (other?.name ?? '').trim() || d.of)}
            {d.evidence.length > 0 && <span class="hero-sheet__evidence"> {d.evidence.map((q) => `«${q}»`).join(' · ')}</span>}
          </div>
        );
      })}
      {notice && <div class="hero-sheet__notice" role="status">{notice}</div>}

      <div class="hero-sheet__layout">
        {/* ── Left column: who this is ── */}
        <div class="hero-sheet__identity">
          <Portrait bookId={bookId} hero={hero} size="card" />
          <div class="hero-sheet__name">{title}</div>
          <div class="hero-sheet__chips">
            <span class={`hero-chip hero-chip--${kind}`}>{t(KIND_KEYS[kind])}</span>
            {draft.role.trim() !== '' && kind !== 'narrator' && <span class="hero-chip">{draft.role.trim()}</span>}
          </div>
          <div class="hero-sheet__id" title={t('hero_field_id')}>{hero.id}</div>

          <Field label={t('hero_field_name')} value={draft.name} onInput={(v) => set('name', v)} />
          {!isNarrator(hero) && <Field label={t('hero_field_role')} value={draft.role} onInput={(v) => set('role', v)} />}
          {!isNarrator(hero) && (
            <Field label={t('hero_field_aliases')} hint={t('hero_field_aliases_hint')} value={draft.aliases} multiline rows={3}
              onInput={(v) => set('aliases', v)} />
          )}
          <Field label={t('hero_field_notes')} hint={t('hero_field_notes_hint')} value={draft.notes} multiline rows={3}
            onInput={(v) => set('notes', v)} />
        </div>

        {/* ── Right column: characteristics ── */}
        <div class="hero-sheet__stats">
          {!isNarrator(hero) && (
            <Section
              title={t('hero_section_passport')}
              action={draft.hasPassport
                ? <button class="hero-link hero-link--danger" type="button" onClick={() => set('hasPassport', false)}>{t('hero_block_remove')}</button>
                : <button class="hero-link" type="button" onClick={() => set('hasPassport', true)}>{t('hero_passport_add')}</button>}
            >
              {draft.hasPassport ? [
                <Field key="a" label={t('field_appearance')} value={draft.appearance} multiline rows={3} onInput={(v) => set('appearance', v)} />,
                <Field key="c" label={t('field_clothes')} value={draft.clothes} multiline rows={2} onInput={(v) => set('clothes', v)} />,
                <Field key="t" label={t('field_video_tokens')} hint={t('hero_field_tokens_hint')} value={draft.videoTokens} onInput={(v) => set('videoTokens', v)} />,
              ] : <p class="hero-empty">{t('hero_passport_empty')}</p>}
            </Section>
          )}

          {!isNarrator(hero) && hero.passport && (
            <Section title={t('hero_section_looks')}>
              <HeroLooks bookId={bookId} hero={hero} chapters={chapters} busy={busy} act={act} onNavigate={onNavigate} />
            </Section>
          )}

          <Section
            title={t('hero_section_voice')}
            action={isNarrator(hero) ? null : draft.hasVoice
              ? <button class="hero-link hero-link--danger" type="button" onClick={() => set('hasVoice', false)}>{t('hero_block_remove')}</button>
              : <button class="hero-link" type="button" onClick={() => set('hasVoice', true)}>{t('hero_voice_add')}</button>}
          >
            {draft.hasVoice ? [
              <Field key="t" label={t('hero_field_timbre')} hint={t('hero_field_timbre_hint')} value={draft.timbre} multiline rows={2} onInput={(v) => set('timbre', v)} />,
              <Field key="m" label={t('hero_field_manner')} hint={t(referenceStatus(hero.voice) === 'pinned' ? 'hero_field_manner_pinned_hint' : 'hero_field_manner_hint')} value={draft.manner} multiline rows={2} onInput={(v) => set('manner', v)} />,
              <button key="p" class="hero-link" type="button" onClick={() => setShowInstruct((s) => !s)}>{t('hero_voice_instruct_preview')}</button>,
              showInstruct && <pre key="i" class="hero-instruct">{voiceInstruct({ timbre: draft.timbre, manner: draft.manner }) || '—'}</pre>,
              hero.voice
                ? <VoiceReferenceBlock key="r" bookId={bookId} hero={hero} busy={busy} act={act} setError={setError} timbreDirty={draft.timbre !== (hero.voice.timbre ?? '')} />
                : <p key="r" class="hero-empty">{t('hero_ref_save_first')}</p>,
            ] : <p class="hero-empty">{t('hero_voice_empty')}</p>}
          </Section>

          {!isNarrator(hero) && (
            <Section title={t('hero_section_behaviour')}>
              <Field label={t('field_baseline')} value={draft.baseline} multiline rows={2} onInput={(v) => set('baseline', v)} />
              <Field label={t('field_quirks')} value={draft.quirks} multiline rows={3} onInput={(v) => set('quirks', v)} />
              <Field label={t('field_reactions')} value={draft.reactions} multiline rows={3} onInput={(v) => set('reactions', v)} />
              <RulesBlock bookId={bookId} hero={hero} heroes={heroes} globals={globals} busy={busy} act={act} />
            </Section>
          )}

          {!isNarrator(hero) && <ImageRefsBlock bookId={bookId} hero={hero} busy={busy} act={act} setError={setError} />}

          {!isNarrator(hero) && (
            <div class="hero-sheet__danger">
              <button class="btn btn--outlined btn--error" type="button" disabled={busy} onClick={() => { setError(null); setConfirmDelete(true); }}>
                {t('hero_delete')}
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <Modal title={t('hero_delete_title')} onClose={() => { if (!busy) setConfirmDelete(false); }}
          footer={[
            <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('hero_cancel')}</button>,
            <button key="d" class="btn btn--error-solid" type="button" disabled={busy} onClick={() => void removeHero()}>{t('entity_delete')}</button>,
          ]}>
          <p class="modal__notice">{tf('hero_delete_confirm', title)}</p>
          {error ? <p class="modal__notice hero-sheet__error">{error}</p> : <span />}
        </Modal>
      )}

      {confirmLeave && (
        <Modal title={t('hero_unsaved_title')} onClose={() => setConfirmLeave(false)}
          footer={[
            <button key="d" class="btn btn--outlined" type="button" onClick={() => { setConfirmLeave(false); onClose(); }}>{t('hero_unsaved_discard')}</button>,
            <button key="s" class="btn" type="button" onClick={() => setConfirmLeave(false)}>{t('hero_unsaved_stay')}</button>,
          ]}>
          <p class="modal__notice">{t('hero_unsaved_desc')}</p>
        </Modal>
      )}
    </div>
  );
}

// ── Voice reference: pinned reference, candidates, pin / upload ───────────

type Act = (fn: () => Promise<unknown>) => Promise<boolean>;

function VoiceReferenceBlock({ bookId, hero, busy, act, setError, timbreDirty }: {
  bookId: string; hero: Hero; busy: boolean; act: Act; setError: (e: string | null) => void; timbreDirty: boolean;
}): JSX.Element {
  const [candidates, setCandidates] = useState<VoiceCandidate[] | null>(null);
  const [pending, setPending] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [refTexts, setRefTexts] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement | null>(null);
  const status = referenceStatus(hero.voice);
  const ref = hero.voice?.reference ?? null;
  const pinned = status === 'pinned';

  // Opening the card only READS the list (HERO_CARD.md §6) — never a command.
  const load = useCallback(async () => {
    try {
      const res = await listVoiceCandidates(bookId, hero.id);
      setCandidates(Array.isArray(res?.candidates) ? res.candidates : []);
      setPending(res?.pending === true);
      setOutdated(res?.reference_outdated === true);
      setUnavailable(false);
    } catch (e) {
      if (isUnavailable(e)) { setUnavailable(true); setCandidates([]); } else setError(errorText(e));
    }
  }, [bookId, hero.id, setError]);

  // Reload when the hero (or its pinned reference) changes.
  useEffect(() => { void load(); }, [load, hero.rev]);

  // While a design / upload command runs, re-read the list every 3 s (no
  // generation is started from here — only the list is re-read).
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { void load(); }, CANDIDATES_POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, candidates, load]);

  const hasTimbre = (hero.voice?.timbre ?? '').trim() !== '';
  const outdatedNow = hero.voice?.reference_outdated === true || (pinned && outdated);
  const others = (candidates ?? []).filter((c) => !c.pinned);

  return (
    <div class="hero-ref" data-testid="hero-voice-reference">
      <div class="hero-ref__head">
        <span class="hero-ref__title">{t('hero_section_reference')}</span>
        <span class={`hero-badge hero-badge--${status}`}>{t(REF_STATUS_KEYS[status])}</span>
        {ref?.verification && <span class={`hero-badge hero-badge--verify-${ref.verification}`}>{tf('hero_ref_verification', ref.verification)}</span>}
        {outdatedNow && <span class="hero-badge hero-badge--outdated" data-testid="hero-ref-outdated" title={t('hero_ref_outdated_hint')}>{t('hero_ref_outdated')}</span>}
      </div>
      {outdatedNow && <p class="hero-field__hint">{t('hero_ref_outdated_hint')}</p>}

      {ref && (
        <div class="hero-ref__pinned">
          {status === 'missing' || status === 'mismatch'
            ? <p class="hero-sheet__warn">{t(status === 'missing' ? 'hero_ref_missing_hint' : 'hero_ref_mismatch_hint')}</p>
            : <audio class="hero-ref__audio" controls preload="none" src={voiceFileUrl(bookId, hero.id, refFileName(ref.file))} />}
          {ref.ref_text && <p class="hero-ref__text">«{ref.ref_text}»</p>}
          <p class="hero-ref__meta">
            {[ref.source, ref.model, ref.seed != null ? `seed ${ref.seed}` : null, refFileName(ref.file)].filter(Boolean).join(' · ')}
          </p>
          <button class="hero-link hero-link--danger" type="button" disabled={busy} onClick={() => void act(() => clearVoiceReference(bookId, hero.id))}>
            {t('hero_ref_unpin')}
          </button>
        </div>
      )}

      {unavailable ? <p class="hero-empty">{t('hero_ref_unavailable')}</p> : (
        <div class="hero-ref__candidates">
          {others.map((c) => {
            const line = candidateLine(c);
            const uploaded = c.source === 'uploaded';
            return (
              <div class="hero-ref__candidate" key={c.name} data-candidate={c.name}>
                {c.status === 'ready' && <audio class="hero-ref__audio" controls preload="none" src={voiceFileUrl(bookId, hero.id, c.name)} />}
                <div class="hero-ref__candidate-row">
                  <span class={`hero-ref__meta hero-ref__state hero-ref__state--${c.status ?? 'ready'}`}>
                    {[c.name, c.source, `${t(line.key)}${line.detail ? `: ${line.detail}` : ''}`,
                      typeof c.duration_ms === 'number' ? `${(c.duration_ms / 1000).toFixed(1)} s` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {c.ref_text && !uploaded && <p class="hero-ref__text">«{c.ref_text}»</p>}
                {uploaded && c.status === 'ready' && (
                  <label class="hero-ref__upload-text">
                    <span class="edit-field__label">{t('hero_ref_text')}</span>
                    <input class="edit-field__input" type="text" value={refTexts[c.name] ?? c.ref_text ?? ''}
                      onInput={(e) => { const v = (e.target as HTMLInputElement).value; setRefTexts((m) => ({ ...m, [c.name]: v })); }} />
                  </label>
                )}
                <div class="hero-ref__actions">
                  {canPinCandidate(c) && !pinned && (
                    <button class="btn btn--outlined hero-btn-sm" type="button" disabled={busy}
                      onClick={() => void act(() => pinVoiceReference(bookId, hero.id, c.name,
                        uploaded && refTexts[c.name] !== undefined ? refTexts[c.name] : undefined))}>
                      <IconCheck width={14} height={14} /> {t('hero_ref_pin')}
                    </button>
                  )}
                  {canDeleteCandidate(c) && (
                    <button class="hero-link hero-link--danger" type="button" disabled={busy}
                      onClick={() => void act(() => deleteVoiceCandidate(bookId, hero.id, c.name)).then((ok) => { if (ok) void load(); })}>
                      {t('hero_ref_delete_candidate')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {candidates !== null && others.length === 0 && !pending && <p class="hero-empty">{t('hero_ref_no_candidates')}</p>}
          {pending && <p class="hero-empty" data-testid="hero-ref-pending">{t('hero_ref_pending')}</p>}

          {!pinned && (
            <div class="hero-ref__actions">
              {/* The ONLY generation command of the card — fired by this click, nowhere else. */}
              <button class="btn btn--outlined hero-btn-sm" type="button" data-testid="hero-ref-design"
                disabled={busy || pending || !hasTimbre || timbreDirty}
                title={!hasTimbre ? t('hero_ref_need_timbre') : timbreDirty ? t('hero_ref_save_first') : undefined}
                onClick={(e) => { const action = userClick(e, 'hero_card.voice_design'); void act(() => designVoiceCandidates(bookId, hero.id, action)).then((ok) => { if (ok) void load(); }); }}>
                <IconSparkle width={14} height={14} /> {t('hero_ref_design')}
              </button>
              <button class="btn btn--outlined hero-btn-sm" type="button" disabled={busy || pending} onClick={() => fileInput.current?.click()}>
                <IconAdd width={14} height={14} /> {t('hero_ref_upload')}
              </button>
              <input ref={fileInput} type="file" accept="audio/wav,audio/x-wav,audio/flac,audio/mpeg,audio/ogg,.wav,.flac,.mp3,.ogg" hidden
                data-testid="hero-ref-upload-input"
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  const file = input.files?.[0];
                  input.value = '';
                  if (!file) return;
                  // Uploading is a command too (GPU transcription): the proof
                  // comes from this user event (HERO_CARD.md §10 п.1).
                  const action = userClick(e, 'hero_card.voice_upload');
                  void act(() => uploadVoiceCandidate(bookId, hero.id, file, uploadText, action)).then((ok) => { if (ok) { setUploadText(''); void load(); } });
                }} />
            </div>
          )}
          {!pinned && (!hasTimbre || timbreDirty) && <p class="hero-field__hint">{t(!hasTimbre ? 'hero_ref_need_timbre' : 'hero_ref_save_first')}</p>}
          {!pinned && (
            <label class="hero-ref__upload-text">
              <span class="edit-field__label">{t('hero_ref_upload_text')}</span>
              <input class="edit-field__input" type="text" value={uploadText} onInput={(e) => setUploadText((e.target as HTMLInputElement).value)} />
            </label>
          )}
          {pinned && <p class="hero-field__hint">{t('hero_ref_pinned_hint')}</p>}
        </div>
      )}
    </div>
  );
}

// ── Habits: behaviour rules of this hero ─────────────────────────────────

function RulesBlock({ bookId, hero, heroes, globals, busy, act }: {
  bookId: string; hero: Hero; heroes: Hero[]; globals: BehaviourGlobals | null; busy: boolean; act: Act;
}): JSX.Element {
  const rules = hero.behaviour?.rules ?? [];
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState('');
  const [emotions, setEmotions] = useState<string[]>([]);
  const [probability, setProbability] = useState('0.35');

  const canAdd = action.trim() !== '' && emotions.length > 0;
  const add = async () => {
    const p = Math.min(1, Math.max(0, Number(probability.replace(',', '.'))));
    const rule: HeroRule = {
      id: newRuleId(hero.id, action, allRuleIds(heroes, globals)),
      when: { emotion: emotions },
      then: { action: action.trim() },
      probability: Number.isFinite(p) ? p : 0.35,
      enabled: true,
    };
    if (await act(() => createRule(bookId, hero.id, rule))) {
      setAdding(false); setAction(''); setEmotions([]); setProbability('0.35');
    }
  };

  return (
    <div class="hero-rules">
      <div class="hero-ref__head">
        <span class="hero-ref__title">{t('hero_rules_title')}</span>
        <span class="hero-section__spacer" />
        {!adding && <button class="hero-link" type="button" onClick={() => setAdding(true)}>{t('hero_rule_add')}</button>}
      </div>
      {rules.length === 0 && !adding && <p class="hero-empty">{t('hero_rules_empty')}</p>}
      {rules.map((r) => (
        <div class={'hero-rule' + (r.enabled === false ? ' hero-rule--off' : '')} key={r.id}>
          <Switch checked={r.enabled !== false} ariaLabel={t('hero_rule_on')}
            onChange={(v) => { if (!busy) void act(() => patchRule(bookId, hero.id, r.id, { enabled: v })); }} />
          <div class="hero-rule__main">
            <div class="hero-rule__action">{r.then?.action || r.id}</div>
            <div class="hero-rule__meta">
              {(r.when?.emotion ?? []).map((e) => <span class="hero-chip hero-chip--sm" key={e}>{e}</span>)}
              {r.probability != null && <span class="hero-rule__num">{Math.round(r.probability * 100)}%</span>}
            </div>
          </div>
          <button class="hero-icon-btn" type="button" disabled={busy} aria-label={t('hero_rule_delete')} title={t('hero_rule_delete')}
            onClick={() => void act(() => deleteRule(bookId, hero.id, r.id))}>
            <IconClose width={16} height={16} />
          </button>
        </div>
      ))}
      {adding && (
        <div class="hero-rule-form">
          <Field label={t('hero_rule_action')} hint={t('hero_rule_action_hint')} value={action} onInput={setAction} />
          <div class="edit-field__label">{t('hero_rule_emotions')}</div>
          <div class="hero-rule-form__emotions">
            {BEHAVIOUR_EMOTIONS.map((e) => {
              const on = emotions.includes(e);
              return (
                <button key={e} type="button" aria-pressed={on} class={'hero-chip hero-chip--toggle' + (on ? ' hero-chip--on' : '')}
                  onClick={() => setEmotions((list) => (on ? list.filter((x) => x !== e) : [...list, e]))}>{e}</button>
              );
            })}
          </div>
          <Field label={t('hero_rule_probability')} value={probability} onInput={setProbability} />
          <div class="hero-ref__actions">
            <button class="btn btn--outlined hero-btn-sm" type="button" disabled={busy} onClick={() => setAdding(false)}>{t('hero_cancel')}</button>
            <button class="btn hero-btn-sm" type="button" disabled={busy || !canAdd} onClick={() => void add()}>{t('hero_rule_add')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reference images ─────────────────────────────────────────────────────

function ImageRefsBlock({ bookId, hero, busy, act, setError }: {
  bookId: string; hero: Hero; busy: boolean; act: Act; setError: (e: string | null) => void;
}): JSX.Element {
  const refs = hero.image_refs ?? [];
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const portrait = portraitIndex(hero);

  const upload = async (file: File) => {
    // uploadImageRef is wrapped so a missing endpoint degrades the block
    // instead of surfacing a raw 404.
    let missing = false;
    const ok = await act(async () => {
      try { await uploadImageRef(bookId, hero.id, file, refs.length === 0 ? 'portrait' : 'other'); }
      catch (e) { if (isUnavailable(e)) { missing = true; return; } throw e; }
    });
    if (ok && missing) { setUnavailable(true); setError(null); }
  };

  return (
    <Section title={t('hero_section_images')}
      action={unavailable ? null : (
        <button class="hero-link" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{t('hero_img_upload')}</button>
      )}>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = '';
          if (file) void upload(file);
        }} />
      {unavailable && <p class="hero-empty">{t('hero_img_unavailable')}</p>}
      {refs.length === 0 && !unavailable && <p class="hero-empty"><IconImage width={16} height={16} /> {t('hero_img_empty')}</p>}
      {refs.length > 0 && (
        <div class="hero-images">
          {refs.map((r, i) => (
            <figure class={'hero-image' + (i === portrait ? ' hero-image--portrait' : '')} key={`${r.file}:${r.sha256}`}>
              {r.state === 'missing' || r.state === 'mismatch'
                ? <div class="hero-image__missing">{t(r.state === 'missing' ? 'hero_ref_missing' : 'hero_ref_mismatch')}</div>
                : <img class="hero-image__img" src={imageRefUrl(bookId, hero.id, i, r.sha256)} alt={r.note ?? ''} loading="lazy" />}
              <figcaption class="hero-image__bar">
                {i === portrait
                  ? <span class="hero-chip hero-chip--sm hero-chip--on">{t('hero_img_portrait')}</span>
                  : <button class="hero-link" type="button" disabled={busy} onClick={() => void act(() => patchImageRef(bookId, hero.id, i, { kind: 'portrait' }))}>{t('hero_img_make_portrait')}</button>}
                <button class="hero-icon-btn" type="button" disabled={busy} aria-label={t('hero_img_delete')} title={t('hero_img_delete')}
                  onClick={() => void act(() => deleteImageRef(bookId, hero.id, i))}>
                  <IconClose width={14} height={14} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Section>
  );
}
