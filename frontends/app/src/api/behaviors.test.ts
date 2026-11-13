// behaviorCharacterEntries — service keys of behavior.json v2 never become
// editor cards (Android parity: BehaviorEntriesTest.kt).
import { describe, it, expect } from 'vitest';
import { behaviorCharacterEntries, BEHAVIOR_RESERVED_KEYS } from './behaviors';

describe('behaviorCharacterEntries', () => {
  it('flat API map (v2.1 shape) passes through', () => {
    const flat = { hero: { baseline: 'calm' }, side: { quirks: ['q'] } };
    expect(behaviorCharacterEntries(flat)).toEqual(flat);
  });

  it('service keys in a flat map are dropped', () => {
    expect(behaviorCharacterEntries({ schema_version: 2, rules: [], defaults: {}, hero: { baseline: 'x' } }))
      .toEqual({ hero: { baseline: 'x' } });
  });

  it('a raw v2 document is unwrapped to its characters', () => {
    const v2 = { schema_version: 2, rules: [{ id: 'r' }], characters: { hero: { baseline: 'x' } } };
    expect(behaviorCharacterEntries(v2)).toEqual({ hero: { baseline: 'x' } });
  });

  it('non-object values and empty input give no cards', () => {
    expect(behaviorCharacterEntries({ hero: 'oops', side: ['x'], ok: {} })).toEqual({ ok: {} });
    expect(behaviorCharacterEntries(null)).toEqual({});
    expect(behaviorCharacterEntries(undefined)).toEqual({});
    expect(behaviorCharacterEntries([])).toEqual({});
  });

  it('reserved list matches the backend contract', () => {
    expect([...BEHAVIOR_RESERVED_KEYS]).toEqual(['schema_version', 'rules', 'characters', 'defaults']);
  });
});
