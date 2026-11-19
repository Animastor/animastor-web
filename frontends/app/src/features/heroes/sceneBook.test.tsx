// @vitest-environment happy-dom
// Scene tab and book states (step 5): look_patch instead of passport.*,
// unknown_participant in the book's problem list, the VBook 3.1 state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { lookPatchFields, lookPatchText } from './sceneLooks';
import { BookProblems, UnsupportedBook } from './BookProblems';
import { unsupportedVbook } from './heroModel';
import { ApiError } from '../../api/client';

beforeEach(() => { document.documentElement.setAttribute('lang', 'ru'); });
afterEach(cleanup);

describe('scene look_patch (VBOOK_FORMAT_V4.md §4a.4)', () => {
  it('only changed fields, as look_patch.<hero>.<field>; never passport.*', () => {
    const fields = lookPatchFields(
      [{ charId: 'yura', fields: { appearance: '', clothes: 'no hat', video_tokens: 'man, coat' } }, { charId: '', fields: {} }],
      { yura: { clothes: 'a hat', video_tokens: ['man', 'coat'] } },
    );
    expect(fields).toEqual({ 'look_patch.yura.clothes': 'no hat' });
    expect(Object.keys(fields).some((k) => k.startsWith('passport.'))).toBe(false);
  });
  it('a block removed → its stored fields are cleared with ""', () => {
    expect(lookPatchFields([{ charId: '', fields: {} }], { anna: { appearance: 'pale' } }))
      .toEqual({ 'look_patch.anna.appearance': '' });
  });
  it('a new hero block sends its non-empty fields; an empty block sends nothing', () => {
    expect(lookPatchFields([{ charId: 'anna', fields: { appearance: ' wet hair ' } }, { charId: 'yura', fields: { clothes: ' ' } }], null))
      .toEqual({ 'look_patch.anna.appearance': 'wet hair' });
    expect(lookPatchText(['a', 'b'])).toBe('a, b');
    expect(lookPatchText(null)).toBe('');
  });
});

describe('BookProblems — unknown_participant on the Scene tab', () => {
  const issues = [
    { code: 'unknown_participant', participant: 'berlioz', scenes: [{ chapter_id: 'c1', scene_id: 's1' }, { chapter_id: 'c1', scene_id: 's2' }], message: 'm', blocking: false },
    { code: 'possible_duplicate', hero_id: 'a', of: 'b', blocking: false },
  ];
  it('lists the participant with a link per scene; the current scene is marked; a click opens the scene', () => {
    const onOpen = vi.fn();
    const { container } = render(<BookProblems issues={issues} currentChapterId="c1" currentSceneId="s2"
      sceneLabel={(c, s) => `${c} · ${s}`} onOpenScene={onOpen} />);
    expect(container.textContent).toContain('Участник «berlioz» не является героем книги');
    const links = [...container.querySelectorAll<HTMLButtonElement>('.book-problems__scenes button')];
    expect(links.map((l) => l.textContent)).toEqual(['c1 · s1', 'c1 · s2']);
    expect(links[1].getAttribute('aria-current')).toBe('true');
    fireEvent.click(links[0]);
    expect(onOpen).toHaveBeenCalledWith('c1', 's1');
  });
  it('nothing to show → renders nothing (a duplicate belongs to the hero card)', () => {
    const { container } = render(<BookProblems issues={[issues[1]]} sceneLabel={() => ''} onOpenScene={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('VBook 3.1 book — its own state', () => {
  it('the 409 body becomes the state with «delete and import again»', () => {
    const err = new ApiError('x', 409, 'unsupported_vbook_version', { error: 'unsupported_vbook_version', vbook_version: '3.1', supported: 4 });
    const info = unsupportedVbook(err)!;
    expect(info).toEqual({ version: '3.1', supported: 4 });
    const { container } = render(<UnsupportedBook info={info} />);
    expect(container.textContent).toContain('Формат книги не поддерживается');
    expect(container.textContent).toContain('VBook 3.1');
    expect(container.textContent).toContain('Удалите эту книгу и импортируйте исходный текст заново');
  });
});
