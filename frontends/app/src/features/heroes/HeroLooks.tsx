// HeroLooks — the «Looks» section of the hero sheet (HERO_CARD.md §5a), in
// the spirit of an RPG equipment screen: «Base (global)» + named looks. A
// look REPLACES passport fields; chapters and scenes reference it.
//
// Selecting a look shows the final characteristics (fields that differ from
// the base are highlighted, the base value stays visible under them), the
// slot for the look's reference image (generation is a future task — only
// the slot and image_ref exist) and where the look is in effect (a tap goes
// to that scene). Create / rename / edit / delete / assign are immediate
// actions through the look endpoints; nothing here generates anything.
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { t, tf } from '../../app/i18n';
import type { StrKey } from '../../app/i18n';
import { IconAdd, IconImage } from '../../app/icons';
import { Modal } from '../../lib/ui';
import { assignLook, createLook, deleteLook, lookImageUrl, patchLook } from './heroApi';
import {
  BASE_LOOK, LOOK_FIELDS, diffAssignment, diffLook, draftFromLook, findLook, isEmptyAssignment, lookFieldsFromDraft,
  lookPlaceKey, lookUsage, previewLook, tokensToText, validateLookDraft, validateNewLookId,
} from './heroModel';
import type { Hero, HeroLook, LookChapter, LookDraft, LookField, LookPlace } from './heroModel';

type Act = (fn: () => Promise<unknown>) => Promise<boolean>;

const FIELD_LABELS: Record<LookField, StrKey> = {
  appearance: 'field_appearance',
  clothes: 'field_clothes',
  video_tokens: 'field_video_tokens',
};

export function placeLabel(p: LookPlace): string {
  const chapter = p.chapterTitle.trim() || tf('look_place_chapter', p.chapterNumber ?? '?');
  return p.sceneId === null ? chapter : `${chapter} · ${p.sceneTitle.trim() || tf('look_place_scene', p.sceneNumber ?? '?')}`;
}

export function HeroLooks({ bookId, hero, chapters, busy, act, onNavigate }: {
  bookId: string;
  hero: Hero;
  chapters: LookChapter[];
  busy: boolean;
  act: Act;
  /** Go to a chapter / scene in the editor (sceneId null — first scene of the chapter). */
  onNavigate: (chapterId: string, sceneId: string | null) => void;
}): JSX.Element {
  const looks = hero.looks ?? [];
  const [selected, setSelected] = useState<string>(BASE_LOOK);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const usage = useMemo(() => lookUsage(chapters, hero.id), [chapters, hero.id]);

  const look = findLook(hero, selected);
  // The selected look was deleted (here or elsewhere) → back to the base.
  useEffect(() => { if (selected !== BASE_LOOK && !look) setSelected(BASE_LOOK); }, [selected, look]);
  useEffect(() => { setSelected(BASE_LOOK); }, [hero.id]);

  const [draft, setDraft] = useState<LookDraft>(() => draftFromLook(look));
  const lookKey = look ? JSON.stringify([look.id, look.label, look.fields, look.notes ?? '']) : '';
  useEffect(() => { setDraft(draftFromLook(look)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lookKey]);

  const resolved = previewLook(hero, look ? look.id : BASE_LOOK);
  const places = look ? usage[look.id] ?? [] : [];
  const forcedBase = usage[BASE_LOOK] ?? [];
  const changes = look ? diffLook(look, draft) : {};
  const dirty = Object.keys(changes).length > 0;
  const errors = look ? validateLookDraft(draft) : [];
  const set = <K extends keyof LookDraft>(key: K, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  if (!resolved) return <p class="hero-empty">{t('hero_passport_empty')}</p>;

  const draftValue: Record<LookField, string> = { appearance: draft.appearance, clothes: draft.clothes, video_tokens: draft.videoTokens };
  const draftKey: Record<LookField, keyof LookDraft> = { appearance: 'appearance', clothes: 'clothes', video_tokens: 'videoTokens' };
  const baseText = (f: LookField): string => (f === 'video_tokens' ? tokensToText(resolved.base.video_tokens) : resolved.base[f]);

  return (
    <div class="hero-looks">
      <div class="hero-looks__slots" role="tablist" aria-label={t('hero_section_looks')}>
        <button type="button" role="tab" aria-selected={!look}
          class={'hero-look-slot' + (!look ? ' hero-look-slot--on' : '')} onClick={() => setSelected(BASE_LOOK)}>
          <span class="hero-look-slot__name">{t('look_base')}</span>
          <span class="hero-look-slot__meta">{t('look_base_meta')}</span>
        </button>
        {looks.map((l) => (
          <button key={l.id} type="button" role="tab" aria-selected={look?.id === l.id}
            class={'hero-look-slot' + (look?.id === l.id ? ' hero-look-slot--on' : '') + (l.evidence?.status === 'suggested' ? ' hero-look-slot--suggested' : '')}
            onClick={() => setSelected(l.id)}>
            <span class="hero-look-slot__name">{l.label || l.id}</span>
            <span class="hero-look-slot__meta">
              {(usage[l.id] ?? []).length > 0 ? tf('look_slot_places', (usage[l.id] ?? []).length) : t('look_slot_unused')}
            </span>
          </button>
        ))}
        <button type="button" class="hero-look-slot hero-look-slot--add" disabled={busy} onClick={() => setCreating(true)}>
          <IconAdd width={18} height={18} />
          <span class="hero-look-slot__name">{t('look_add')}</span>
        </button>
      </div>

      <div class="hero-look">
        <div class="hero-look__image">
          {look?.image_ref && look.image_ref.state !== 'missing'
            ? <img class="hero-portrait__img" alt="" loading="lazy"
                src={lookImageUrl(bookId, hero.id, look.id, look.image_ref.sha256)} />
            : <span class="hero-look__image-empty"><IconImage width={22} height={22} />{t(look ? 'look_image_slot' : 'look_image_slot_base')}</span>}
        </div>

        <div class="hero-look__stats">
          {look && (
            <label class="edit-field hero-field">
              <span class="edit-field__label">{t('look_field_label')}</span>
              <input class="edit-field__input" type="text" value={draft.label} onInput={(e) => set('label', (e.target as HTMLInputElement).value)} />
            </label>
          )}
          {LOOK_FIELDS.map((f) => {
            const overridden = look ? draftValue[f].trim() !== '' : false;
            return (
              <div class={'hero-look-stat' + (overridden ? ' hero-look-stat--changed' : '')} key={f} data-field={f}>
                <div class="hero-look-stat__head">
                  <span class="edit-field__label">{t(FIELD_LABELS[f])}</span>
                  {overridden && <span class="hero-badge hero-badge--changed">{t('look_changed')}</span>}
                </div>
                {look
                  ? <textarea class="edit-field__input edit-field__input--area" rows={f === 'video_tokens' ? 1 : 2}
                      value={draftValue[f]} placeholder={baseText(f) || '—'}
                      onInput={(e) => set(draftKey[f], (e.target as HTMLTextAreaElement).value)} />
                  : <div class="hero-look-stat__value">{baseText(f) || '—'}</div>}
                {look && overridden && <div class="hero-look-stat__base">{tf('look_base_value', baseText(f) || '—')}</div>}
              </div>
            );
          })}
          {look && <p class="hero-field__hint">{t('look_fields_hint')}</p>}
          {look?.evidence?.quote && <blockquote class="hero-look__quote">«{look.evidence.quote}»</blockquote>}
          {errors.filter((e) => dirty || e !== 'look_err_empty').map((e) => <div class="hero-sheet__error" key={e}>{tf(e, 4)}</div>)}

          {look && (
            <div class="hero-ref__actions">
              <button class="btn hero-btn-sm" type="button" disabled={busy || !dirty || errors.length > 0}
                onClick={() => void act(() => patchLook(bookId, hero.id, look.id, changes))}>
                {dirty ? `${t('look_save')} *` : t('look_save')}
              </button>
              <button class="btn btn--outlined hero-btn-sm" type="button" disabled={busy || dirty} title={dirty ? t('look_save_first') : undefined}
                onClick={() => setAssigning(true)}>{t('look_assign')}</button>
              <button class="hero-link hero-link--danger" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('look_delete')}</button>
            </div>
          )}
        </div>
      </div>

      <div class="hero-look__places">
        <span class="hero-ref__title">{t('look_places_title')}</span>
        {!look && <span class="hero-look__place-note">{t('look_places_base')}</span>}
        {look && places.length === 0 && <span class="hero-look__place-note">{t('look_places_none')}</span>}
        {(look ? places : forcedBase).map((p) => (
          <button key={lookPlaceKey(p.chapterId, p.sceneId)} type="button" class="hero-chip hero-chip--toggle hero-look__place"
            title={t('look_place_go')} onClick={() => onNavigate(p.chapterId, p.sceneId)}>
            {placeLabel(p)}
          </button>
        ))}
      </div>

      {creating && (
        <CreateLookDialog hero={hero} onClose={() => setCreating(false)}
          onCreate={async (body) => {
            let id = body.id ?? '';
            const ok = await act(async () => { const res = await createLook(bookId, hero.id, body); id = res?.look_id ?? id; });
            if (ok) { setCreating(false); if (id) setSelected(id); }
            return ok;
          }} />
      )}

      {assigning && look && (
        <AssignLookDialog hero={hero} look={look} chapters={chapters} current={places} busy={busy}
          onClose={() => setAssigning(false)}
          onApply={async (checked) => {
            const { assign, release } = diffAssignment(places, checked);
            const ok = await act(async () => {
              if (!isEmptyAssignment(release)) await assignLook(bookId, hero.id, null, release);
              if (!isEmptyAssignment(assign)) await assignLook(bookId, hero.id, look.id, assign);
            });
            if (ok) setAssigning(false);
          }} />
      )}

      {confirmDelete && look && (
        <Modal title={t('look_delete_title')} onClose={() => { if (!busy) setConfirmDelete(false); }}
          footer={[
            <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('hero_cancel')}</button>,
            <button key="d" class="btn btn--error-solid" type="button" disabled={busy}
              onClick={() => void act(() => deleteLook(bookId, hero.id, look.id)).then((ok) => { if (ok) setConfirmDelete(false); })}>
              {t('entity_delete')}
            </button>,
          ]}>
          <p class="modal__notice">{tf('look_delete_confirm', look.label || look.id, places.length)}</p>
        </Modal>
      )}
    </div>
  );
}

function CreateLookDialog({ hero, onClose, onCreate }: {
  hero: Hero;
  onClose: () => void;
  onCreate: (body: { id?: string; label: string; fields: HeroLook['fields'] }) => Promise<boolean>;
}): JSX.Element {
  const [draft, setDraft] = useState<LookDraft>(() => draftFromLook(null));
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const idError = validateNewLookId(id, hero);
  const errors = validateLookDraft(draft);
  const set = (key: keyof LookDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const base = hero.passport ?? {};
  const canSave = !busy && !idError && errors.length === 0;

  return (
    <Modal title={t('look_add_title')} onClose={() => { if (!busy) onClose(); }}
      footer={[
        <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={onClose}>{t('hero_cancel')}</button>,
        <button key="s" class="btn" type="button" disabled={!canSave}
          onClick={() => { setBusy(true); void onCreate({ ...(id.trim() ? { id: id.trim() } : {}), label: draft.label.trim(), fields: lookFieldsFromDraft(draft) }).then((ok) => { if (!ok) setBusy(false); }); }}>
          {t('edit_save')}
        </button>,
      ]}>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('look_field_label')}</span>
        <input class="edit-field__input" type="text" value={draft.label} autofocus onInput={(e) => set('label', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('field_appearance')}</span>
        <textarea class="edit-field__input edit-field__input--area" rows={2} value={draft.appearance} placeholder={base.appearance ?? ''}
          onInput={(e) => set('appearance', (e.target as HTMLTextAreaElement).value)} />
      </label>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('field_clothes')}</span>
        <textarea class="edit-field__input edit-field__input--area" rows={2} value={draft.clothes} placeholder={base.clothes ?? ''}
          onInput={(e) => set('clothes', (e.target as HTMLTextAreaElement).value)} />
      </label>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('field_video_tokens')}</span>
        <input class="edit-field__input" type="text" value={draft.videoTokens} placeholder={tokensToText(base.video_tokens)}
          onInput={(e) => set('videoTokens', (e.target as HTMLInputElement).value)} />
      </label>
      <p class="hero-field__hint">{t('look_fields_hint')}</p>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('hero_field_id')}</span>
        <input class="edit-field__input" type="text" value={id} autocapitalize="off" spellcheck={false} onInput={(e) => setId((e.target as HTMLInputElement).value)} />
        <span class="hero-field__hint">{idError ? t(idError) : t('look_add_id_hint')}</span>
      </label>
    </Modal>
  );
}

function AssignLookDialog({ hero, look, chapters, current, busy, onClose, onApply }: {
  hero: Hero; look: HeroLook; chapters: LookChapter[]; current: LookPlace[]; busy: boolean;
  onClose: () => void; onApply: (checked: Set<string>) => Promise<void>;
}): JSX.Element {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(current.map((p) => lookPlaceKey(p.chapterId, p.sceneId))));
  const toggle = (key: string) => setChecked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const rows = chapters.filter((c) => c.chapter_id);

  return (
    <Modal title={tf('look_assign_title', look.label || look.id)} onClose={() => { if (!busy) onClose(); }}
      footer={[
        <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={onClose}>{t('hero_cancel')}</button>,
        <button key="s" class="btn" type="button" disabled={busy} onClick={() => void onApply(checked)}>{t('look_assign_apply')}</button>,
      ]}>
      <p class="hero-field__hint">{t('look_assign_hint')}</p>
      <div class="hero-assign">
        {rows.map((ch, ci) => {
          const chapterId = ch.chapter_id as string;
          const chKey = lookPlaceKey(chapterId, null);
          // Scenes are offered only where the hero takes part.
          const scenes = (ch.scenes ?? []).filter((s) => s.scene_id && (s.participants ?? []).includes(hero.id));
          const head = { chapterId, chapterNumber: ch.display_number ?? ci + 1, chapterTitle: ch.chapter_title ?? '' };
          return (
            <div class="hero-assign__chapter" key={chapterId}>
              <label class="hero-assign__row">
                <input type="checkbox" checked={checked.has(chKey)} onChange={() => toggle(chKey)} />
                <span>{placeLabel({ ...head, sceneId: null, sceneNumber: null, sceneTitle: '' })}</span>
              </label>
              {scenes.map((sc) => {
                const scKey = lookPlaceKey(chapterId, sc.scene_id as string);
                const number = sc.display_index ?? ((ch.scenes ?? []).indexOf(sc) + 1);
                return (
                  <label class="hero-assign__row hero-assign__row--scene" key={scKey}>
                    <input type="checkbox" checked={checked.has(scKey)} onChange={() => toggle(scKey)} />
                    <span>{sc.scene_title?.trim() || tf('look_place_scene', number)}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
