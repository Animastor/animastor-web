// «Мои книги» — list state + the three actions of a book (open, delete the
// generated content, delete the book). Host code: it may reach the session
// (generateStore / fileStore) and the player, because deleting the OPEN book
// must also release it on this client.
import { signal } from '@preact/signals';
import type { RecentBook } from '../../api/models';
import { bookId as openBookId, resetProgressState } from '../../state/generateStore';
import { closeBook, navigationEvent, openBookById, unsupportedBook } from '../../state/fileStore';
import { clearMediaCache, closeBook as closePlayerBook } from '@animastor/web-player';
import { deleteBookContent, deleteBookOnServer, fetchMyBooks } from './myBooksApi';
import { sortMyBooks } from './myBooksModel';
import type { MyBookAction } from './myBooksModel';
import { navigate } from '../../app/router';

export type MyBooksStatus = 'idle' | 'loading' | 'ready' | 'error';

export const myBooks = signal<RecentBook[]>([]);
export const myBooksStatus = signal<MyBooksStatus>('idle');
export const myBooksError = signal<string | null>(null);

let loadToken = 0;

export async function loadMyBooks(): Promise<void> {
  const token = ++loadToken;
  myBooksStatus.value = 'loading';
  myBooksError.value = null;
  try {
    const res = await fetchMyBooks();
    if (token !== loadToken) return;
    myBooks.value = sortMyBooks(res.books ?? []);
    myBooksStatus.value = 'ready';
  } catch (e) {
    if (token !== loadToken) return;
    myBooksError.value = (e as Error).message || 'error';
    myBooksStatus.value = 'error';
  }
}

/**
 * Run a confirmed action on a book. The server answers for its own workspace
 * only (403 otherwise). When the book is the one open on this client, the
 * client side goes too: «delete content» resets the player + progress (the
 * book stays open), «delete book» closes the book.
 */
export async function runBookAction(book: RecentBook, action: MyBookAction): Promise<void> {
  const id = book.book_id;
  const isOpen = openBookId.value === id;
  if (action === 'delete_content') {
    await deleteBookContent(id);
    if (isOpen) {
      await clearMediaCache().catch(() => 0);
      closePlayerBook();
      resetProgressState();
    }
  } else {
    await deleteBookOnServer(id);
    if (isOpen) {
      await clearMediaCache().catch(() => 0);
      closeBook();
    }
    if (unsupportedBook.value?.bookId === id) unsupportedBook.value = null;
    myBooks.value = myBooks.value.filter((b) => b.book_id !== id);
  }
  void loadMyBooks();
}

/**
 * «Открыть»: the same open flow as a ?book= deep link (fileStore.openBookById
 * — it also records «книга открыта» on the server), then the screen the File
 * flow would pick: Play when the book has media, else Generate. A legacy book
 * never gets here (no «Открыть» for it); if the server still answers 409 the
 * File screen shows the 3.1 state with «Удалить книгу».
 */
export async function openFromLibrary(book: RecentBook): Promise<void> {
  await openBookById(book.book_id);
  if (unsupportedBook.value) { navigate('/file'); return; }
  const ev = navigationEvent.value;
  if (ev) {
    navigationEvent.value = null;
    navigate(ev === 'play' ? '/play' : '/generate');
    return;
  }
  // The always-mounted desktop File panel may have consumed the event already
  // (it navigates itself); on an error the File screen shows the message.
  if (typeof location !== 'undefined' && location.pathname.startsWith('/library')) navigate('/file');
}
