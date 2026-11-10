// behavior.json in the API (animastor-docs architecture/VBOOK_BEHAVIOUR.md).
//
// Disk/memory on the server are schema v2 ({schema_version, rules,
// characters}); GET /book returns `behaviors` as the FLAT character map
// (v2.1 shape) plus read-only `behavior_rules`. The editor renders one card
// per character entry. Defense in depth: service keys never become cards,
// and a raw v2 document (if a server ever sends one) is unwrapped to its
// `characters` map. Pure — no I/O. Android parity: BehaviorEntries.kt.
import type { BookBehaviorEntry } from './models';

/** Top-level keys of a v2 document that are never character ids. */
export const BEHAVIOR_RESERVED_KEYS: readonly string[] = ['schema_version', 'rules', 'characters', 'defaults'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Character entries of `bookData.behaviors` (flat map, or v2 document). */
export function behaviorCharacterEntries(raw: unknown): Record<string, BookBehaviorEntry> {
  if (!isPlainObject(raw)) return {};
  const source = raw.schema_version != null && isPlainObject(raw.characters) ? raw.characters : raw;
  const out: Record<string, BookBehaviorEntry> = {};
  for (const [key, value] of Object.entries(source)) {
    if (BEHAVIOR_RESERVED_KEYS.includes(key)) continue;
    if (!isPlainObject(value)) continue;
    out[key] = value as BookBehaviorEntry;
  }
  return out;
}
