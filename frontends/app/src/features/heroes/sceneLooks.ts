// Scene tab — the one-off look patch of a scene (VBOOK_FORMAT_V4.md §4a.4).
//
// The scene editor keeps «passport in this scene» blocks {hero id, fields};
// the save turns them into PATCH /scene/:ch/:sc fields
// `look_patch.<hero_id>.<appearance|clothes|video_tokens>` — ONLY the changed
// ones; '' removes a field (the backend drops empty maps). `passport.*` of a
// scene is gone in VBook 4 (400 legacy_field) and is never sent.

export const LOOK_PATCH_FIELDS = ['appearance', 'clothes', 'video_tokens'] as const;

export interface LookPatchBlock {
  charId: string;
  fields: Record<string, string>;
}

type PatchValue = string | string[] | null | undefined;

/** A stored patch value as the editor text (video_tokens: "a, b"). */
export function lookPatchText(value: PatchValue): string {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}

/** Blocks of the scene editor → PATCH fields (diff against scene.look_patch). */
export function lookPatchFields(
  blocks: readonly LookPatchBlock[],
  existing: Record<string, Record<string, PatchValue> | null> | null | undefined,
): Record<string, string> {
  const desired = new Map<string, Record<string, string>>();
  for (const block of blocks) {
    const id = block.charId.trim();
    if (id === '' || !Object.values(block.fields).some((v) => v.trim() !== '')) continue;
    const m = desired.get(id) ?? {};
    for (const f of LOOK_PATCH_FIELDS) {
      const v = block.fields[f]?.trim() ?? '';
      if (v) m[f] = v;
    }
    desired.set(id, m);
  }
  const have = existing ?? {};
  const out: Record<string, string> = {};
  for (const id of new Set([...desired.keys(), ...Object.keys(have)])) {
    for (const f of LOOK_PATCH_FIELDS) {
      const next = desired.get(id)?.[f] ?? '';
      const prev = lookPatchText(have[id]?.[f]);
      if (next !== prev) out[`look_patch.${id}.${f}`] = next;
    }
  }
  return out;
}
