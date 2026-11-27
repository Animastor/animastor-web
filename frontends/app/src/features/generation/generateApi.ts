// ═══════════════════════════════════════════════════════════════
//  Generate API v2 (ADR ORCHESTRATION_V2 §11.1–11.2) — wire types + pure helpers
// ═══════════════════════════════════════════════════════════════
//  POST /book/{id}/generate          {scope, layers, mode, client_action_id} → {command_id, existing, summary}
//  POST /book/{id}/generate/stop     {command_id} | {layer} | {}
//  GET  /book/{id}/generate/progress ADR §9 aggregate (commands × layers × scenes)
//  GET  /book/{id}/generate/stream   SSE: {type:'gen_progress', reason:'connect'|'notify', progress}
//  The response field build_id is not read any more (there is none).
//
//  The Generator rows are still drawn by @animastor/web-generator
//  computeProgressRows (npm package, unchanged); aggregateToPanel() turns the
//  NEW wire format into its input. Mirrors Android GenerateApiV2.kt.
// ═══════════════════════════════════════════════════════════════

import type { ProgressPanelResponse, ProgressTask } from '../../api/models';

export type GenerateMode = 'missing' | 'all';
export type GenLayer = 'audio' | 'image' | 'video';

export type GenScope =
  | { level: 'book' }
  | { level: 'chapter'; chapter_id: string }
  | { level: 'scene'; chapter_id: string; scene_id: string }
  | { level: 'from_current_scene'; chapter_id: string; scene_id: string }
  | { level: 'scenes'; scene_ids: string[] };

export interface GenerateRequestBody {
  scope: GenScope;
  layers: GenLayer[];
  mode: GenerateMode;
  client_action_id: string;
}

export interface GenerateSummary {
  jobs_created: number;
  joined: number;
  skipped_ready: number;
  skipped_unsupported?: string[];
}

export interface GenerateResponse {
  book_id: string;
  command_id: string;
  existing: boolean;
  status?: string;
  mode?: GenerateMode;
  layers?: string[];
  summary: GenerateSummary;
  skipped_layers?: string[];
}

export interface GenCounters {
  queued: number; running: number; done: number; failed: number; cancelled: number;
  retrying: number; joined_queued: number; joined_running: number;
}
export interface GenLayerProgress extends GenCounters { ready: number; total: number; percent: number; scenes: number }
export interface GenSceneProgress extends GenCounters { chapter_id: string; scene_id: string; layer: string }

export interface GenCommand {
  command_id: string;
  kind: string;
  status: 'active' | 'done' | 'partial' | 'failed' | 'cancelled' | string;
  mode: GenerateMode;
  scope: { level: string; chapter_id?: string; scene_id?: string; scene_ids?: string[]; unit_id?: string };
  layers: string[];
  created_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  summary?: GenerateSummary | null;
  skipped?: Record<string, string[]>;
  labels?: { chapter_label?: string | null; scene_label?: string | null; scene_count?: number | null };
  totals: GenCounters;
  by_layer: Record<string, GenLayerProgress>;
  scenes: GenSceneProgress[];
}

export interface GenProgress {
  book_id: string;
  orchestration?: string;
  generated_at?: string;
  active: boolean;
  totals: GenCounters;
  commands: GenCommand[];
  disabled?: boolean;
}

export interface GenStreamEvent {
  type: 'gen_progress';
  reason: 'connect' | 'notify';
  command_ids: string[];
  progress: GenProgress;
}

/** The scope dialog id (current_scene / current_chapter / from_current_scene /
 *  whole_book) + the position → the /generate scope. null: the position is missing. */
export function toGenerateScope(scope: string, chapterId: string | null, sceneId: string | null): GenScope | null {
  switch (scope) {
    case 'whole_book': return { level: 'book' };
    case 'current_chapter': return chapterId ? { level: 'chapter', chapter_id: chapterId } : null;
    case 'current_scene': return chapterId && sceneId ? { level: 'scene', chapter_id: chapterId, scene_id: sceneId } : null;
    case 'from_current_scene': return chapterId && sceneId ? { level: 'from_current_scene', chapter_id: chapterId, scene_id: sceneId } : null;
    default: return null;
  }
}

/** «Перегенерировать» (mode all) asks for confirmation when the scope is wider than one scene (ADR §11.2). */
export function regenerateNeedsConfirm(scope: string): boolean {
  return scope !== 'current_scene';
}

/** One click = one id (ADR §6.2: the server dedups a repeated click by it). */
export function newClientActionId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  (c ?? { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The body of POST /generate/stop for a row ■ (taskId = command_id), a section ■ (layer)
 *  or «Stop all» (book). null: not an orchestration layer (vbook / cover) — the
 *  caller keeps the VBook stop (cancel-worker type=vbook, задача H). */
export function stopBody(type: string | null, commandId?: string | null): { command_id: string } | { layer: GenLayer } | Record<string, never> | null {
  if (commandId) return { command_id: commandId };
  if (type === 'audio' || type === 'image' || type === 'video') return { layer: type };
  if (type == null || type === 'book') return {};
  return null;
}

const LEGACY_SCOPE: Record<string, string> = {
  book: 'whole_book', chapter: 'current_chapter', scene: 'current_scene', unit: 'current_scene', scenes: 'from_current_scene',
};

function taskOf(c: GenCommand, layer: string): ProgressTask {
  const t: Partial<GenLayerProgress> = c.by_layer[layer] ?? {};
  const scenes = c.scenes.filter((s) => s.layer === layer);
  const scope = c.scope ?? { level: 'book' };
  const firstScene = scope.level === 'scenes' ? (scope.scene_ids?.[0] ?? null) : (scope.scene_id ?? null);
  const chapterId = scope.chapter_id ?? (firstScene ? (c.scenes.find((s) => s.scene_id === firstScene)?.chapter_id ?? null) : null);
  const done = c.status === 'done';
  const cancelled = c.status === 'cancelled';
  const failed = c.status === 'failed' || c.status === 'partial';
  const total = t.total ?? 0;
  const ready = done ? total : (t.ready ?? 0);
  const percent = done ? 100 : (t.percent ?? 0);
  const startedAt = c.created_at ? Date.parse(c.created_at) : NaN;
  return {
    task_id: c.command_id,
    type: layer,
    scope: LEGACY_SCOPE[scope.level] ?? 'whole_book',
    chapter_id: chapterId,
    scene_id: firstScene,
    scene_label: c.labels?.scene_label ?? null,
    chapter_label: c.labels?.chapter_label ?? null,
    end_scene_label: null,
    end_chapter_label: null,
    target_count: scenes.length,
    started_at: Number.isFinite(startedAt) ? startedAt : null,
    ready,
    total,
    percent,
    done,
    visible: true,
    indeterminate: false,
    cancelled,
    status: done ? 'completed' : cancelled ? 'cancelled' : failed ? 'failed' : 'active',
    blocked: false,
    blocked_reason: null,
    interrupted: false,
    failed,
    failed_scene: null,
    error_class: failed ? 'gen_v2' : null,
    error_code: null,
    error_message: failed ? (c.error ?? null) : null,
    retrying: !failed && !done && !cancelled && (t.retrying ?? 0) > 0,
    retry_no: null,
    retry_max: null,
    retry_at: null,
  };
}

/** GET /generate/progress (or a stream event's `progress`) → the input of computeProgressRows:
 *  one row per command × layer, task_id = command_id. */
export function aggregateToPanel(agg: GenProgress | null | undefined): ProgressPanelResponse {
  const tasks: ProgressTask[] = [];
  for (const c of agg?.commands ?? []) {
    for (const layer of c.layers ?? []) tasks.push(taskOf(c, layer));
  }
  const anyIncomplete = tasks.some((r) => !r.done && !r.cancelled && !r.failed);
  const overall = tasks.length ? Math.round(tasks.reduce((s, r) => s + r.percent, 0) / tasks.length) : 0;
  return { book_id: agg?.book_id ?? null, tasks, overall_percent: overall, any_incomplete: anyIncomplete };
}

/** Pure: a /generate/stream `data:` payload → the event, or null (malformed / other). */
export function parseGenStreamEvent(data: string): GenStreamEvent | null {
  let ev: unknown;
  try { ev = JSON.parse(data); } catch { return null; }
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Partial<GenStreamEvent>;
  if (e.type !== 'gen_progress' || !e.progress || typeof e.progress !== 'object' || !Array.isArray(e.progress.commands)) return null;
  return {
    type: 'gen_progress',
    reason: e.reason === 'connect' ? 'connect' : 'notify',
    command_ids: Array.isArray(e.command_ids) ? e.command_ids.filter((x): x is string => typeof x === 'string') : [],
    progress: e.progress as GenProgress,
  };
}
