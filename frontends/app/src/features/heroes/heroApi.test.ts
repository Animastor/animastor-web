// @vitest-environment happy-dom
// Hero API on the wire (VBOOK_FORMAT_V4.md §12е; HERO_CARD.md §10 п.1–10):
// what heroApi sends to fetch and how it reads the answers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorBodyCode, errorBodyMessage } from '../../api/client';
import {
  createHero, deleteBrokenHeroFile, deleteHero, deleteVoiceCandidate, listVoiceCandidates, patchHero,
  pinVoiceReference, uploadVoiceCandidate, userClick,
} from './heroApi';

type Call = { url: string; init: RequestInit };
function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); });

const click = () => userClick(new MouseEvent('click'), 'hero_card.voice_upload');

describe('heroApi — the step-4 contract', () => {
  it('POST /heroes → 201 {hero_id, hero, rev} is a success', async () => {
    const calls = stubFetch(201, { hero_id: 'ivan', hero: { id: 'ivan' }, rev: 'r1' });
    const res = await createHero('b1', { name: 'Иван', voice: {} });
    expect(res).toEqual({ hero_id: 'ivan', hero: { id: 'ivan' }, rev: 'r1' });
    expect(calls[0].url).toMatch(/\/book\/b1\/heroes$/);
    expect(calls[0].init.method).toBe('POST');
  });

  it('PATCH carries if_rev; the answer brings dirty_scenes as an array', async () => {
    const calls = stubFetch(200, { hero: { id: 'yura' }, rev: 'r2', dirty_scenes: [{ chapter_id: 'c1', scene_id: 's1', reason: 'passport', dirty_layers: ['image'] }] });
    const res = await patchHero('b1', 'yura', { 'passport.clothes': 'coat' }, 'r1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ fields: { 'passport.clothes': 'coat' }, if_rev: 'r1' });
    expect(res.dirty_scenes).toHaveLength(1);
  });

  it('upload: multipart with file, ref_text and client_action as a JSON string', async () => {
    const calls = stubFetch(200, { name: 'c1.wav' });
    const file = new File([new Uint8Array([1])], 'me.wav', { type: 'audio/wav' });
    const action = click();
    await uploadVoiceCandidate('b1', 'yura', file, '  Мы закрыты. ', action);
    expect(calls[0].url).toMatch(/\/book\/b1\/heroes\/yura\/voice\/candidates\/upload$/);
    const form = calls[0].init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('ref_text')).toBe('Мы закрыты.');
    expect(JSON.parse(String(form.get('client_action')))).toEqual(action);
    expect(action).toMatchObject({ kind: 'user_click', source: 'hero_card.voice_upload' });
  });

  it('upload without a text sends no ref_text (the server transcribes)', async () => {
    const calls = stubFetch(200, { name: 'c1.wav' });
    await uploadVoiceCandidate('b1', 'yura', new File([new Uint8Array([1])], 'me.wav'), '  ', click());
    expect((calls[0].init.body as FormData).has('ref_text')).toBe(false);
  });

  it('a broken file without hero_id: DELETE /hero-files?file=<plain name>; with hero_id: ?broken=1', async () => {
    const calls = stubFetch(200, { deleted: true, file: 'Юра.json' });
    await deleteBrokenHeroFile('b1', 'Юра.json');
    expect(calls[0].url).toMatch(/\/book\/b1\/hero-files\?file=%D0%AE%D1%80%D0%B0\.json$/);
    expect(calls[0].init.method).toBe('DELETE');
    await deleteHero('b1', 'berlioz', { broken: true });
    expect(calls[1].url).toMatch(/\/book\/b1\/heroes\/berlioz\?broken=1$/);
  });

  it('candidates: GET is no-store; pin sends locked:true (+ ref_text only when given); delete by name', async () => {
    const calls = stubFetch(200, { candidates: [], pending: false, reference_outdated: false });
    await listVoiceCandidates('b1', 'yura');
    expect(calls[0].init.cache).toBe('no-store');
    await pinVoiceReference('b1', 'yura', 'c2.wav');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ name: 'c2.wav', locked: true });
    await pinVoiceReference('b1', 'yura', 'c3.wav', 'Исправленный текст.');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ name: 'c3.wav', locked: true, ref_text: 'Исправленный текст.' });
    await deleteVoiceCandidate('b1', 'yura', 'c3.wav');
    expect(calls[3].url).toMatch(/\/heroes\/yura\/voice\/candidates\/c3\.wav$/);
  });

  it('an error {error: code, message} → ApiError with the message as text and the code', async () => {
    stubFetch(409, { error: 'narrator_required', message: 'the narrator cannot be deleted' });
    const err = await deleteHero('b1', 'narrator').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('the narrator cannot be deleted');
    expect(err.code).toBe('narrator_required');
    expect(err.status).toBe(409);
  });
});

describe('errorBodyMessage / errorBodyCode', () => {
  it('message wins; an old {error: text} body keeps its text', () => {
    expect(errorBodyMessage({ error: 'rev_conflict', message: 'The hero changed' })).toBe('The hero changed');
    expect(errorBodyMessage({ error: 'Book not found' })).toBe('Book not found');
    expect(errorBodyMessage({ error: 'x', message: '  ' })).toBe('x');
    expect(errorBodyMessage(null)).toBe('');
  });
  it('code: `code` first, else a machine `error` next to a message', () => {
    expect(errorBodyCode({ error: 'Authentication required', code: 'login_required' })).toBe('login_required');
    expect(errorBodyCode({ error: 'rev_conflict', message: 'changed' })).toBe('rev_conflict');
    expect(errorBodyCode({ error: 'Book not found' })).toBeUndefined();
  });
});
