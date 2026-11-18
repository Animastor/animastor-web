// @vitest-environment happy-dom
// GAP RSN-1 (step 5): provider reasoning settings in /settings/ai and in the
// admin system-AI form; the reasoning_budget_exhausted error in plain words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

const calls: { method: string; path: string; body?: unknown }[] = [];
let providerMeta: Record<string, unknown> | null = null;

vi.mock('../../api/client', async (orig) => {
  const real = await orig<typeof import('../../api/client')>();
  return {
    ...real,
    getJson: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/settings/ai/provider') return { provider: providerMeta, has_workspace_provider: !!providerMeta };
      if (path === '/admin/system-ai') return { enabled: true, provider: providerMeta };
      return {};
    }),
    putJson: vi.fn(async (path: string, body: unknown) => {
      calls.push({ method: 'PUT', path, body });
      return path === '/admin/system-ai' ? { enabled: true, provider: providerMeta } : { provider: providerMeta };
    }),
    postJson: vi.fn(async (path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return { ok: true, model: 'm' }; }),
    deleteJson: vi.fn(async () => ({})),
  };
});
vi.mock('../../state/authStore', async (orig) => {
  const real = await orig<typeof import('../../state/authStore')>();
  const me = { authenticated: true, user: { id: 'u1', username: 'admin', role: 'admin' }, workspace: null };
  return { ...real, fetchMe: vi.fn(async () => me) };
});

import { SettingsPage } from '../../pages/SettingsPage';
import { AdminPage } from '../../pages/AdminPage';
import { ReasoningBudgetNotice, isReasoningBudgetError, reasoningBody, reasoningFromMeta } from './reasoning';

const meta = (extra: Record<string, unknown> = {}) => ({
  workspace_id: 'w1', provider: 'x', provider_type: 'openai-compatible', endpoint: 'https://llm.example/v1', model: 'qwen/qwen3-32b',
  enabled: true, configured: true, has_api_key: true, api_key_masked: 'sk-…1234', status: 'ok', last_tested_at: null,
  disable_thinking: false, reasoning_effort: null, ...extra,
});

beforeEach(() => { document.documentElement.setAttribute('lang', 'ru'); calls.length = 0; providerMeta = null; });
afterEach(cleanup);

describe('reasoning helpers', () => {
  it('meta ↔ form ↔ body', () => {
    expect(reasoningFromMeta({ disable_thinking: true, reasoning_effort: 'low' })).toEqual({ disableThinking: true, effort: 'low' });
    expect(reasoningFromMeta({ reasoning_effort: 'turbo' })).toEqual({ disableThinking: false, effort: null });
    expect(reasoningFromMeta(null)).toEqual({ disableThinking: false, effort: null });
    expect(reasoningBody({ disableThinking: true, effort: null })).toEqual({ disable_thinking: true, reasoning_effort: null });
  });
  it('isReasoningBudgetError: by code or by the fixed backend text', () => {
    expect(isReasoningBudgetError({ code: 'reasoning_budget_exhausted' })).toBe(true);
    expect(isReasoningBudgetError('✗ Ошибка: The model exhausted its token limit on reasoning (finish_reason=length, empty content, max_tokens=4096).')).toBe(true);
    expect(isReasoningBudgetError(new Error('timeout'))).toBe(false);
    expect(isReasoningBudgetError(null)).toBe(false);
  });
  it('the notice explains and links to /settings/ai', () => {
    const { container } = render(<ReasoningBudgetNotice />);
    expect(container.textContent).toContain('израсходовала весь лимит ответа на рассуждение');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/ai');
  });
});

describe('/settings/ai — personal provider', () => {
  it('loads the stored settings, shows the hint, saves and tests them', async () => {
    providerMeta = meta({ disable_thinking: true, reasoning_effort: 'low' });
    const { container, getByText } = render(<SettingsPage section="ai" />);
    await waitFor(() => expect(container.querySelector('[data-testid="reasoning-settings"]')).not.toBeNull());
    const sw = container.querySelector('[data-testid="reasoning-settings"] .switch') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    const select = container.querySelector('[data-testid="reasoning-settings"] select') as HTMLSelectElement;
    expect(select.value).toBe('low');
    expect(container.textContent).toContain('Включайте для «думающих» моделей');
    fireEvent.click(sw); // off
    fireEvent.change(select, { target: { value: 'high' } });
    fireEvent.click(getByText('Проверить подключение'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ disable_thinking: false, reasoning_effort: 'high' });
    fireEvent.click(getByText('Сохранить'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeDefined());
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ disable_thinking: false, reasoning_effort: 'high', endpoint: 'https://llm.example/v1' });
  });
  it('«do not send» is null', async () => {
    providerMeta = meta({ reasoning_effort: 'medium' });
    const { container, getByText } = render(<SettingsPage section="ai" />);
    await waitFor(() => expect(container.querySelector('[data-testid="reasoning-settings"] select')).not.toBeNull());
    fireEvent.change(container.querySelector('[data-testid="reasoning-settings"] select')!, { target: { value: '' } });
    fireEvent.click(getByText('Сохранить'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeDefined());
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ disable_thinking: false, reasoning_effort: null });
  });
});

describe('admin — system AI provider', () => {
  it('the same settings go inside provider{} of PUT /admin/system-ai and into the test body', async () => {
    providerMeta = { ...meta(), created_at: 1, updated_at: 1 };
    const { container, getByText } = render(<AdminPage />);
    await waitFor(() => expect(container.querySelector('[data-testid="reasoning-settings"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="reasoning-settings"] .switch')!);
    fireEvent.change(container.querySelector('[data-testid="reasoning-settings"] select')!, { target: { value: 'minimal' } });
    fireEvent.click(getByText('Save provider'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/admin/system-ai')).toBeDefined());
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/admin/system-ai')!.body as { provider: Record<string, unknown> };
    expect(put.provider).toMatchObject({ disable_thinking: true, reasoning_effort: 'minimal' });
    fireEvent.click(getByText('Test connection'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/system-ai/test')).toBeDefined());
    expect(calls.find((c) => c.path === '/admin/system-ai/test')!.body).toMatchObject({ disable_thinking: true, reasoning_effort: 'minimal' });
  });
});
