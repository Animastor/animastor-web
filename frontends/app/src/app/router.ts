// SPA router on top of preact-router. Keeps tab state because pages persist their
// state in module-level stores (not in component state), exactly like Android
// Fragment.hide/show preserves Fragment instances.
export type Route =
  | '/file' | '/generate' | '/play' | '/edit' | '/navigate'
  | '/settings' | '/ai' | '/library'
  | '/workflows' | '/workflows/:name'
  | '/workflows/type/:type' | '/dev'
  | '/settings/vbook' | '/settings/worker' | '/settings/ai' | '/settings/private-workers'
  | '/settings/local-ai';

export const TAB_ROUTES: Route[] = ['/file', '/generate', '/play', '/edit', '/navigate'];
export const START_ROUTE: Route = '/file';

/** «Библиотека» tabs (web: /library?tab=mine|public; Android: the same screen with the tab). */
export type LibraryTab = 'mine' | 'public';
export const LIBRARY_TABS: readonly LibraryTab[] = ['mine', 'public'];
export type LibraryUrl = `/library?tab=${LibraryTab}`;

/** The one address of a library tab — every shortcut to «Мои книги» uses it. */
export function libraryUrl(tab: LibraryTab): LibraryUrl {
  return `/library?tab=${tab}`;
}

/** ?tab= of a location search → the tab; anything else → «Мои книги». */
export function libraryTabFromSearch(search: string): LibraryTab {
  const tab = new URLSearchParams(search).get('tab');
  return tab === 'public' ? 'public' : 'mine';
}

/**
 * «Мои книги» shortcut (Library, Settings, account menu): NOT a separate
 * screen — the Library on its «Мои книги» tab.
 */
export function openMyBooks(): void {
  navigate(libraryUrl('mine'));
}

export function navigate(route: Route | LibraryUrl, opts: { replace?: boolean } = {}): void {
  const url = route;
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  dispatchEvent(new PopStateEvent('popstate'));
}
