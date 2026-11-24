// «Мои книги» — pure model of the list (no I/O, no signals).
// The list comes from GET /api/v1/books (the caller's workspace only); the
// server already orders it recently-opened first, the client keeps that order
// stable through sortMyBooks() (the same rule — Android MyBooksModel.kt).
import type { RecentBook } from '../../api/models';

export type MyBookAction = 'delete_content' | 'delete_book';

/** A book of an unsupported format (VBook 3.1 or no version): only «Удалить книгу». */
export function isLegacyBook(b: RecentBook): boolean {
  if (b.unsupported) return true;
  const v = b.vbook_version;
  if (v == null || v === '') return false; // an old server without the field — treat as current
  const major = Number(String(v).split('.')[0]);
  return !Number.isFinite(major) || major !== 4;
}

/** The format label: «VBook 4», «VBook 3.1». */
export function formatLabel(b: RecentBook): string {
  const v = b.vbook_version;
  return v == null || v === '' ? 'VBook' : `VBook ${v}`;
}

/** The moment shown next to a book: last opened, else last updated (epoch ms) or null. */
export function bookMoment(b: RecentBook): { kind: 'opened' | 'updated'; at: number } | null {
  if (typeof b.last_opened_at === 'number' && b.last_opened_at > 0) return { kind: 'opened', at: b.last_opened_at };
  if (typeof b.updated_at_ms === 'number' && b.updated_at_ms > 0) return { kind: 'updated', at: b.updated_at_ms };
  return null;
}

/** Recently opened first; a never-opened book by its last update (server rule). */
export function sortMyBooks(books: RecentBook[]): RecentBook[] {
  const key = (b: RecentBook) => (b.last_opened_at || b.updated_at_ms || 0);
  return [...books].sort((a, b) => key(b) - key(a));
}

/** Actions of a book's menu, in order. A legacy book: deletion only. */
export function bookActions(b: RecentBook): MyBookAction[] {
  return isLegacyBook(b) ? ['delete_book'] : ['delete_content', 'delete_book'];
}

/** «Удалить сгенерированный контент» is pointless when the server says there is none. */
export function contentActionEnabled(b: RecentBook): boolean {
  return b.has_generated_content !== false;
}

/** The title shown everywhere (confirmation included). */
export function bookTitle(b: Pick<RecentBook, 'title' | 'book_id'>): string {
  const t = (b.title ?? '').trim();
  return t || b.book_id;
}
