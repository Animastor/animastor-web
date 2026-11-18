// Authentication state (Account & Workspace MVP).
// Server-side session cookie is the source of truth; localStorage is never
// used for auth. The store only mirrors /auth/me.
import { signal } from '@preact/signals';
import { getJson, postJson, setLoginRequiredHandler } from '../api/client';
import { stashBookSessionForUser, restoreStashedBookSessionForUser } from './generateStore';

export interface AuthUser { id: string; username: string; display_name?: string | null; role?: string; is_admin?: boolean; }

/** Platform admin: the backend's is_admin (role OR ADMIN_USERNAMES); role='admin' for an older backend. */
export function isAdminUser(user: AuthUser | null | undefined): boolean {
  return !!user && (user.is_admin === true || user.role === 'admin');
}
export interface AuthWorkspace { id: string; name: string; type: string; }
export interface AuthMe { authenticated: boolean; identity?: string; user: AuthUser | null; workspace: AuthWorkspace | null; }

export const authMe = signal<AuthMe>({ authenticated: false, user: null, workspace: null });
export const authLoading = signal(false);
export const authError = signal<string | null>(null);

// Sign-in prompt: bumped when the server answers 401 to a caller that is not
// signed in (import, export, book data). The user menu opens the login dialog
// once per bump (loginPromptHandled guards against several mounted menus).
export const loginPrompt = signal(0);
let loginPromptHandled = 0;
export function requestLogin(): void {
  if (authMe.value.user) return; // signed in — a 401 is not about the session prompt
  loginPrompt.value = loginPrompt.value + 1;
}
/** Claims the current prompt; true for exactly one caller per bump. */
export function claimLoginPrompt(): boolean {
  if (loginPrompt.value <= loginPromptHandled) return false;
  loginPromptHandled = loginPrompt.value;
  return true;
}
setLoginRequiredHandler(() => requestLogin());

export async function fetchMe(): Promise<AuthMe> {
  try {
    // /auth/me is identity state: never let the browser HTTP cache answer it
    // (a cached pre-logout body is the "sticky account" trap).
    const me = await getJson<AuthMe>('/auth/me', { cache: 'no-store' });
    authMe.value = me;
    authError.value = null;
    return me;
  } catch {
    // Unauthenticated / server unreachable — reflect as anonymous.
    authMe.value = { authenticated: false, user: null, workspace: null };
    return authMe.value;
  }
}

export async function login(username: string, password: string): Promise<AuthMe> {
  authLoading.value = true;
  authError.value = null;
  try {
    const me = await postJson<AuthMe>('/auth/login', { username, password });
    authMe.value = me;
    // Current book session re-attach: if this user had a book open when they
    // last logged out, bring it back now (validated by restoreBookSession()).
    if (me?.user?.id) restoreStashedBookSessionForUser(me.user.id);
    return me;
  } catch (e) {
    authError.value = e instanceof Error ? e.message : 'login failed';
    throw e;
  } finally {
    authLoading.value = false;
  }
}

export async function register(username: string, password: string, email?: string): Promise<AuthMe> {
  authLoading.value = true;
  authError.value = null;
  try {
    const me = await postJson<AuthMe>('/auth/register', { username, password, email });
    authMe.value = me;
    return me;
  } catch (e) {
    authError.value = e instanceof Error ? e.message : 'registration failed';
    throw e;
  } finally {
    authLoading.value = false;
  }
}

export async function logout(): Promise<void> {
  authError.value = null;
  // Capture the identity BEFORE clearing it: the open book session is stashed
  // under the user's own key so the same user gets their book back on the
  // next login (the book itself stays owned by them in the DB).
  const userId = authMe.value.user?.id ?? null;
  try {
    await postJson<unknown>('/auth/logout', {});
  } catch { /* logout is idempotent server-side; cookie clear best-effort */ }
  // Current book session isolation: the live session (localStorage currentBook
  // key + open-book signals) must NOT survive into the
  // anonymous/guest context — otherwise a browser refresh would re-open the
  // previous user's book. Ownership is unchanged; the session is merely
  // stashed per-user by stashBookSessionForUser().
  stashBookSessionForUser(userId);
  authMe.value = { authenticated: false, user: null, workspace: null };
  // Re-read the server truth (the response is no-store) instead of trusting
  // the optimistic local reset — a stale /auth/me body must never come back.
  await fetchMe();
}
