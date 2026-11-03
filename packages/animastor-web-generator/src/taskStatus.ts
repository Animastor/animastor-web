// ═══════════════════════════════════════════════════════════════
//  GENERATION-PROGRESS DOMAIN — task status (command-only generation)
// ═══════════════════════════════════════════════════════════════
//  Backend Stage 155 (animastor-docs architecture/COMMAND_ONLY_GENERATION.md):
//  GET /book/{id}/progress-panel rows carry the registry task status.
//    status          'active' | 'completed' | 'cancelled' | 'blocked' |
//                    'interrupted' | 'failed'
//    blocked         true when no live worker of the type exists
//    blocked_reason  'no_worker:<type>'
//    interrupted     true after a backend restart
//    cancelled       true for a cancelled command (unchanged field)
//    failed          true for a terminally failed command (+ error_class /
//                    error_code / error_message / failed_scene)
//    retrying        true while an active row waits out a retry pause
//                    (+ retry_no / retry_max / retry_at)
//  blocked / interrupted / failed rows are visible but NOT running: no
//  spinner, no timer, no auto-retry — the user starts a NEW command (same
//  type + scope). A retrying row keeps the spinner: the SERVER retries.
//  Pure functions only (no host, no signals). Mirrors Android
//  TaskStatusHelpers.kt (ANDROID_WEB_PARITY rule 3).
// ═══════════════════════════════════════════════════════════════

/** Display state of one progress row. */
export type TaskRowState = 'active' | 'done' | 'cancelled' | 'blocked' | 'interrupted' | 'failed';

/** The scene a failed command died on (wire shape of `failed_scene`). */
export interface FailedSceneRef {
  chapter_id?: string | null;
  scene_id?: string | null;
}

/** The status fields of a progress-panel task (wire names, all optional —
 *  a pre-Stage-155 backend sends none of them). */
export interface TaskStatusFields {
  status?: string | null;
  done?: boolean;
  cancelled?: boolean;
  blocked?: boolean;
  blocked_reason?: string | null;
  interrupted?: boolean;
  failed?: boolean;
  failed_scene?: FailedSceneRef | null;
  error_class?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  retrying?: boolean;
  retry_no?: number | null;
  retry_max?: number | null;
  retry_at?: number | null;
}

/** Classify one server task. Precedence: cancelled > blocked > interrupted >
 *  failed > done > active (a stopped command is never shown as finished or
 *  running). */
export function taskRowState(t: TaskStatusFields, done = !!t.done): TaskRowState {
  if (t.cancelled || t.status === 'cancelled') return 'cancelled';
  if (t.blocked || t.status === 'blocked') return 'blocked';
  if (t.interrupted || t.status === 'interrupted') return 'interrupted';
  if (t.failed || t.status === 'failed') return 'failed';
  if (done || t.status === 'completed') return 'done';
  return 'active';
}

/** blocked / interrupted / failed: the command stopped and waits for a new one. */
export function isStoppedState(s: TaskRowState): boolean {
  return s === 'blocked' || s === 'interrupted' || s === 'failed';
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

/** Retry / continue command for a blocked, interrupted or failed row; null
 *  for any other state (there is nothing to repeat) or an unknown type. The
 *  scope targets are the ones /regenerate understands: whole_book → none,
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

// ═══════════════════════════════════════════════════════════════
//  GPU retry policy (reports/2026-11-02/gpu-retry-policy.md §ТЗ фронтам)
// ═══════════════════════════════════════════════════════════════

/** i18n keys of the failure reason (same keys in web i18n.ts and Android
 *  strings.xml, en + ru). */
export type FailureKey =
  | 'task_failed_comfy_nodes'
  | 'task_failed_comfy_model'
  | 'task_failed_comfy_rejected'
  | 'task_failed_transient'
  | 'task_failed_oom'
  | 'task_failed_unknown';

/** A failure reason as an i18n key + argument (argument null → the text
 *  without the « — %1$s» suffix). */
export interface FailureText {
  key: FailureKey;
  arg: string | null;
}

/** First line only, ellipsis when the server text had more lines (the
 *  frontend never parses the message). */
function firstLine(message: string | null | undefined): string | null {
  const s = (message ?? '').trim();
  if (!s) return null;
  const nl = s.search(/\r?\n/);
  if (nl >= 0) return `${s.slice(0, nl).trimEnd()}…`;
  return s;
}

/** Classify a terminal failure into an i18n key + argument (the table in
 *  §ТЗ фронтам п.3). `type` is the row type — accepted for signature parity
 *  with Android; the key selection does not depend on it. */
export function failureText(
  errorClass: string | null | undefined,
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  type: string
): FailureText {
  void type;
  const arg = firstLine(errorMessage);
  const cls = (errorClass ?? '').trim().toLowerCase();
  const code = (errorCode ?? '').trim().toLowerCase();
  if (code === 'comfy_missing_node') return { key: 'task_failed_comfy_nodes', arg };
  if (code === 'comfy_model_missing') return { key: 'task_failed_comfy_model', arg };
  if (cls === 'deterministic') return { key: 'task_failed_comfy_rejected', arg };
  if (cls === 'transient') return { key: 'task_failed_transient', arg };
  if (cls === 'oom') return { key: 'task_failed_oom', arg };
  return { key: 'task_failed_unknown', arg };
}

/** Render a failureText against a localized template. Understands both web
 *  `{0}` and Android `%1$s` placeholders (so both fronts run the same
 *  fixtures); an empty argument drops the « — …» suffix. */
export function formatFailureText(template: string, arg: string | null): string {
  if (arg == null) return template.replace(/\s*—\s*(?:\{0\}|%1\$s)\s*$/, '');
  return template.replace(/\{0\}/g, arg).replace(/%1\$s/g, arg);
}

/** i18n keys of the retry-pause line. */
export type RetryLineKey = 'task_retrying' | 'task_retrying_now';

/** The retry-pause line as an i18n key + arguments (empty for
 *  `task_retrying_now`). */
export interface RetryLine {
  key: RetryLineKey;
  args: (string | number)[];
}

/** «Повтор %1$d/%2$d через %3$s» while the pause runs; after `retry_at`
 *  passes → «Повтор…» until the next progress-panel poll. null when the row
 *  is not waiting out a pause. Driven by the CLIENT clock (`now`). */
export function retryLine(
  retrying: boolean,
  retryNo: number | null | undefined,
  retryMax: number | null | undefined,
  retryAt: number | null | undefined,
  now: number
): RetryLine | null {
  if (!retrying) return null;
  if (retryAt == null || !Number.isFinite(retryAt) || now >= retryAt) {
    return { key: 'task_retrying_now', args: [] };
  }
  return { key: 'task_retrying', args: [retryNo ?? 0, retryMax ?? 0, formatRetryCountdown(retryAt - now)] };
}

/** mm:ss countdown for the retry pause, never below 00:00. */
export function formatRetryCountdown(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Chapter/scene subset the failed-scene caption reads (structural mirror of
 *  the loaded book JSON). */
export interface CaptionScene {
  scene_id?: string | null;
  display_index?: number | null;
  scene_title?: string | null;
  type?: string | null;
}

/** @see CaptionScene */
export interface CaptionChapter {
  chapter_id?: string | null;
  scenes?: readonly CaptionScene[] | null;
}

/** Caption of the scene a command failed on: the scene label computed from
 *  the ALREADY LOADED book the way the backend computes `scene_label`
 *  (`Scene 3 — Title` / `Cover`); `chapter_id/scene_id` when the scene is
 *  not in the book; null when there is no failed_scene. */
export function failedSceneCaption(
  chapters: readonly CaptionChapter[] | null | undefined,
  failedScene: FailedSceneRef | null | undefined
): string | null {
  if (!failedScene) return null;
  const chapterId = failedScene.chapter_id ?? null;
  const sceneId = failedScene.scene_id ?? null;
  const fallback = chapterId && sceneId ? `${chapterId}/${sceneId}` : null;
  if (!chapterId || !sceneId) return fallback;
  const ch = (chapters ?? []).find((c) => (c?.chapter_id ?? null) === chapterId);
  const sc = (ch?.scenes ?? []).find((s) => (s?.scene_id ?? null) === sceneId);
  if (!sc) return fallback;
  const idx = sc.display_index ?? 0;
  const title = sc.scene_title?.trim() || null;
  if (idx > 0) return title ? `Scene ${idx} — ${title}` : `Scene ${idx}`;
  if (title) return title;
  if (sc.type === 'cover') return 'Cover';
  return fallback;
}
