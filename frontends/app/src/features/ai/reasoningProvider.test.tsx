// @vitest-environment happy-dom
// Owner's decisions on the step-5 questions (VBook v4 step 6):
//  - reasoning_budget_exhausted names the provider: personal → /settings/ai;
//    system → «ask the administrator», an administrator gets a link to /admin;
//  - the prompt profile (PUT /connectors/profiles) is admin-only: others see it read-only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

const calls: { method: string; path: string; body?: unknown }[] = [];

vi.mock('../../api/client', async (orig) => {
  const real = await orig<typeof import('../../api/client')>();
  return {
    ...real,
    getJson: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/connectors/profiles') return { profiles: { audio: 'calm', image: null, video: null }, options: { audio: ['calm', 'dramatic'], image: [], video: [] } };
      return {};
    }),
    putJson: vi.fn(async (path: string, body: unknown) => { calls.push({ method: 'PUT', path, body }); return {}; }),
    postJson: vi.fn(async (path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return {}; }),
    deleteJson: vi.fn(async () => ({})),
  };
});

import { authMe, isAdminUser } from '../../state/authStore';
import type { AuthUser } from '../../state/authStore';
import { ReasoningBudgetNotice, reasoningBudgetProvider, reasoningBudgetText } from './reasoning';
import { SettingsPage } from '../../pages/SettingsPage';

const SYSTEM_TEXT = '✗ Ошибка: The model exhausted its token limit on reasoning (finish_reason=length, empty content, max_tokens=4096). '
  + 'Provider: system. Ask the administrator to disable thinking (disable_thinking) or lower reasoning_effort of the system AI provider.';
const PERSONAL_TEXT = 'The model exhausted its token limit on reasoning (finish_reason=length, empty content, max_tokens=1). '
  + 'Provider: personal. Disable thinking in your AI provider settings (disable_thinking) or lower reasoning_effort.';

const signIn = (user: AuthUser | null) => { authMe.value = { authenticated: !!user, user, workspace: null }; };

beforeEach(() => { document.documentElement.setAttribute('lang', 'ru'); calls.length = 0; signIn(null); });
afterEach(cleanup);

describe('reasoning_budget_exhausted — who can change the provider', () => {
  it('reasoningBudgetProvider: the 400 field, the error field, the progress-text mark; null for an older backend', () => {
    expect(reasoningBudgetProvider(SYSTEM_TEXT)).toBe('system');
    expect(reasoningBudgetProvider(PERSONAL_TEXT)).toBe('personal');
    expect(reasoningBudgetProvider({ body: { error: 'x', code: 'reasoning_budget_exhausted', provider_source: 'system' } })).toBe('system');
    expect(reasoningBudgetProvider({ provider_source: 'personal' })).toBe('personal');
    expect(reasoningBudgetProvider(new Error(PERSONAL_TEXT))).toBe('personal');
    expect(reasoningBudgetProvider({ body: { error: SYSTEM_TEXT } })).toBe('system');
    expect(reasoningBudgetProvider('The model exhausted its token limit on reasoning (…). Disable thinking …')).toBeNull();
    expect(reasoningBudgetProvider({ provider_source: 'global' })).toBeNull();
    expect(reasoningBudgetProvider(null)).toBeNull();
  });
  it('personal → the text and a link to /settings/ai', () => {
    signIn({ id: 'u', username: 'alice', role: 'user' });
    const { container } = render(<ReasoningBudgetNotice provider="personal" />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/ai');
  });
  it('unknown (older backend) → as before, /settings/ai', () => {
    const { container } = render(<ReasoningBudgetNotice />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/ai');
  });
  it('system, a plain user → «обратитесь к администратору», no link', () => {
    signIn({ id: 'u', username: 'alice', role: 'user' });
    const { container } = render(<ReasoningBudgetNotice provider="system" />);
    expect(container.textContent).toContain('обратитесь к администратору');
    expect(container.querySelector('a')).toBeNull();
  });
  it('system, an administrator (role or is_admin from the allowlist) → a link to /admin', () => {
    for (const user of [{ id: 'a', username: 'root', role: 'admin' }, { id: 'b', username: 'boss', role: 'user', is_admin: true }]) {
      signIn(user);
      const { container, unmount } = render(<ReasoningBudgetNotice provider="system" />);
      expect(container.querySelector('a')?.getAttribute('href'), user.username).toBe('/admin');
      unmount();
    }
  });
  it('the chat bubble text follows the provider', () => {
    expect(reasoningBudgetText('system')).toContain('обратитесь к администратору');
    expect(reasoningBudgetText('personal')).toContain('в настройках AI-провайдера');
    expect(reasoningBudgetText(null)).toContain('в настройках AI-провайдера');
  });
  it('isAdminUser: is_admin or role admin', () => {
    expect(isAdminUser({ id: 'x', username: 'x', role: 'admin' })).toBe(true);
    expect(isAdminUser({ id: 'x', username: 'x', role: 'user', is_admin: true })).toBe(true);
    expect(isAdminUser({ id: 'x', username: 'x', role: 'user' })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });
});

describe('/settings/worker — the prompt profile is admin-only (step 6)', () => {
  it('a plain user sees it read-only with a hint; nothing is sent', async () => {
    signIn({ id: 'u', username: 'alice', role: 'user' });
    const { container } = render(<SettingsPage section="worker" />);
    await waitFor(() => expect(calls.some((c) => c.path === '/connectors/profiles')).toBe(true));
    const select = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'dramatic'))!;
    await waitFor(() => expect(select.disabled).toBe(true));
    expect(container.textContent).toContain('его меняет только администратор');
    fireEvent.change(select, { target: { value: 'dramatic' } });
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/connectors/profiles')).toBe(false);
  });
  it('an administrator changes it — PUT /connectors/profiles', async () => {
    signIn({ id: 'a', username: 'root', role: 'admin' });
    const { container } = render(<SettingsPage section="worker" />);
    await waitFor(() => expect(calls.some((c) => c.path === '/connectors/profiles')).toBe(true));
    const select = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'dramatic'))!;
    await waitFor(() => expect(select.disabled).toBe(false));
    fireEvent.change(select, { target: { value: 'dramatic' } });
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/connectors/profiles')?.body).toEqual({ type: 'audio', profile: 'dramatic' }));
  });
});
