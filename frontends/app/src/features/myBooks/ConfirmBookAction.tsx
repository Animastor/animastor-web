// The one confirmation of a book action — «Мои книги» list, the File-screen
// 3.1 panel and the editor's 3.1 state use it, so the text (with the book
// title) is the same everywhere.
import { useState } from 'preact/hooks';
import { Modal, toast } from '../../lib/ui';
import { t, tf } from '../../app/i18n';
import type { RecentBook } from '../../api/models';
import type { MyBookAction } from './myBooksModel';
import { bookTitle } from './myBooksModel';
import { runBookAction } from './myBooksStore';

export function confirmText(action: MyBookAction, title: string): string {
  return action === 'delete_content'
    ? tf('my_books_delete_content_confirm', title)
    : tf('my_books_delete_book_confirm', title);
}

export function ConfirmBookAction({ book, action, onClose, onDone }: {
  book: Pick<RecentBook, 'book_id' | 'title'>;
  action: MyBookAction;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const title = bookTitle(book);
  const label = action === 'delete_content' ? t('my_books_delete_content') : t('my_books_delete_book');
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runBookAction(book as RecentBook, action);
      toast(action === 'delete_content' ? t('my_books_content_deleted') : t('my_books_book_deleted'));
      onDone?.();
      onClose();
    } catch (e) {
      toast(tf('ai_error', (e as Error).message), 4000);
      setBusy(false);
    }
  };
  return (
    <Modal title={label} onClose={() => { if (!busy) onClose(); }}>
      <p class="modal__notice" data-testid="my-books-confirm-text">{confirmText(action, title)}</p>
      <div class="modal__footer">
        <button class="btn btn--outlined" onClick={() => { if (!busy) onClose(); }} disabled={busy}>
          {t('dialog_cancel')}
        </button>
        <button class="btn btn--error" onClick={() => void run()} disabled={busy} data-testid="my-books-confirm-ok">
          {busy ? t('play_loading') : label}
        </button>
      </div>
    </Modal>
  );
}
