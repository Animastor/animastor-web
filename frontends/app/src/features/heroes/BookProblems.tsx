// Book-level states of the editor that are not a hero card (HERO_CARD.md §7).
//
// UnsupportedBook — a VBook 3.1 book: a final state, not an error to retry;
//   the only way on is to delete the book and import the source again.
// BookProblems — non-blocking problems of the book without a hero: a scene
//   participant that is no hero (`unknown_participant`, owner 18.11) with a
//   link to every scene that names it. Shown on the Scene tab.
import type { JSX } from 'preact';
import { t, tf } from '../../app/i18n';
import { unknownParticipants } from './heroModel';
import type { UnsupportedVbook } from './heroModel';
import { UnsupportedBookActions } from '../myBooks/UnsupportedBookPanel';

export function UnsupportedBook({ info, bookId }: { info: UnsupportedVbook; bookId?: string }): JSX.Element {
  return (
    <div class="edit-empty edit-empty--unsupported" role="alert" data-testid="vbook-unsupported">
      <strong>{t('vbook_unsupported_title')}</strong>
      <span>{tf('vbook_unsupported_body', info.version, info.supported)}</span>
      <span class="edit-empty__hint">{t('vbook_unsupported_action')}</span>
      {/* «Мои книги»: the one action left — the same confirmation as the list */}
      {bookId && <UnsupportedBookActions info={{ bookId, version: info.version, supported: info.supported }} />}
    </div>
  );
}

export function BookProblems({ issues, currentChapterId, currentSceneId, sceneLabel, onOpenScene }: {
  issues: unknown;
  currentChapterId?: string | null;
  currentSceneId?: string | null;
  /** «Глава 2 · Зима» for a scene link. */
  sceneLabel: (chapterId: string, sceneId: string) => string;
  onOpenScene: (chapterId: string, sceneId: string) => void;
}): JSX.Element | null {
  const unknown = unknownParticipants(issues);
  if (unknown.length === 0) return null;
  return (
    <div class="edit-card book-problems" data-testid="book-problems">
      <div class="edit-card__head"><span class="edit-card__title">{t('book_problems_title')}</span></div>
      {unknown.map((u) => (
        <div class="book-problems__row" key={u.participant}>
          <span class="book-problems__text">{tf('book_problem_unknown_participant', u.participant)}</span>
          <span class="book-problems__scenes">
            {u.scenes.map((s) => {
              const here = s.chapter_id === currentChapterId && s.scene_id === currentSceneId;
              return (
                <button key={`${s.chapter_id}/${s.scene_id}`} type="button"
                  class={'hero-link' + (here ? ' book-problems__here' : '')} aria-current={here ? 'true' : undefined}
                  onClick={() => onOpenScene(s.chapter_id, s.scene_id)}>
                  {sceneLabel(s.chapter_id, s.scene_id)}
                </button>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
