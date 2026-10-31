// ═══════════════════════════════════════════════════════════════
//  Generation command errors (Stage 155 — generation only by command)
// ═══════════════════════════════════════════════════════════════
//  POST /book/{id}/regenerate answers 409 { error: 'layer_disabled',
//  disabled_worker_types: [...] } when every requested layer is switched
//  off in layer-config: no task is created. The user must see WHY instead
//  of a silent failure. Any other 409 (e.g. "Regeneration already in
//  progress") keeps the existing generic handling. Pure — mirrors Android
//  GenerationCommandErrors (TaskStatusHelpers.kt).
// ═══════════════════════════════════════════════════════════════

export type StartErrorKind =
  | { kind: 'layer_disabled'; workerTypes: string[] }
  | { kind: 'other'; message: string };

interface ErrorLike { status?: number; message?: string; body?: unknown }

/** Classify a failed /regenerate call. `requested` is the command's worker
 *  types — the fallback when the server body lists none. */
export function classifyStartError(e: unknown, requested: string[]): StartErrorKind {
  const err = (e ?? {}) as ErrorLike;
  const body = (err.body ?? null) as { error?: unknown; disabled_worker_types?: unknown } | null;
  if (err.status === 409 && body && body.error === 'layer_disabled') {
    const listed = Array.isArray(body.disabled_worker_types)
      ? body.disabled_worker_types.filter((x): x is string => typeof x === 'string')
      : [];
    return { kind: 'layer_disabled', workerTypes: listed.length > 0 ? listed : [...requested] };
  }
  return { kind: 'other', message: err.message || String(e) };
}

/** Section labels («Аудио», «Изображения», «Видео») joined for the message. */
export function layerLabels(workerTypes: string[], label: (type: string) => string): string {
  return workerTypes.map(label).join('», «');
}
