// HeroesPanel — the «Heroes» tab of the editor (HERO_CARD.md §2): a grid of
// hero cards; a tap opens the hero sheet in place of the grid.
//
// The panel owns no book data: heroes come from the editor's bookData and every
// mutation ends with onChanged() (re-read GET /book). It replaces the former
// Characters / Voices / Behavior tabs — every scenario of those tabs lives on
// the hero sheet (HERO_CARD.md §1, scenario table).
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { ApiError } from '../../api/client';
import { t, tf } from '../../app/i18n';
import type { StrKey } from '../../app/i18n';
import { IconAdd, IconImage, IconVolumeUp } from '../../app/icons';
import { Modal } from '../../lib/ui';
import { HeroCard, Portrait, REF_STATUS_KEYS } from './HeroCard';
import { createHero, deleteHero } from './heroApi';
import {
  blockingIssues, findHero, heroKind, heroStats, isNarrator, orderHeroes, validateNewHeroId,
} from './heroModel';
import type { BehaviourGlobals, Hero, HeroIssue } from './heroModel';

type NewKind = 'character' | 'voice_only';

function Pips({ value, max }: { value: number; max: number }): JSX.Element {
  return (
    <span class="hero-pips" aria-label={`${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} class={'hero-pip' + (i < value ? ' hero-pip--on' : '')} />)}
    </span>
  );
}

function HeroTile({ bookId, hero, onOpen }: { bookId: string; hero: Hero; onOpen: () => void }): JSX.Element {
  const kind = heroKind(hero);
  const stats = heroStats(hero);
  const name = (hero.name ?? '').trim() || (isNarrator(hero) ? t('hero_kind_narrator') : hero.id);
  const role = isNarrator(hero) ? '' : (hero.role ?? '').trim();
  return (
    <button class={`hero-tile hero-tile--${kind}`} type="button" onClick={onOpen}>
      <Portrait bookId={bookId} hero={hero} size="grid" />
      <span class="hero-tile__name">{name}</span>
      <span class="hero-tile__role">{role || t(kind === 'narrator' ? 'hero_kind_narrator' : kind === 'voice_only' ? 'hero_kind_voice_only' : 'hero_kind_character')}</span>
      <span class="hero-tile__stats">
        {stats.passport !== null && (
          <span class="hero-stat" title={t('hero_section_passport')}><IconImage width={13} height={13} /><Pips value={stats.passport} max={3} /></span>
        )}
        {stats.voice !== null && (
          <span class="hero-stat" title={`${t('hero_section_voice')}: ${t(REF_STATUS_KEYS[stats.reference])}`}>
            <IconVolumeUp width={13} height={13} /><Pips value={stats.voice} max={2} />
            <span class={`hero-dot hero-dot--${stats.reference}`} />
          </span>
        )}
        {stats.rulesTotal > 0 && <span class="hero-stat" title={t('hero_rules_title')}>{tf('hero_stat_rules', stats.rulesOn, stats.rulesTotal)}</span>}
      </span>
    </button>
  );
}

export function HeroesPanel({ bookId, heroes: rawHeroes, globals, issues: rawIssues, onChanged }: {
  bookId: string;
  heroes: unknown;
  globals: BehaviourGlobals | null;
  issues: unknown;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const heroes = useMemo(() => orderHeroes(rawHeroes), [rawHeroes]);
  const broken = useMemo(() => blockingIssues(rawIssues), [rawIssues]);
  const issues = useMemo<HeroIssue[]>(() => (Array.isArray(rawIssues) ? rawIssues as HeroIssue[] : []), [rawIssues]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [brokenTarget, setBrokenTarget] = useState<HeroIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = findHero(heroes, openId);
  // The opened hero disappeared (deleted elsewhere / another book) → back to the grid.
  useEffect(() => { if (openId && !open) setOpenId(null); }, [openId, open]);
  useEffect(() => { setOpenId(null); }, [bookId]);

  const removeBroken = useCallback(async () => {
    const id = brokenTarget?.hero_id;
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHero(bookId, id, { broken: true });
      setBrokenTarget(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [bookId, brokenTarget, onChanged]);

  if (open) {
    return (
      <HeroCard bookId={bookId} hero={open} heroes={heroes} globals={globals} issues={issues}
        onChanged={onChanged} onClose={() => setOpenId(null)} />
    );
  }

  return (
    <div class="hero-grid-wrap">
      {heroes.length === 0 && broken.length === 0 && <div class="edit-empty-inline">{t('heroes_empty')}</div>}
      <div class="hero-grid">
        {heroes.map((h) => <HeroTile key={h.id} bookId={bookId} hero={h} onOpen={() => setOpenId(h.id)} />)}
        {broken.map((issue, i) => (
          <div class="hero-tile hero-tile--broken" key={`broken:${issue.file ?? i}`}>
            <span class="hero-tile__name">{issue.hero_id ?? issue.file ?? '?'}</span>
            <span class="hero-tile__role">{t('hero_broken_title')}</span>
            <span class="hero-tile__issue">{issue.message || issue.code}</span>
            {issue.hero_id && (
              <button class="hero-link hero-link--danger" type="button" onClick={() => { setError(null); setBrokenTarget(issue); }}>
                {t('hero_broken_delete')}
              </button>
            )}
          </div>
        ))}
        <button class="hero-tile hero-tile--add" type="button" onClick={() => { setError(null); setAddOpen(true); }}>
          <IconAdd width={28} height={28} />
          <span class="hero-tile__name">{t('heroes_add')}</span>
        </button>
      </div>

      {addOpen && (
        <AddHeroDialog bookId={bookId} existingIds={heroes.map((h) => h.id)}
          onClose={() => setAddOpen(false)}
          onCreated={async (id) => { setAddOpen(false); await onChanged(); setOpenId(id); }} />
      )}

      {brokenTarget && (
        <Modal title={t('hero_broken_title')} onClose={() => { if (!busy) setBrokenTarget(null); }}
          footer={[
            <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={() => setBrokenTarget(null)}>{t('hero_cancel')}</button>,
            <button key="d" class="btn btn--error-solid" type="button" disabled={busy} onClick={() => void removeBroken()}>{t('entity_delete')}</button>,
          ]}>
          <p class="modal__notice">{tf('hero_broken_confirm', brokenTarget.file ?? brokenTarget.hero_id ?? '')}</p>
          {error ? <p class="modal__notice hero-sheet__error">{error}</p> : <span />}
        </Modal>
      )}
    </div>
  );
}

function AddHeroDialog({ bookId, existingIds, onClose, onCreated }: {
  bookId: string; existingIds: string[]; onClose: () => void; onCreated: (id: string) => Promise<void>;
}): JSX.Element {
  const [kind, setKind] = useState<NewKind>('character');
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idError = validateNewHeroId(id, existingIds);
  const canSave = name.trim() !== '' && !idError && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(id.trim() ? { id: id.trim() } : {}),
        name: name.trim(),
        // The block that defines the kind is created empty; the sheet fills it.
        ...(kind === 'character' ? { passport: {} } : { voice: {} }),
      };
      const res = await createHero(bookId, body);
      await onCreated(res?.hero_id ?? id.trim());
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : undefined;
      const known: Record<string, StrKey> = { hero_exists: 'hero_id_taken', reserved_id: 'hero_id_reserved' };
      setError(code && known[code] ? t(known[code]) : (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={t('hero_add_title')} onClose={() => { if (!busy) onClose(); }}
      footer={[
        <button key="c" class="btn btn--outlined" type="button" disabled={busy} onClick={onClose}>{t('hero_cancel')}</button>,
        <button key="s" class="btn" type="button" disabled={!canSave} onClick={() => void save()}>{t('edit_save')}</button>,
      ]}>
      <div class="hero-add__kinds" role="radiogroup" aria-label={t('hero_add_kind')}>
        {(['character', 'voice_only'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k}
            class={'hero-chip hero-chip--toggle' + (kind === k ? ' hero-chip--on' : '')} onClick={() => setKind(k)}>
            {t(k === 'character' ? 'hero_kind_character' : 'hero_kind_voice_only')}
          </button>
        ))}
      </div>
      <p class="hero-field__hint">{t(kind === 'character' ? 'hero_add_kind_character_hint' : 'hero_add_kind_voice_hint')}</p>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('hero_field_name')}</span>
        <input class="edit-field__input" type="text" value={name} autofocus onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="edit-field hero-field">
        <span class="edit-field__label">{t('hero_field_id')}</span>
        <input class="edit-field__input" type="text" value={id} autocapitalize="off" spellcheck={false}
          onInput={(e) => setId((e.target as HTMLInputElement).value)} />
        <span class="hero-field__hint">{idError ? t(idError) : t('hero_add_id_hint')}</span>
      </label>
      {error ? <p class="modal__notice hero-sheet__error">{error}</p> : <span />}
    </Modal>
  );
}
