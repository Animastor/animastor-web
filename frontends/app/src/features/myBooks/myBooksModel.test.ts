import { describe, expect, it } from 'vitest';
import type { RecentBook } from '../../api/models';
import {
  bookActions, bookMoment, bookTitle, contentActionEnabled, formatLabel, isLegacyBook, sortMyBooks,
} from './myBooksModel';
import { libraryTabFromSearch, libraryUrl } from '../../app/router';

const b = (over: Partial<RecentBook>): RecentBook => ({ book_id: 'x', ...over });

describe('«Мои книги» model', () => {
  it('a VBook 3.1 / unsupported book is legacy; 4 and "4.1" are current; missing version — current', () => {
    expect(isLegacyBook(b({ unsupported: true, vbook_version: '3.1' }))).toBe(true);
    expect(isLegacyBook(b({ vbook_version: '3.1' }))).toBe(true);
    expect(isLegacyBook(b({ vbook_version: 4 }))).toBe(false);
    expect(isLegacyBook(b({ vbook_version: '4.1' }))).toBe(false);
    expect(isLegacyBook(b({}))).toBe(false);
  });

  it('legacy: «Удалить книгу» only; current: content + book', () => {
    expect(bookActions(b({ unsupported: true, vbook_version: '3.1' }))).toEqual(['delete_book']);
    expect(bookActions(b({ vbook_version: 4 }))).toEqual(['delete_content', 'delete_book']);
  });

  it('content action is off only when the server says there is nothing generated', () => {
    expect(contentActionEnabled(b({ has_generated_content: false }))).toBe(false);
    expect(contentActionEnabled(b({ has_generated_content: true }))).toBe(true);
    expect(contentActionEnabled(b({ has_generated_content: null }))).toBe(true);
  });

  it('recently opened first, never-opened by last update', () => {
    const sorted = sortMyBooks([
      b({ book_id: 'old', last_opened_at: 100, updated_at_ms: 1 }),
      b({ book_id: 'never', last_opened_at: null, updated_at_ms: 150 }),
      b({ book_id: 'fresh', last_opened_at: 200 }),
    ]);
    expect(sorted.map((x) => x.book_id)).toEqual(['fresh', 'never', 'old']);
  });

  it('date: opened beats updated; none → null', () => {
    expect(bookMoment(b({ last_opened_at: 5, updated_at_ms: 9 }))).toEqual({ kind: 'opened', at: 5 });
    expect(bookMoment(b({ updated_at_ms: 9 }))).toEqual({ kind: 'updated', at: 9 });
    expect(bookMoment(b({}))).toBeNull();
  });

  it('format label and title fallback', () => {
    expect(formatLabel(b({ vbook_version: 4 }))).toBe('VBook 4');
    expect(formatLabel(b({ vbook_version: '3.1' }))).toBe('VBook 3.1');
    expect(bookTitle({ book_id: 'id1', title: '  ' })).toBe('id1');
    expect(bookTitle({ book_id: 'id1', title: 'Мастер' })).toBe('Мастер');
  });

  it('library address: ?tab=mine|public, default — «Мои книги»', () => {
    expect(libraryUrl('mine')).toBe('/library?tab=mine');
    expect(libraryUrl('public')).toBe('/library?tab=public');
    expect(libraryTabFromSearch('')).toBe('mine');
    expect(libraryTabFromSearch('?tab=public')).toBe('public');
    expect(libraryTabFromSearch('?tab=zzz')).toBe('mine');
  });
});
