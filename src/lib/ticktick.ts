/**
 * TickTick Open API client + OAuth helpers.
 *
 * Docs: https://developer.ticktick.com/docs/index.html
 *
 * The Open API is intentionally narrow: it exposes projects and *uncompleted*
 * tasks only (no completed-task history, no habits, no inbox metadata). It
 * supports full CRUD on tasks though.
 *
 * Scopes used here: `tasks:read tasks:write`.
 *
 * Endpoints (relative to https://api.ticktick.com/open/v1):
 *   GET    /project                          → ProjectMeta[]   (excludes Inbox)
 *   GET    /project/{id}                     → ProjectMeta
 *   GET    /project/{id}/data                → { project, tasks, columns }
 *   POST   /task                             → create   (body must include projectId)
 *   POST   /task/{id}                        → update   (body must include id + projectId)
 *   POST   /project/{projectId}/task/{taskId}/complete → mark complete
 *   DELETE /project/{projectId}/task/{taskId}          → delete
 *
 * Note on the "Inbox": TickTick treats the Inbox as a virtual project with
 * id `inboxNNNNNN`. It is NOT returned by `GET /project`. To fetch its tasks,
 * call `GET /project/{userInboxProjectId}/data`. We do not currently know that
 * id without a successful call, so we expose Inbox via a marker constant and
 * the Home page lets users open it by typing/searching.
 */

import { createServerSupabase } from "./supabase-server";

export const TICKTICK_AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
export const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
export const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
export const TICKTICK_SCOPES = "tasks:read tasks:write";

/* ── Types ──────────────────────────────────────────────── */

export type TickTickPriority = 0 | 1 | 3 | 5; // none, low, medium, high
export type TickTickStatus = 0 | 2;            // 0=open, 2=completed

export interface TickTickProject {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number;
  closed?: boolean;
  groupId?: string;
  viewMode?: "list" | "kanban" | "timeline";
  kind?: "TASK" | "NOTE";
}

export interface TickTickChecklistItem {
  id?: string;
  title: string;
  status?: TickTickStatus;
  completedTime?: string;
  isAllDay?: boolean;
  sortOrder?: number;
  startDate?: string;
  timeZone?: string;
}

export interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;     // ISO 8601 (e.g. "2024-11-13T03:00:00+0000")
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  repeatFlag?: string;
  priority?: TickTickPriority;
  status?: TickTickStatus;
  completedTime?: string;
  sortOrder?: number;
  items?: TickTickChecklistItem[];
}

export interface TickTickProjectData {
  project: TickTickProject;
  tasks: TickTickTask[];
  columns?: Array<{ id: string; projectId: string; name: string; sortOrder?: number }>;
}

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  scope: string;
  expires_at: string; // ISO timestamp
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/* ── Env / config ───────────────────────────────────────── */

export function ticktickConfig() {
  const clientId = process.env.TICKTICK_CLIENT_ID;
  const clientSecret = process.env.TICKTICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "TickTick is not configured. Set TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET in .env.local. See TICKTICK_SETUP.md.",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Build the redirect URI that we send to TickTick. It MUST match exactly what
 * was registered at https://developer.ticktick.com/manage. We prefer an env
 * override (production) and otherwise derive it from the incoming request.
 */
export function ticktickRedirectUri(origin: string): string {
  return process.env.TICKTICK_REDIRECT_URI || `${origin}/api/ticktick/callback`;
}

/* ── OAuth ──────────────────────────────────────────────── */

export function buildAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  scope?: string;
}) {
  const { clientId } = ticktickConfig();
  const url = new URL(TICKTICK_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", opts.scope ?? TICKTICK_SCOPES);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

async function postTokenForm(body: URLSearchParams): Promise<TokenResponse> {
  const { clientId, clientSecret } = ticktickConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`TickTick token endpoint ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`TickTick token endpoint returned non-JSON: ${text}`);
  }
}

export async function exchangeCodeForToken(opts: {
  code: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    scope: TICKTICK_SCOPES,
  });
  return postTokenForm(body);
}

async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: TICKTICK_SCOPES,
  });
  return postTokenForm(body);
}

/* ── Token storage ──────────────────────────────────────── */

export async function saveTokens(userId: string, t: TokenResponse) {
  const supabase = await createServerSupabase();
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  const { error } = await supabase
    .from("ticktick_tokens")
    .upsert({
      user_id: userId,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      token_type: t.token_type || "Bearer",
      scope: t.scope || TICKTICK_SCOPES,
      expires_at: expiresAt,
    }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadTokens(userId: string): Promise<TokenRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("ticktick_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as TokenRow | null) ?? null;
}

export async function deleteTokens(userId: string) {
  const supabase = await createServerSupabase();
  await supabase.from("ticktick_tokens").delete().eq("user_id", userId);
}

/**
 * Returns a usable access token for the current user, refreshing it if it
 * has expired (or will expire within 60s — covered already by saveTokens).
 * Returns `null` if the user has not connected TickTick.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const row = await loadTokens(userId);
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt > Date.now()) return row.access_token;

  if (!row.refresh_token) return null;
  const fresh = await refreshAccessToken(row.refresh_token);
  // TickTick may return the same refresh token; preserve the old one if absent.
  if (!fresh.refresh_token) fresh.refresh_token = row.refresh_token;
  await saveTokens(userId, fresh);
  return fresh.access_token;
}

/* ── Authenticated fetch ────────────────────────────────── */

interface TickTickFetchInit extends Omit<RequestInit, "body"> {
  body?: unknown; // serialized as JSON
  searchParams?: Record<string, string | number | boolean | undefined>;
}

export class TickTickError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `TickTick API ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export async function tickTickFetch<T = unknown>(
  userId: string,
  path: string,
  init: TickTickFetchInit = {},
): Promise<T> {
  const token = await getValidAccessToken(userId);
  if (!token) throw new TickTickError(401, "not_connected", "TickTick not connected");

  const url = new URL(`${TICKTICK_API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    redirect: "follow",
  });

  const text = await res.text();
  if (!res.ok) throw new TickTickError(res.status, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/* ── Convenience wrappers ──────────────────────────────── */

export function listProjects(userId: string) {
  return tickTickFetch<TickTickProject[]>(userId, "/project");
}

export function getProjectData(userId: string, projectId: string) {
  return tickTickFetch<TickTickProjectData>(userId, `/project/${projectId}/data`);
}

export function createTask(userId: string, task: Partial<TickTickTask> & { title: string; projectId: string }) {
  return tickTickFetch<TickTickTask>(userId, "/task", { method: "POST", body: task });
}

export function updateTask(userId: string, task: Partial<TickTickTask> & { id: string; projectId: string }) {
  return tickTickFetch<TickTickTask>(userId, `/task/${task.id}`, { method: "POST", body: task });
}

export async function completeTask(userId: string, projectId: string, taskId: string) {
  await tickTickFetch<void>(userId, `/project/${projectId}/task/${taskId}/complete`, { method: "POST" });
}

export async function deleteTask(userId: string, projectId: string, taskId: string) {
  await tickTickFetch<void>(userId, `/project/${projectId}/task/${taskId}`, { method: "DELETE" });
}
