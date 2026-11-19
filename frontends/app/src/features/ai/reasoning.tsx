// Reasoning settings of an AI provider (GAP RSN-1; VBOOK_FORMAT_V4.md §12б,
// EXPERIMENTAL_BETA_PERSONAL_AI_PROVIDER.md §18a).
//
// A provider (workspace — /settings/ai, system — admin) carries two optional
// settings the backend applies to EVERY /chat/completions body (analysis,
// chat assistant, connection test — services/ai-reasoning.js):
//   disable_thinking  boolean — chat_template_kwargs {enable_thinking:false}
//   reasoning_effort  null (not sent) | none | minimal | low | medium | high
// The analysis error `reasoning_budget_exhausted` (the model spent the whole
// token budget on reasoning) is shown in plain words. Who can fix it depends
// on the provider that answered (owner, step 6): the backend names it —
// `provider_source` of a 400 body, or «Provider: system|personal.» in the
// progress text:
//   personal → a link to /settings/ai;
//   system   → «ask the administrator»; an administrator gets a link to /admin.
import type { JSX } from 'preact';
import { t } from '../../app/i18n';
import { authMe, isAdminUser } from '../../state/authStore';
import { Switch } from '../../lib/ui';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export interface ReasoningValue {
  disableThinking: boolean;
  effort: ReasoningEffort | null;
}

export const DEFAULT_REASONING: ReasoningValue = { disableThinking: false, effort: null };

/** Provider meta (GET) → form value; unknown values fall back to the defaults. */
export function reasoningFromMeta(meta: unknown): ReasoningValue {
  const m = (meta && typeof meta === 'object' ? meta : {}) as { disable_thinking?: unknown; reasoning_effort?: unknown };
  const effort = typeof m.reasoning_effort === 'string' && (REASONING_EFFORTS as readonly string[]).includes(m.reasoning_effort)
    ? m.reasoning_effort as ReasoningEffort : null;
  return { disableThinking: m.disable_thinking === true, effort };
}

/** Form value → the PUT / test body fields (both always sent: the form is the truth). */
export function reasoningBody(v: ReasoningValue): { disable_thinking: boolean; reasoning_effort: ReasoningEffort | null } {
  return { disable_thinking: v.disableThinking, reasoning_effort: v.effort };
}

const BUDGET_TEXT = /reasoning_budget_exhausted|exhausted its token limit on reasoning/i;

/**
 * Is this error the «budget spent on reasoning» one? Matches the code (an
 * ApiError code / body.code / a string) or the fixed backend text that the
 * analysis progress carries («✗ Ошибка: The model exhausted its token limit
 * on reasoning …»).
 */
export function isReasoningBudgetError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'string') return BUDGET_TEXT.test(err);
  const e = err as { code?: unknown; message?: unknown; body?: { code?: unknown; error?: unknown } };
  if (e.code === 'reasoning_budget_exhausted' || e.body?.code === 'reasoning_budget_exhausted' || e.body?.error === 'reasoning_budget_exhausted') return true;
  return typeof e.message === 'string' && BUDGET_TEXT.test(e.message);
}

export type ReasoningProviderSource = 'system' | 'personal';

const PROVIDER_MARK = /Provider: (system|personal)\./;

/**
 * Who answered with reasoning_budget_exhausted: the structured field
 * (`provider_source` of the body / the error) or the fixed mark of the
 * progress text. null — an older backend that does not say.
 */
export function reasoningBudgetProvider(err: unknown): ReasoningProviderSource | null {
  if (err == null) return null;
  const pick = (v: unknown): ReasoningProviderSource | null => (v === 'system' || v === 'personal' ? v : null);
  if (typeof err === 'string') return pick(PROVIDER_MARK.exec(err)?.[1]);
  const e = err as { provider_source?: unknown; message?: unknown; body?: { provider_source?: unknown; error?: unknown } };
  return pick(e.provider_source) ?? pick(e.body?.provider_source)
    ?? (typeof e.message === 'string' ? pick(PROVIDER_MARK.exec(e.message)?.[1]) : null)
    ?? (typeof e.body?.error === 'string' ? pick(PROVIDER_MARK.exec(e.body.error)?.[1]) : null);
}

/** The plain-words text for the provider (the chat bubble uses it without a link). */
export function reasoningBudgetText(provider: ReasoningProviderSource | null): string {
  return provider === 'system' ? t('reasoning_budget_text_system') : t('reasoning_budget_text');
}

/**
 * The plain-words explanation and the place to fix it: the personal
 * provider → /settings/ai; the system one → «ask the administrator», with a
 * link to the admin panel for an administrator. Unknown (an older backend) →
 * the personal settings as before.
 */
export function ReasoningBudgetNotice({ provider = null }: { provider?: ReasoningProviderSource | null }): JSX.Element {
  if (provider === 'system') {
    const admin = isAdminUser(authMe.value.user);
    return (
      <p class="reasoning-budget" role="alert" data-testid="reasoning-budget" data-provider="system">
        {t('reasoning_budget_text_system')}{' '}
        {admin && <a class="hero-link" href="/admin">{t('reasoning_budget_link_admin')}</a>}
      </p>
    );
  }
  return (
    <p class="reasoning-budget" role="alert" data-testid="reasoning-budget" data-provider={provider ?? 'unknown'}>
      {t('reasoning_budget_text')}{' '}
      <a class="hero-link" href="/settings/ai">{t('reasoning_budget_link')}</a>
    </p>
  );
}

export function ReasoningSettings({ value, onChange, disabled }: {
  value: ReasoningValue; onChange: (v: ReasoningValue) => void; disabled?: boolean;
}): JSX.Element {
  return (
    <div class="reasoning-settings" data-testid="reasoning-settings">
      <div class="reasoning-settings__row">
        <span class="card__label">{t('reasoning_disable_thinking')}</span>
        <Switch checked={value.disableThinking} ariaLabel={t('reasoning_disable_thinking')}
          onChange={(v) => { if (!disabled) onChange({ ...value, disableThinking: v }); }} />
      </div>
      <p class="card__hint card__hint--wrap">{t('reasoning_disable_thinking_hint')}</p>
      <p class="card__label">{t('reasoning_effort')}</p>
      <select class="select" value={value.effort ?? ''} disabled={disabled} aria-label={t('reasoning_effort')}
        onChange={(e) => {
          const raw = (e.target as HTMLSelectElement).value;
          onChange({ ...value, effort: (REASONING_EFFORTS as readonly string[]).includes(raw) ? raw as ReasoningEffort : null });
        }}>
        <option value="">{t('reasoning_effort_default')}</option>
        {REASONING_EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>
      <p class="card__hint card__hint--wrap">{t('reasoning_effort_hint')}</p>
    </div>
  );
}
