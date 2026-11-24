// «Мои книги» — server calls. Every route is workspace-scoped on the server
// (GET /books — the caller's workspace; /book/:id/* — requireBookAccess).
import { deleteJson, getJson, postJson } from '../../api/client';
import type { RecentBooksResponse } from '../../api/models';

/** The whole list of the workspace (the server caps one call at 500). */
export const MY_BOOKS_LIMIT = 500;

export function fetchMyBooks(): Promise<RecentBooksResponse> {
  return getJson<RecentBooksResponse>(`/books?limit=${MY_BOOKS_LIMIT}`);
}

/**
 * «Книга открыта» — records last_opened_at on the server and nothing else.
 * Fire-and-forget: a failure never blocks opening the book.
 */
export function markBookOpened(bookId: string): void {
  if (!bookId) return;
  void postJson(`/book/${encodeURIComponent(bookId)}/opened`).catch(() => { /* best effort */ });
}

/** DELETE /book/:id/cache — generated content only; text, heroes, voices/ stay. */
export function deleteBookContent(bookId: string): Promise<unknown> {
  return deleteJson(`/book/${encodeURIComponent(bookId)}/cache`);
}

/** DELETE /book/:id — the book and everything of it. */
export function deleteBookOnServer(bookId: string): Promise<unknown> {
  return deleteJson(`/book/${encodeURIComponent(bookId)}`);
}
