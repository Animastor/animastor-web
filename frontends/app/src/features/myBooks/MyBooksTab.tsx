// «Мои книги» — the first tab of the Library (/library?tab=mine).
// Books of the user's workspace, recently opened first. Each book: title,
// format, date, «Открыть», a menu with «Удалить сгенерированный контент» and
// «Удалить книгу» (both confirmed, the confirmation names the book). A VBook
// 3.1 book: «устаревший формат», «Удалить книгу» only. Empty list: «Создать
// книгу» / «Открыть файл».
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, tf, currentLang } from '../../app/i18n';
import { navigate } from '../../app/router';
import { authMe } from '../../state/authStore';
import { closeBook, createBlankBook, importBookFromFile } from '../../state/fileStore';
import type { RecentBook } from '../../api/models';
import {
  bookActions, bookMoment, bookTitle, contentActionEnabled, formatLabel, isLegacyBook,
} from './myBooksModel';
import type { MyBookAction } from './myBooksModel';
import { loadMyBooks, myBooks, myBooksError, myBooksStatus, openFromLibrary } from './myBooksStore';
import { ConfirmBookAction } from './ConfirmBookAction';

function formatMoment(at: number): string {
  try {
    return new Date(at).toLocaleString(currentLang() === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(at).toISOString();
  }
}

export function MyBooksTab() {
  const me = authMe.value;
  const [pending, setPending] = useState<{ book: RecentBook; action: MyBookAction } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (me.authenticated) void loadMyBooks(); }, [me.authenticated]);
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [menuFor]);

  if (!me.authenticated) {
    return <div class="my-books__empty" data-testid="my-books-login"><p>{t('my_books_login_required')}</p></div>;
  }

  const status = myBooksStatus.value;
  const books = myBooks.value;

  const onCreate = () => {
    closeBook();
    void createBlankBook().then((id) => { if (id) navigate('/edit'); });
  };
  const onFile = (f: File | undefined) => {
    if (!f) return;
    void importBookFromFile(f);
    // The File screen shows the import progress and moves on to Play/Generate.
    navigate('/file');
  };

  return (
    <div class="my-books" data-testid="my-books">
      <input
        ref={fileRef}
        type="file"
        accept=".vbook,.epub,text/plain,.txt,application/octet-stream"
        style="display:none"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const f = input.files?.[0];
          input.value = '';
          onFile(f);
        }}
      />

      {status === 'error' && (
        <div class="my-books__error" role="alert">
          <span>{tf('my_books_load_failed', myBooksError.value ?? '')}</span>
          <button class="btn btn--outlined" onClick={() => void loadMyBooks()}>{t('my_books_retry')}</button>
        </div>
      )}

      {status === 'loading' && books.length === 0 && (
        <div class="progress"><div class="progress__bar" /></div>
      )}

      {status === 'ready' && books.length === 0 && (
        <div class="my-books__empty" data-testid="my-books-empty">
          <strong>{t('my_books_empty_title')}</strong>
          <p>{t('my_books_empty_desc')}</p>
          <div class="my-books__empty-actions">
            <button class="btn" onClick={onCreate} data-testid="my-books-create">{t('my_books_create')}</button>
            <button class="btn btn--outlined" onClick={() => fileRef.current?.click()} data-testid="my-books-open-file">
              {t('my_books_open_file')}
            </button>
          </div>
        </div>
      )}

      {books.length > 0 && (
        <ul class="my-books__list">
          {books.map((b) => {
            const legacy = isLegacyBook(b);
            const moment = bookMoment(b);
            return (
              <li class={'my-books__item' + (legacy ? ' my-books__item--legacy' : '')} key={b.book_id} data-testid="my-books-item">
                <div class="my-books__info">
                  <span class="my-books__title">{bookTitle(b)}</span>
                  <span class="my-books__meta">
                    <span class="my-books__format">{formatLabel(b)}</span>
                    {legacy && <span class="my-books__legacy" data-testid="my-books-legacy">{t('my_books_legacy')}</span>}
                    {moment && (
                      <span class="my-books__date">
                        {tf(moment.kind === 'opened' ? 'my_books_opened_at' : 'my_books_updated_at', formatMoment(moment.at))}
                      </span>
                    )}
                  </span>
                </div>
                <div class="my-books__actions">
                  {!legacy && (
                    <button class="btn" onClick={() => void openFromLibrary(b)} data-testid="my-books-open">{t('my_books_open')}</button>
                  )}
                  <span class="my-books__menu-wrap">
                    <button
                      class="toolbar__btn my-books__menu-btn"
                      aria-label={t('my_books_menu')}
                      title={t('my_books_menu')}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === b.book_id}
                      data-testid="my-books-menu"
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === b.book_id ? null : b.book_id); }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                    {menuFor === b.book_id && (
                      <div class="my-books__menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        {bookActions(b).map((action) => (
                          <button
                            key={action}
                            class="user-menu__item my-books__menu-item--danger"
                            role="menuitem"
                            data-testid={`my-books-${action}`}
                            disabled={action === 'delete_content' && !contentActionEnabled(b)}
                            onClick={() => { setMenuFor(null); setPending({ book: b, action }); }}
                          >
                            {action === 'delete_content' ? t('my_books_delete_content') : t('my_books_delete_book')}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending && (
        <ConfirmBookAction book={pending.book} action={pending.action} onClose={() => setPending(null)} />
      )}
    </div>
  );
}
