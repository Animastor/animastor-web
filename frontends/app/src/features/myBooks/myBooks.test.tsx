// @vitest-environment happy-dom
// «Мои книги» — one route for every shortcut (Library, Settings, account
// menu), the two Library tabs, the list with its actions and confirmations.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

vi.mock('./myBooksApi', () => ({
  MY_BOOKS_LIMIT: 500,
  fetchMyBooks: vi.fn(async () => ({ books: [] })),
  markBookOpened: vi.fn(),
  deleteBookContent: vi.fn(async () => ({ cleared: true })),
  deleteBookOnServer: vi.fn(async () => ({ deleted: true })),
}));

import * as api from './myBooksApi';
import type { RecentBook } from '../../api/models';
import { authMe } from '../../state/authStore';
import { LibraryPage } from '../../pages/LibraryPage';
import { SettingsPage } from '../../pages/SettingsPage';
import { UserMenu } from '../auth/UserMenu';
import { filePorts } from '../../app/fileAdapters';
import { myBooks, myBooksStatus } from './myBooksStore';

const mock = (name: keyof typeof api) => api[name] as unknown as ReturnType<typeof vi.fn>;
const here = () => location.pathname + location.search;

const signedIn = {
  authenticated: true,
  user: { id: 'u1', username: 'alice' },
  workspace: { id: 'w1', name: 'alice', type: 'personal' },
} as unknown as typeof authMe.value;

const BOOKS: RecentBook[] = [
  { book_id: 'bk_new', title: 'Мастер и Маргарита', vbook_version: 4, last_opened_at: Date.parse('2026-11-22T10:00:00Z'), has_generated_content: true },
  { book_id: 'bk_old', title: 'Старая книга', vbook_version: '3.1', unsupported: true, updated_at_ms: Date.parse('2026-01-01T00:00:00Z') },
];

beforeEach(() => {
  history.replaceState(null, '', '/');
  authMe.value = signedIn;
  myBooks.value = [];
  myBooksStatus.value = 'idle';
  mock('fetchMyBooks').mockResolvedValue({ books: BOOKS });
  // UserMenu refreshes /auth/me on mount — answer "still signed in"
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(signedIn), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('«Мои книги» — every shortcut leads to the Library on the «Мои книги» tab', () => {
  it('Library: the File screen «Библиотека» card → /library, which IS «Мои книги»', () => {
    filePorts.navigation.navigate('/library');
    expect(location.pathname).toBe('/library');
    const { getByTestId } = render(<LibraryPage path="/library" />);
    expect(getByTestId('library-tab-mine').getAttribute('aria-selected')).toBe('true');
    expect(getByTestId('my-books')).toBeTruthy();
  });

  it('Settings: the «Мои книги» row → /library?tab=mine', () => {
    history.replaceState(null, '', '/settings');
    const { getByTestId, queryByText } = render(<SettingsPage path="/settings" />);
    // the old «Очистить» block is gone
    expect(queryByText('Удалить vBook с сервера')).toBeNull();
    expect(queryByText('Delete vBook from Server')).toBeNull();
    expect(queryByText('Удалить Сториборд с сервера')).toBeNull();
    expect(queryByText('Delete Storyboard from Server')).toBeNull();
    fireEvent.click(getByTestId('settings-my-books'));
    expect(here()).toBe('/library?tab=mine');
  });

  it('Account menu: «Мои книги» → /library?tab=mine', async () => {
    const { getByRole, findByTestId } = render(<UserMenu />);
    fireEvent.click(getByRole('button', { name: /аккаунт|account/i }));
    fireEvent.click(await findByTestId('user-menu-my-books'));
    expect(here()).toBe('/library?tab=mine');
  });

  it('tabs: «Общая библиотека» → ?tab=public with the "coming soon" stub', () => {
    history.replaceState(null, '', '/library?tab=mine');
    const { getByTestId, rerender, queryByTestId } = render(<LibraryPage path="/library" url={here()} />);
    fireEvent.click(getByTestId('library-tab-public'));
    expect(here()).toBe('/library?tab=public');
    rerender(<LibraryPage path="/library" url={here()} />);
    expect(getByTestId('library-public-soon')).toBeTruthy();
    expect(queryByTestId('my-books')).toBeNull();
  });
});

describe('«Мои книги» — list', () => {
  it('shows title, format, date; a 3.1 book: «устаревший формат», no «Открыть», menu has «Удалить книгу» only', async () => {
    history.replaceState(null, '', '/library?tab=mine');
    const { findAllByTestId, getAllByTestId, queryByTestId, getByTestId } = render(<LibraryPage path="/library" />);
    const items = await findAllByTestId('my-books-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Мастер и Маргарита');
    expect(items[0].textContent).toContain('VBook 4');
    expect(items[1].textContent).toContain('VBook 3.1');
    expect(getByTestId('my-books-legacy')).toBeTruthy();
    expect(getAllByTestId('my-books-open')).toHaveLength(1); // only the v4 book

    fireEvent.click(items[1].querySelector('[data-testid="my-books-menu"]')!);
    expect(queryByTestId('my-books-delete_content')).toBeNull();
    expect(getByTestId('my-books-delete_book')).toBeTruthy();
  });

  it('«Удалить книгу»: the confirmation names the book; OK deletes that book', async () => {
    const { findAllByTestId, getByTestId } = render(<LibraryPage path="/library" />);
    const items = await findAllByTestId('my-books-item');
    fireEvent.click(items[1].querySelector('[data-testid="my-books-menu"]')!);
    fireEvent.click(getByTestId('my-books-delete_book'));
    expect(getByTestId('my-books-confirm-text').textContent).toContain('Старая книга');
    expect(mock('deleteBookOnServer')).not.toHaveBeenCalled();
    fireEvent.click(getByTestId('my-books-confirm-ok'));
    await waitFor(() => expect(mock('deleteBookOnServer')).toHaveBeenCalledWith('bk_old'));
  });

  it('«Удалить сгенерированный контент»: the confirmation names the book; OK clears that book only', async () => {
    const { findAllByTestId, getByTestId } = render(<LibraryPage path="/library" />);
    const items = await findAllByTestId('my-books-item');
    fireEvent.click(items[0].querySelector('[data-testid="my-books-menu"]')!);
    fireEvent.click(getByTestId('my-books-delete_content'));
    expect(getByTestId('my-books-confirm-text').textContent).toContain('Мастер и Маргарита');
    fireEvent.click(getByTestId('my-books-confirm-ok'));
    await waitFor(() => expect(mock('deleteBookContent')).toHaveBeenCalledWith('bk_new'));
    expect(mock('deleteBookOnServer')).not.toHaveBeenCalled();
  });

  it('empty list: «Создать книгу» / «Открыть файл»', async () => {
    mock('fetchMyBooks').mockResolvedValue({ books: [] });
    const { findByTestId, getByTestId } = render(<LibraryPage path="/library" />);
    expect(await findByTestId('my-books-empty')).toBeTruthy();
    expect(getByTestId('my-books-create')).toBeTruthy();
    expect(getByTestId('my-books-open-file')).toBeTruthy();
  });

  it('anonymous: no request, a sign-in hint', () => {
    authMe.value = { authenticated: false, user: null, workspace: null };
    const { getByTestId } = render(<LibraryPage path="/library" />);
    expect(getByTestId('my-books-login')).toBeTruthy();
    expect(mock('fetchMyBooks')).not.toHaveBeenCalled();
  });
});
