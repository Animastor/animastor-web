// The VBook 3.1 state of the File screen: a book of an unsupported format
// the user tried to open (fileStore.unsupportedBook). Text + the one action
// left — «Удалить книгу» with the same confirmation as «Мои книги».
// Mounted next to FilePage (mobile route /file and the desktop File panel):
// the @animastor/web-file package stays untouched.
import { useEffect, useState } from 'preact/hooks';
import { t, tf } from '../../app/i18n';
import { unsupportedBook } from '../../state/fileStore';
import type { UnsupportedOpen } from '../../state/fileStore';
import { fetchMyBooks } from './myBooksApi';
import { myBooks } from './myBooksStore';
import { ConfirmBookAction } from './ConfirmBookAction';

/** The title of a book from the «Мои книги» list (fetched when not loaded); the id meanwhile. */
function useBookTitle(bookId: string): string {
  const known = myBooks.value.find((b) => b.book_id === bookId)?.title;
  const [title, setTitle] = useState<string | null>(known ?? null);
  useEffect(() => {
    if (known) { setTitle(known); return; }
    let alive = true;
    fetchMyBooks()
      .then((res) => { if (alive) setTitle(res.books?.find((b) => b.book_id === bookId)?.title ?? null); })
      .catch(() => { /* the id stays */ });
    return () => { alive = false; };
  }, [bookId, known]);
  return (title ?? '').trim() || bookId;
}

/** Text + «Удалить книгу» for a 3.1 book — shared by the File panel and the editor. */
export function UnsupportedBookActions({ info, onDeleted }: { info: UnsupportedOpen; onDeleted?: () => void }) {
  const title = useBookTitle(info.bookId);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button class="btn btn--outlined btn--error" onClick={() => setConfirm(true)} data-testid="vbook-unsupported-delete">
        {t('my_books_delete_book')}
      </button>
      {confirm && (
        <ConfirmBookAction
          book={{ book_id: info.bookId, title }}
          action="delete_book"
          onClose={() => setConfirm(false)}
          onDone={onDeleted}
        />
      )}
    </>
  );
}

export function UnsupportedBookPanel() {
  const info = unsupportedBook.value;
  if (!info) return null;
  return (
    <div class="edit-empty edit-empty--unsupported unsupported-panel" role="alert" data-testid="file-vbook-unsupported">
      <strong>{t('vbook_unsupported_title')}</strong>
      <span>{tf('vbook_unsupported_body', info.version, info.supported)}</span>
      <span class="edit-empty__hint">{t('vbook_unsupported_action')}</span>
      <UnsupportedBookActions info={info} />
    </div>
  );
}
