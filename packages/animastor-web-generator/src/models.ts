// Player-local vendored wire types for the generation-progress domain
// (the web-player models.ts precedent — docs/architecture/web-generator-extraction-audit.md §10).
//
// These are structural (NOT nominal) — they mirror the subset of api/models
// types that the generation-progress domain reads. The host passes the real
// wire payloads through the ProgressEventSink / ProgressRowContext contracts;
// TypeScript enforces structural compatibility without the package importing
// the host's api/models module. Any drift from the api/models shapes is
// rejected at the host adapter bridge.

/** GET /book/{id}/progress-panel — ProgressPanelResponse (api/models.ts:540). */
export interface ProgressPanelResponse {
  book_id?: string | null;
  tasks: ProgressTask[];
  overall_percent: number;
  any_incomplete: boolean;
}

/** ProgressTask row within ProgressPanelResponse (api/models.ts:547). */
export interface ProgressTask {
  task_id?: string | null;
  type: string;
  scope: string;
  chapter_id?: string | null;
  scene_id?: string | null;
  scene_label?: string | null;
  chapter_label?: string | null;
  end_scene_label?: string | null;
  end_chapter_label?: string | null;
  target_count: number;
  started_at?: number | null;
  ready: number;
  total: number;
  percent: number;
  done: boolean;
  visible: boolean;
  indeterminate: boolean;
  cancelled: boolean;
  /** Stage 155 (command-only generation): registry task status —
   *  'active' | 'completed' | 'cancelled' | 'blocked' | 'interrupted'.
   *  Absent on older backends. */
  status?: string | null;
  /** No live worker of the type — the command is blocked (no auto-retry). */
  blocked?: boolean;
  /** 'no_worker:<type>' when blocked, else null. */
  blocked_reason?: string | null;
  /** Interrupted by a backend restart — resumed only by a new command. */
  interrupted?: boolean;
  /** Terminally failed command (GPU retry policy 2026-11-02) — visible, not
   *  running, restarted only by a new explicit command. */
  failed?: boolean;
  /** The scene the command failed on ({chapter_id, scene_id}) or null. */
  failed_scene?: { chapter_id?: string | null; scene_id?: string | null } | null;
  /** Class of the terminal error (`failed`) / of the last error while a
   *  retry pause runs (`active`); absent on older backends. */
  error_class?: string | null;
  /** Refinement of error_class (comfy_rejected, cuda_oom, …) or null. */
  error_code?: string | null;
  /** Short, stack-free error text (≤200 chars) or null. */
  error_message?: string | null;
  /** true while an `active` row waits out a server-side retry pause. */
  retrying?: boolean;
  /** Retry number / maximum (transient — 2, oom — 1) while retrying. */
  retry_no?: number | null;
  retry_max?: number | null;
  /** When the server retries (ms epoch) while retrying, else null. */
  retry_at?: number | null;
}

/** SSE /book/{id}/progress-stream — ProgressEvent (api/models.ts:701).
 *  Mirrors the ProgressStream.kt JSON shape. snake_case fields are
 *  preserved as the server emits them; the handler reads the few it needs. */
export interface ProgressEvent {
  type?: string;
  layer?: string;
  chapterId?: string | null;
  sceneId?: string | null;
  ready?: number | null;
  // VBook fields (type == "vbook")
  stage?: string | null;
  scene_index?: number | null;
  total_scenes?: number | null;
  window_size?: number | null;
  window_scene_index?: number | null;
  window_total_scenes?: number | null;
  window_start_scene?: number | null;
  message?: string | null;
  // Parallel analysis fields (type == "analysis")
  task?: string | null;
  status?: string | null;
  completed_tasks?: number | null;
  failed_tasks?: number | null;
  total_tasks?: number | null;
  duration_ms?: number | null;
  error?: string | null;
  // analysis_parallel heartbeat (type == "vbook", stage == "analysis_parallel")
  analysis_completed?: number | null;
  analysis_failed?: number | null;
  analysis_total?: number | null;
  analysis_mode?: string | null;
}
