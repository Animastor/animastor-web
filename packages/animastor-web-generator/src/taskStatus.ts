// ═══════════════════════════════════════════════════════════════
//  GENERATION-PROGRESS DOMAIN — task status (command-only generation)
// ═══════════════════════════════════════════════════════════════
//  Backend Stage 155 (animastor-docs architecture/COMMAND_ONLY_GENERATION.md):
//  GET /book/{id}/progress-panel rows carry the registry task status.
//    status          'active' | 'completed' | 'cancelled' | 'blocked' | 'interrupted'
//    blocked         true when no live worker of the type exists
//    blocked_reason  'no_worker:<type>'
//    interrupted     true after a backend restart
//    cancelled       true for a cancelled command (unchanged field)
//  blocked / interrupted rows are visible but NOT running: no spinner, no
//  timer, no auto-retry — the user starts a NEW command (same type + scope).
//  Pure functions only (no host, no signals). Mirrors Android
//  TaskStatusHelpers.kt (ANDROID_WEB_PARITY rule 3).
// ═══════════════════════════════════════════════════════════════

/** Display state of one progress row. */
export type TaskRowState = 'active' | 'done' | 'cancelled' | 'blocked' | 'interrupted';

/** The status fields of a progress-panel task (wire names, all optional —
 *  a pre-Stage-155 backend sends none of them). */
export interface TaskStatusFields {
  status?: string | null;
  done?: boolean;
  cancelled?: boolean;
  blocked?: boolean;
  blocked_reason?: string | null;
  interrupted?: boolean;
}

/** Classify one server task. Precedence: cancelled > blocked > interrupted >
 *  done > active (a stopped command is never shown as finished or running). */
export function taskRowState(t: TaskStatusFields, done = !!t.done): TaskRowState {
  if (t.cancelled || t.status === 'cancelled') return 'cancelled';
  if (t.blocked || t.status === 'blocked') return 'blocked';
  if (t.interrupted || t.status === 'interrupted') return 'interrupted';
  if (done || t.status === 'completed') return 'done';
  return 'active';
}

/** blocked / interrupted: the command stopped and waits for a new one. */
export function isStoppedState(s: TaskRowState): boolean {
  return s === 'blocked' || s === 'interrupted';
}

const WORKER_TYPES = ['audio', 'image', 'video'] as const;
export type GpuWorkerType = typeof WORKER_TYPES[number];

/** Worker type a blocked task is missing: 'no_worker:image' → 'image'.
 *  Falls back to the row type (cover → image) when the reason is absent or
 *  malformed. */
export function blockedWorkerType(reason: string | null | undefined, rowType: string): GpuWorkerType | null {
  const m = /^no_worker:(audio|image|video)$/.exec((reason ?? '').trim());
  if (m) return m[1] as GpuWorkerType;
  return commandWorkerType(rowType);
}

/** The /regenerate worker type for a row type (the cover is an image task). */
export function commandWorkerType(rowType: string): GpuWorkerType | null {
  if (rowType === 'cover') return 'image';
  return (WORKER_TYPES as readonly string[]).includes(rowType) ? rowType as GpuWorkerType : null;
}

/** A new explicit command that repeats a stopped row (same type + scope). */
export interface RetryCommand {
  workerTypes: GpuWorkerType[];
  scope: string;
  chapterId: string | null;
  sceneId: string | null;
}

/** Retry / continue command for a blocked or interrupted row; null for any
 *  other state (there is nothing to repeat) or an unknown type. The scope
 *  targets are the ones /regenerate understands: whole_book → none,
 *  current_chapter → chapter, current_scene / from_current_scene → chapter +
 *  scene. */
export function retryCommandFor(row: {
  state: TaskRowState; type: string; scope: string;
  chapterId: string | null; sceneId: string | null;
}): RetryCommand | null {
  if (!isStoppedState(row.state)) return null;
  const type = commandWorkerType(row.type);
  if (!type) return null;
  const scope = row.scope || 'whole_book';
  const chapterId = scope === 'whole_book' ? null : row.chapterId;
  const sceneId = scope === 'current_scene' || scope === 'from_current_scene' ? row.sceneId : null;
  return { workerTypes: [type], scope, chapterId, sceneId };
}
