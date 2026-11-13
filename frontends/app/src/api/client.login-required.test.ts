// Sign-in required (backend input-guard contract, 2026-11-13): a 401 from the
// API turns into ONE login prompt instead of a bare error; /auth/* is exempt.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isLoginRequired, setLoginRequiredHandler, getJson, getBlob, postMultipart, ApiError } from './client';
import { loginPrompt, claimLoginPrompt, requestLogin, authMe } from '../state/authStore';

const unauthorized = () => new Response(JSON.stringify({ error: 'Sign in required', code: 'login_required' }),
  { status: 401, headers: { 'Content-Type': 'application/json' } });

describe('isLoginRequired', () => {
  it('401 outside /auth/* only', () => {
    expect(isLoginRequired('/book/import', 401)).toBe(true);
    expect(isLoginRequired('/book/b1/download', 401)).toBe(true);
    expect(isLoginRequired('/auth/login', 401)).toBe(false);
    expect(isLoginRequired('/book/import', 403)).toBe(false);
    expect(isLoginRequired('/book/import', 400)).toBe(false);
  });
});

describe('client → login-required hook', () => {
  afterEach(() => { vi.unstubAllGlobals(); setLoginRequiredHandler(() => requestLogin()); });

  it('import (multipart), JSON and blob 401 call the hook; code is kept', async () => {
    const hook = vi.fn();
    setLoginRequiredHandler(hook);
    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));
    const err = (await postMultipart('/book/import', new Blob(['x'])).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('login_required');
    await getJson('/book/b1').catch(() => {});
    await getBlob('/book/b1/download').catch(() => {});
    expect(hook).toHaveBeenCalledTimes(3);
  });

  it('/auth/* 401 (wrong password) does not prompt', async () => {
    const hook = vi.fn();
    setLoginRequiredHandler(hook);
    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));
    await getJson('/auth/me').catch(() => {});
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('authStore login prompt', () => {
  it('one claim per prompt; no prompt for a signed-in user', () => {
    authMe.value = { authenticated: false, user: null, workspace: null };
    const before = loginPrompt.value;
    requestLogin();
    expect(loginPrompt.value).toBe(before + 1);
    expect(claimLoginPrompt()).toBe(true);
    expect(claimLoginPrompt()).toBe(false); // a second mounted menu does not open another dialog
    authMe.value = { authenticated: true, user: { id: 'u', username: 'u' }, workspace: null };
    requestLogin();
    expect(loginPrompt.value).toBe(before + 1);
    authMe.value = { authenticated: false, user: null, workspace: null };
  });
});
