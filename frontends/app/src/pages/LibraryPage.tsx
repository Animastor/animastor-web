import { t } from '../app/i18n';
import { LIBRARY_TABS, libraryTabFromSearch, libraryUrl, navigate } from '../app/router';
import type { LibraryTab } from '../app/router';
import { MyBooksTab } from '../features/myBooks/MyBooksTab';

// Library — two tabs (2026-11-22, «Мои книги»):
//   /library?tab=mine   — «Мои книги», the books of the user's workspace;
//   /library?tab=public — «Общая библиотека», a "coming soon" stub for now
//                         (the public iframe page is no longer embedded).
// /library without ?tab= is «Мои книги». The shortcuts in Settings and in the
// account menu open this same page (router.openMyBooks) — no second screen.
// Android: LibraryFragment with the same two tabs.

const TAB_LABEL: Record<LibraryTab, 'library_tab_mine' | 'library_tab_public'> = {
  mine: 'library_tab_mine',
  public: 'library_tab_public',
};

export function LibraryPage(props: { path?: string; url?: string }) {
  // preact-router re-renders the route on every navigation (props.url changes),
  // so reading location here keeps the tab in step with the address.
  void props;
  const tab = libraryTabFromSearch(typeof location !== 'undefined' ? location.search : '');
  return (
    <section class="page library-page" data-testid="library-page">
      <div class="library-page__tabs" role="tablist" aria-label={t('library_title')}>
        {LIBRARY_TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            class={'library-page__tab' + (tab === k ? ' library-page__tab--active' : '')}
            data-testid={`library-tab-${k}`}
            onClick={() => { if (tab !== k) navigate(libraryUrl(k), { replace: true }); }}
          >
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </div>
      <div class="library-page__body" role="tabpanel">
        {tab === 'mine' ? <MyBooksTab /> : (
          <div class="my-books__empty" data-testid="library-public-soon">
            <strong>{t('coming_soon')}</strong>
            <p>{t('library_public_soon')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
