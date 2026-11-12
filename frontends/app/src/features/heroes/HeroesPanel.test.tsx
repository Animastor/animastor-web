// @vitest-environment happy-dom
// Heroes tab — grid + hero sheet against the v4 hero API (HERO_CARD.md §9).
// The API layer is mocked: these tests fix WHAT the card sends and WHEN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

vi.mock('./heroApi', async (orig) => {
  const real = await orig<typeof import('./heroApi')>();
  return {
    ...real,
    createHero: vi.fn(async () => ({ hero_id: 'ivan' })),
    patchHero: vi.fn(async () => ({})),
    deleteHero: vi.fn(async () => ({})),
    createRule: vi.fn(async () => ({})),
    patchRule: vi.fn(async () => ({})),
    deleteRule: vi.fn(async () => ({})),
    listVoiceCandidates: vi.fn(async () => ({ candidates: [] })),
    designVoiceCandidates: vi.fn(async () => ({})),
    uploadVoiceCandidate: vi.fn(async () => ({})),
    pinVoiceReference: vi.fn(async () => ({})),
    clearVoiceReference: vi.fn(async () => ({})),
    uploadImageRef: vi.fn(async () => ({})),
    patchImageRef: vi.fn(async () => ({})),
    deleteImageRef: vi.fn(async () => ({})),
  };
});

import { ApiError } from '../../api/client';
import * as api from './heroApi';
import { HeroesPanel } from './HeroesPanel';
import { globals, narrator, shopWomen, yura } from './heroFixtures';
import type { Hero } from './heroModel';

const mock = <K extends keyof typeof api>(name: K) => api[name] as unknown as ReturnType<typeof vi.fn>;

function mount(heroes: Hero[] = [yura, narrator, shopWomen], issues: unknown[] = []) {
  const onChanged = vi.fn(async () => {});
  const view = render(<HeroesPanel bookId="b1" heroes={heroes} globals={globals} issues={issues} onChanged={onChanged} />);
  return { ...view, onChanged };
}

const tile = (c: Element, name: string): HTMLElement =>
  [...c.querySelectorAll<HTMLElement>('.hero-tile')].find((el) => el.textContent?.includes(name))!;
const fieldByLabel = (c: Element, label: string): HTMLInputElement | HTMLTextAreaElement =>
  [...c.querySelectorAll<HTMLElement>('.hero-field')].find((el) => el.querySelector('.edit-field__label')?.textContent === label)!
    .querySelector('input, textarea')!;
const button = (c: Element, text: string): HTMLButtonElement =>
  [...c.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text))!;

beforeEach(() => {
  document.documentElement.setAttribute('lang', 'ru');
  vi.clearAllMocks();
  mock('listVoiceCandidates').mockImplementation(async () => ({ candidates: [] }));
});
afterEach(cleanup);

describe('heroes grid', () => {
  it('shows one tile per hero, the narrator first, plus the add tile', () => {
    const { container } = mount();
    const names = [...container.querySelectorAll('.hero-tile__name')].map((n) => n.textContent);
    expect(names).toEqual(['Диктор', 'Юра', 'Женщина в будочке', 'Добавить героя']);
  });

  it('opening the grid calls no API at all', () => {
    mount();
    for (const fn of Object.values(api)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });

  it('a broken hero file is a tile with the reason and an explicit delete', async () => {
    const issue = { file: 'characters/berlioz.json', hero_id: 'berlioz', code: 'invalid_json', message: 'Unexpected token }', blocking: true };
    const { container, onChanged } = mount([narrator], [issue]);
    const broken = container.querySelector('.hero-tile--broken')!;
    expect(broken.textContent).toContain('berlioz');
    expect(broken.textContent).toContain('Unexpected token }');
    fireEvent.click(button(broken as HTMLElement, 'Удалить файл'));
    expect(mock('deleteHero')).not.toHaveBeenCalled(); // confirmation first
    fireEvent.click(button(document.querySelector('.modal') as HTMLElement, 'Удалить'));
    await waitFor(() => expect(mock('deleteHero')).toHaveBeenCalledWith('b1', 'berlioz', { broken: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('add dialog: validates the id locally and creates a hero of the chosen kind', async () => {
    const { container, onChanged } = mount();
    fireEvent.click(tile(container, 'Добавить героя'));
    const modal = document.querySelector('.modal') as HTMLElement;
    const save = button(modal, 'Сохранить');
    expect(save.disabled).toBe(true); // no name yet
    fireEvent.input(fieldByLabel(modal, 'имя'), { target: { value: 'Иван' } });
    fireEvent.input(fieldByLabel(modal, 'id'), { target: { value: 'yura' } });
    expect(modal.textContent).toContain('Герой с таким id уже есть.');
    expect(save.disabled).toBe(true);
    fireEvent.input(fieldByLabel(modal, 'id'), { target: { value: 'ivan' } });
    fireEvent.click(button(modal, 'Только голос'));
    fireEvent.click(save);
    await waitFor(() => expect(mock('createHero')).toHaveBeenCalledWith('b1', { id: 'ivan', name: 'Иван', voice: {} }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('hero sheet', () => {
  async function openYura() {
    const view = mount();
    fireEvent.click(tile(view.container, 'Юра'));
    await waitFor(() => expect(mock('listVoiceCandidates')).toHaveBeenCalledWith('b1', 'yura'));
    return view;
  }

  it('opening a card only READS candidates — no generation, no writes', async () => {
    await openYura();
    expect(mock('designVoiceCandidates')).not.toHaveBeenCalled();
    expect(mock('patchHero')).not.toHaveBeenCalled();
    expect(mock('pinVoiceReference')).not.toHaveBeenCalled();
  });

  it('save sends one PATCH with only the changed fields and the rev', async () => {
    const { container, onChanged } = await openYura();
    const save = button(container, 'Сохранить');
    expect(save.disabled).toBe(true); // nothing changed
    fireEvent.input(fieldByLabel(container, 'одежда'), { target: { value: 'grey coat' } });
    fireEvent.input(fieldByLabel(container, 'алиасы'), { target: { value: 'Юрий\nЮрка\nЮрочка' } });
    expect(button(container, 'Сохранить').textContent).toContain('*');
    fireEvent.click(button(container, 'Сохранить'));
    await waitFor(() => expect(mock('patchHero')).toHaveBeenCalledTimes(1));
    expect(mock('patchHero')).toHaveBeenCalledWith('b1', 'yura',
      { 'passport.clothes': 'grey coat', aliases: ['Юрий', 'Юрка', 'Юрочка'] }, '0123456789abcdef');
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('an invalid draft cannot be saved', async () => {
    const { container } = await openYura();
    fireEvent.input(fieldByLabel(container, 'видео-токены'), { target: { value: 'a, b, c, d, e' } });
    expect(container.textContent).toContain('Видео-токенов не больше 4.');
    expect(button(container, 'Сохранить').disabled).toBe(true);
  });

  it('rev conflict is explained, the draft stays', async () => {
    mock('patchHero').mockRejectedValueOnce(new ApiError('rev_conflict', 409, undefined, { error: 'rev_conflict' }));
    const { container } = await openYura();
    fireEvent.input(fieldByLabel(container, 'имя'), { target: { value: 'Юрий Петрович' } });
    fireEvent.click(button(container, 'Сохранить'));
    await waitFor(() => expect(container.querySelector('.hero-sheet__error')?.textContent).toContain('Героя изменили в другом месте'));
    expect(fieldByLabel(container, 'имя').value).toBe('Юрий Петрович');
  });

  it('leaving a dirty card asks first', async () => {
    const { container } = await openYura();
    fireEvent.input(fieldByLabel(container, 'имя'), { target: { value: 'Юрий Петрович' } });
    fireEvent.click(button(container, 'К героям'));
    expect(document.querySelector('.modal')?.textContent).toContain('Несохранённые изменения');
    expect(container.querySelector('.hero-sheet')).not.toBeNull();
    fireEvent.click(button(document.body, 'Не сохранять'));
    expect(container.querySelector('.hero-grid')).not.toBeNull();
  });

  it('a rule switch is an immediate PATCH of that rule', async () => {
    const { container, onChanged } = await openYura();
    const switches = container.querySelectorAll<HTMLButtonElement>('.hero-rule .switch');
    expect([...switches].map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    fireEvent.click(switches[1]);
    await waitFor(() => expect(mock('patchRule')).toHaveBeenCalledWith('b1', 'yura', 'yura.angry', { enabled: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mock('patchHero')).not.toHaveBeenCalled();
  });

  it('a new rule gets a book-unique id and needs an action and an emotion', async () => {
    const { container } = await openYura();
    fireEvent.click(button(container, 'Добавить правило'));
    const form = container.querySelector('.hero-rule-form') as HTMLElement;
    expect(button(form, 'Добавить правило').disabled).toBe(true);
    fireEvent.input(fieldByLabel(form, 'действие'), { target: { value: 'goes silent' } });
    fireEvent.click(button(form, 'angry'));
    fireEvent.click(button(form, 'Добавить правило'));
    await waitFor(() => expect(mock('createRule')).toHaveBeenCalledTimes(1));
    expect(mock('createRule').mock.calls[0]).toEqual(['b1', 'yura',
      { id: 'yura.goes_silent', when: { emotion: ['angry'] }, then: { action: 'goes silent' }, probability: 0.35, enabled: true }]);
  });

  it('«Создать кандидатов» is the only generation command and carries the click', async () => {
    const { container } = await openYura();
    fireEvent.click(button(container, 'Создать кандидатов'));
    await waitFor(() => expect(mock('designVoiceCandidates')).toHaveBeenCalledTimes(1));
    const [bookId, heroId, action] = mock('designVoiceCandidates').mock.calls[0];
    expect([bookId, heroId]).toEqual(['b1', 'yura']);
    expect(action).toMatchObject({ kind: 'user_click', source: 'hero_card.voice_design' });
    expect(typeof action.action_id).toBe('string');
  });

  it('candidates cannot be created from an unsaved or empty timbre', async () => {
    const { container } = await openYura();
    fireEvent.input(fieldByLabel(container, 'тембр'), { target: { value: 'A girl.' } });
    expect(button(container, 'Создать кандидатов').disabled).toBe(true);
    expect(container.textContent).toContain('Сначала сохраните карточку.');
  });

  it('pinning a candidate is explicit; the pinned one is not offered again', async () => {
    mock('listVoiceCandidates').mockImplementation(async () => ({ candidates: [
      { name: 'ref_02.wav', file: 'voices/yura/ref_02.wav', sha256: 'x', pinned: true },
      { name: 'ref_03.wav', file: 'voices/yura/ref_03.wav', sha256: 'y', source: 'designed' },
    ] }));
    const { container } = await openYura();
    await waitFor(() => expect(container.querySelectorAll('.hero-ref__candidate').length).toBe(1));
    fireEvent.click(button(container.querySelector('.hero-ref__candidate') as HTMLElement, 'Закрепить'));
    await waitFor(() => expect(mock('pinVoiceReference')).toHaveBeenCalledWith('b1', 'yura', 'ref_03.wav'));
  });

  it('a server without reference endpoints degrades the block, not the card', async () => {
    mock('listVoiceCandidates').mockRejectedValue(new ApiError('Not Found', 404));
    const { container } = await openYura();
    await waitFor(() => expect(container.textContent).toContain('Референсы голоса на этом сервере пока недоступны.'));
    expect(container.querySelector('.hero-sheet__error')).toBeNull();
    expect(fieldByLabel(container, 'тембр').value).toContain('warm low baritone');
  });

  it('with a pinned reference the manner hint says it no longer shapes the sound', async () => {
    const { container } = await openYura();
    expect(container.textContent).toContain('манера на звук не влияет');
    cleanup();
    const free = mount([shopWomen, narrator]);
    fireEvent.click(tile(free.container, 'Женщина в будочке'));
    await waitFor(() => expect(free.container.querySelector('.hero-sheet')).not.toBeNull());
    expect(free.container.textContent).not.toContain('манера на звук не влияет');
  });

  it('a missing reference file is shown instead of the player', async () => {
    const lost: Hero = { ...yura, voice: { ...yura.voice!, reference_state: 'missing' } };
    const { container } = mount([lost, narrator]);
    fireEvent.click(tile(container, 'Юра'));
    await waitFor(() => expect(container.querySelector('.hero-badge--missing')?.textContent).toBe('файл не найден'));
    expect(container.querySelector('.hero-ref__pinned audio')).toBeNull();
  });

  it('the narrator has a voice only: no passport, habits, references or delete', async () => {
    const { container } = mount();
    fireEvent.click(tile(container, 'Диктор'));
    await waitFor(() => expect(container.querySelector('.hero-sheet')).not.toBeNull());
    const titles = [...container.querySelectorAll('.hero-section__title')].map((n) => n.textContent);
    expect(titles).toEqual(['Голос']);
    expect(button(container, 'Удалить героя')).toBeUndefined();
    expect(button(container, 'Убрать')).toBeUndefined();
  });

  it('delete asks for confirmation and returns to the grid', async () => {
    const { container, onChanged } = await openYura();
    fireEvent.click(button(container, 'Удалить героя'));
    expect(mock('deleteHero')).not.toHaveBeenCalled();
    fireEvent.click(button(document.querySelector('.modal') as HTMLElement, 'Удалить'));
    await waitFor(() => expect(mock('deleteHero')).toHaveBeenCalledWith('b1', 'yura'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(container.querySelector('.hero-grid')).not.toBeNull();
  });
});
