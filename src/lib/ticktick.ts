/**
 * TickTick "private" API client.
 *
 * This talks to the same backend that the official mobile/web clients use,
 * NOT the public Open API. It is unsupported, can change without notice,
 * and requires storing the user's email + password (encrypted at rest via
 * src/lib/crypto.ts).
 *
 * High-level flow:
 *   1. POST /api/v2/user/signon → returns { token } and a `t` cookie.
 *   2. Store the cookie in `ticktick_credentials.cookie_t`.
 *   3. All subsequent calls send the cookie. On 401/expired, transparently
 *      re-sign-on using the stored (decrypted) credentials.
 *   4. GET /api/v2/batch/check/0 returns the entire account state in one
 *      payload (projects, tasks, tags, columns, filters, inbox, etc.).
 *   5. POST /api/v2/batch/task with { add, update, delete } applies CRUD.
 *
 * Region: `global` (api.ticktick.com) or `china` (api.dida365.com).
 */

import { randomBytes } from "node:crypto";
import { createServerSupabase } from "./supabase-server";
import { decryptString, encryptString, type Encrypted } from "./crypto";

/* ── Endpoints / config ─────────────────────────────────── */

export type Region = "global" | "china";

function apiBase(region: Region): string {
  return region === "china" ? "https://api.dida365.com" : "https://api.ticktick.com";
}
function siteBase(region: Region): string {
  return region === "china" ? "https://dida365.com" : "https://ticktick.com";
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * TickTick's web client sends an `x-device` JSON blob on every API call.
 * The shape and field set here matches what current ticktick.com sends.
 * `id` should be a 24-hex char string (Mongo ObjectId style).
 */
function deviceHeader(deviceId: string) {
  return JSON.stringify({
    platform: "web",
    os: "OS X",
    device: "Chrome 124.0.0.0",
    name: "",
    version: 6133,
    id: deviceId,
    channel: "website",
    campaign: "",
    websocket: "",
  });
}

/** Browser-like headers Cloudflare/TickTick sometimes check on login. */
const BROWSER_HEADERS: Record<string, string> = {
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

/* ── Types (subset; the real payload has more) ──────────── */

export type Priority = 0 | 1 | 3 | 5;
export type TaskStatus = 0 | 2;

export interface TickTickTask {
  id:           string;
  projectId:    string;
  title:        string;
  content?:     string;
  desc?:        string;
  status?:      TaskStatus;
  priority?:    Priority;
  startDate?:   string | null;
  dueDate?:     string | null;
  completedTime?: string | null;
  isAllDay?:    boolean;
  timeZone?:    string;
  reminders?:   string[];
  repeatFlag?:  string | null;
  tags?:        string[];
  items?:       Array<{
    id?:        string;
    title:      string;
    status?:    TaskStatus;
    completedTime?: string | null;
    isAllDay?:  boolean;
    sortOrder?: number;
    startDate?: string | null;
    timeZone?:  string;
  }>;
  kind?:        "TEXT" | "CHECKLIST" | "NOTE";
  sortOrder?:   number;
  createdTime?: string;
  modifiedTime?: string;
}

export interface TickTickProject {
  id:        string;
  name:      string;
  color?:    string | null;
  inAll?:    boolean;
  closed?:   boolean | null;
  groupId?:  string | null;
  viewMode?: string;
  kind?:     "TASK" | "NOTE";
  sortOrder?: number;
  permission?: string;
}

export interface TickTickTag {
  name:     string;
  label?:   string;
  color?:   string | null;
  parent?:  string | null;
  sortOrder?: number;
  sortType?: string;
}

export interface BatchCheck {
  inboxId:           string;
  projectProfiles:   TickTickProject[];
  syncTaskBean:      { update?: TickTickTask[]; delete?: string[] };
  syncTagBean:       { update?: TickTickTag[]; delete?: string[] };
  projectGroups?:    Array<{ id: string; name: string; sortOrder?: number; userId?: string }>;
  filters?:          Array<{ id: string; name: string; rule?: string; sortOrder?: number }>;
  syncOrderBean?:    unknown;
  remindChanges?:    unknown;
  checkPoint?:       number;
}

/* ── DB row ─────────────────────────────────────────────── */

interface CredsRow {
  user_id: string;
  email: string;
  password_ciphertext: string;
  password_iv: string;
  password_tag: string;
  region: Region;
  cookie_t: string | null;
  cookie_expires_at: string | null;
  device_id: string;
  inbox_id: string | null;
  ticktick_user_id: string | null;
  last_signed_in_at: string | null;
}

async function loadCreds(userId: string): Promise<CredsRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("ticktick_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as CredsRow | null) ?? null;
}

async function saveCreds(row: Partial<CredsRow> & { user_id: string }) {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("ticktick_credentials")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

async function deleteCreds(userId: string) {
  const supabase = await createServerSupabase();
  await supabase.from("ticktick_credentials").delete().eq("user_id", userId);
}

/* ── Errors ─────────────────────────────────────────────── */

export class TickTickError extends Error {
  status: number;
  code?: number;
  body: string;
  constructor(status: number, body: string, code?: number) {
    super(`TickTick ${status}${code ? ` (code ${code})` : ""}: ${body}`);
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export class TickTickAuthError extends TickTickError {}
export class TickTickCaptchaError extends TickTickError {
  constructor(body: string) {
    super(403, body, 2001);
    this.message = "TickTick requires a captcha. Sign in at ticktick.com once, then retry.";
  }
}

/* ── Sign-on ────────────────────────────────────────────── */

interface SignOnResponse {
  token: string;
  userId: string;
  inboxId?: string;
  username?: string;
  userCode?: string;
}

async function signOn(opts: {
  email: string;
  password: string;
  region: Region;
  deviceId: string;
}): Promise<SignOnResponse> {
  const url = `${apiBase(opts.region)}/api/v2/user/signon?wc=true&remember=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        Origin: siteBase(opts.region),
        Referer: `${siteBase(opts.region)}/`,
        "x-device": deviceHeader(opts.deviceId),
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify({ username: opts.email, password: opts.password }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[ticktick/signon] network error", { url, err });
    throw new TickTickError(0, err instanceof Error ? err.message : "network_error");
  }

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  const code: number | undefined =
    typeof parsed?.errorCode === "number" ? (parsed!.errorCode as number)
    : typeof parsed?.code === "number" ? (parsed!.code as number)
    : undefined;
  const token = typeof parsed?.token === "string" ? (parsed!.token as string) : "";

  // TickTick sometimes returns HTTP 200 with an error JSON. Treat any
  // response that lacks a token as a failure.
  const failed = !res.ok || !token;

  if (failed) {
    console.error("[ticktick/signon] failed", {
      url,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get("content-type"),
      code,
      bodyPreview: text.slice(0, 800),
      hadParsedJson: !!parsed,
    });

    if (code === 2001) throw new TickTickCaptchaError(text);

    // 1009 = wrong username/password, 1010 = account locked. Treat as auth.
    if (res.status === 400 || res.status === 401 || code === 1009 || code === 1010) {
      throw new TickTickAuthError(res.status || 401, text || "invalid_credentials", code);
    }
    throw new TickTickError(res.status, text, code);
  }

  return parsed as unknown as SignOnResponse;
}

/* ── Public: connect / disconnect ───────────────────────── */

/**
 * Persist credentials and complete an initial sign-on. Throws
 * TickTickAuthError / TickTickCaptchaError on user-fixable failures so the
 * route handler can surface a friendly message.
 */
export async function connect(userId: string, opts: {
  email: string;
  password: string;
  region?: Region;
}) {
  const region: Region = opts.region ?? "global";
  // TickTick expects a 24-hex device id (Mongo-ObjectId style).
  const deviceId = newObjectId();

  const session = await signOn({ ...opts, region, deviceId });

  const enc: Encrypted = encryptString(opts.password);
  await saveCreds({
    user_id: userId,
    email: opts.email,
    password_ciphertext: enc.ciphertext,
    password_iv: enc.iv,
    password_tag: enc.tag,
    region,
    cookie_t: session.token,
    cookie_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(), // best-effort: 30d
    device_id: deviceId,
    inbox_id: session.inboxId ?? null,
    ticktick_user_id: session.userId,
    last_signed_in_at: new Date().toISOString(),
  });
}

export async function disconnect(userId: string) {
  await deleteCreds(userId);
}

export async function status(userId: string): Promise<{
  connected: boolean;
  configured: boolean;
  email?: string;
  lastSignedInAt?: string | null;
}> {
  const configured = !!process.env.TICKTICK_ENC_KEY;
  const row = await loadCreds(userId);
  return {
    connected: !!row,
    configured,
    email: row?.email,
    lastSignedInAt: row?.last_signed_in_at ?? null,
  };
}

/* ── Authenticated request ──────────────────────────────── */

interface FetchInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
}

async function rawRequest<T>(
  row: CredsRow,
  cookieT: string,
  path: string,
  init: FetchInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string; code?: number }> {
  const url = new URL(`${apiBase(row.region)}${path.startsWith("/") ? path : `/${path}`}`);
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": DEFAULT_USER_AGENT,
    Origin: siteBase(row.region),
    Referer: `${siteBase(row.region)}/`,
    Cookie: `t=${cookieT}`,
    "x-device": deviceHeader(row.device_id),
    "x-tz": DEFAULT_TIMEZONE,
    ...BROWSER_HEADERS,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) {
    let code: number | undefined;
    try { code = (JSON.parse(text) as { errorCode?: number; code?: number }).errorCode ?? (JSON.parse(text) as { code?: number }).code; } catch {}
    return { ok: false, status: res.status, body: text, code };
  }
  if (!text) return { ok: true, data: undefined as unknown as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: true, data: text as unknown as T };
  }
}

/**
 * Authenticated request with transparent re-sign-on on 401.
 */
async function tickTickRequest<T>(
  userId: string,
  path: string,
  init: FetchInit = {},
): Promise<T> {
  let row = await loadCreds(userId);
  if (!row) throw new TickTickAuthError(401, "not_connected");

  let cookie = row.cookie_t;
  // If we never have a cookie, sign on once first.
  if (!cookie) {
    const password = decryptString({
      ciphertext: row.password_ciphertext,
      iv: row.password_iv,
      tag: row.password_tag,
    });
    const session = await signOn({
      email: row.email,
      password,
      region: row.region,
      deviceId: row.device_id,
    });
    cookie = session.token;
    await saveCreds({
      user_id: userId,
      cookie_t: cookie,
      cookie_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      inbox_id: session.inboxId ?? row.inbox_id,
      ticktick_user_id: session.userId,
      last_signed_in_at: new Date().toISOString(),
    });
    row = { ...row, cookie_t: cookie };
  }

  let attempt = await rawRequest<T>(row, cookie, path, init);
  if (attempt.ok) return attempt.data;

  // On any auth-ish failure, try re-signing in once and retry.
  if (attempt.status === 401 || attempt.status === 403 || attempt.code === 4001 || attempt.code === 401) {
    const password = decryptString({
      ciphertext: row.password_ciphertext,
      iv: row.password_iv,
      tag: row.password_tag,
    });
    let session: SignOnResponse;
    try {
      session = await signOn({
        email: row.email,
        password,
        region: row.region,
        deviceId: row.device_id,
      });
    } catch (err) {
      if (err instanceof TickTickAuthError) throw err;
      throw err;
    }
    cookie = session.token;
    await saveCreds({
      user_id: userId,
      cookie_t: cookie,
      cookie_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      inbox_id: session.inboxId ?? row.inbox_id,
      ticktick_user_id: session.userId,
      last_signed_in_at: new Date().toISOString(),
    });
    attempt = await rawRequest<T>({ ...row, cookie_t: cookie }, cookie, path, init);
    if (attempt.ok) return attempt.data;
  }

  throw new TickTickError(attempt.status, attempt.body, attempt.code);
}

/* ── Batch check (full state) ───────────────────────────── */

export async function getBatchCheck(userId: string): Promise<BatchCheck> {
  const data = await tickTickRequest<BatchCheck>(userId, "/api/v2/batch/check/0");
  // Cache the inboxId for callers that need it.
  if (data.inboxId) {
    await saveCreds({ user_id: userId, inbox_id: data.inboxId }).catch(() => {});
  }
  return data;
}

/* ── Task CRUD via /batch/task ──────────────────────────── */

/**
 * Generates a 24-hex-char ID compatible with TickTick's MongoDB ObjectId
 * convention: 4-byte timestamp + 8-byte random.
 */
export function newObjectId(): string {
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0")
    .slice(-8);
  const rand = randomBytes(8).toString("hex");
  return ts + rand;
}

interface BatchTaskBody {
  add?: Partial<TickTickTask>[];
  update?: Partial<TickTickTask>[];
  delete?: Array<{ projectId: string; taskId: string }>;
  addAttachments?: unknown[];
  updateAttachments?: unknown[];
}

async function batchTask(userId: string, body: BatchTaskBody) {
  return tickTickRequest<{ id2error?: Record<string, string>; id2etag?: Record<string, string> }>(
    userId,
    "/api/v2/batch/task",
    { method: "POST", body },
  );
}

export async function createTask(userId: string, input: Partial<TickTickTask> & { title: string; projectId: string }): Promise<TickTickTask> {
  const id = input.id ?? newObjectId();
  const task: Partial<TickTickTask> = {
    kind: "TEXT",
    isAllDay: false,
    timeZone: DEFAULT_TIMEZONE,
    priority: 0,
    status: 0,
    sortOrder: 0,
    items: [],
    reminders: [],
    tags: [],
    ...input,
    id,
  };
  await batchTask(userId, { add: [task] });
  return task as TickTickTask;
}

export async function updateTask(userId: string, input: Partial<TickTickTask> & { id: string; projectId: string }): Promise<TickTickTask> {
  await batchTask(userId, { update: [input] });
  return input as TickTickTask;
}

export async function completeTask(userId: string, projectId: string, taskId: string, existing?: Partial<TickTickTask>) {
  const update: Partial<TickTickTask> = {
    ...existing,
    id: taskId,
    projectId,
    status: 2,
    completedTime: new Date().toISOString(),
  };
  await batchTask(userId, { update: [update] });
}

export async function deleteTask(userId: string, projectId: string, taskId: string) {
  await batchTask(userId, { delete: [{ projectId, taskId }] });
}

/* ── Completed history (per-project or all) ─────────────── */

export interface ClosedTaskQuery {
  from?: string;   // ISO datetime
  to?: string;
  limit?: number;  // default 50
  status?: "Completed" | "Abandoned";
}

export async function listCompletedTasks(userId: string, q: ClosedTaskQuery = {}): Promise<TickTickTask[]> {
  return tickTickRequest<TickTickTask[]>(userId, "/api/v2/project/all/closed", {
    searchParams: {
      from: q.from,
      to: q.to,
      limit: q.limit ?? 50,
      status: q.status ?? "Completed",
    },
  });
}

/* ── Habits ─────────────────────────────────────────────── */

export interface TickTickHabit {
  id: string;
  name: string;
  iconRes?: string;
  color?: string;
  sortOrder?: number;
  status?: number;       // 0 = active, 1 = archived
  encouragement?: string;
  totalCheckIns?: number;
  type?: "Boolean" | "Real";
  goal?: number;
  step?: number;
  unit?: string;
  repeatRule?: string;
  reminders?: string[];
  recordEnable?: boolean;
  sectionId?: string;
  targetDays?: number;
  completedCycles?: number;
  exDates?: string[];
  style?: string;
}

export interface TickTickHabitCheckin {
  habitId: string;
  checkinStamp: number; // YYYYMMDD
  checkinTime?: string;
  goal?: number;
  status?: 0 | 1 | 2;   // 0 not done, 1 incomplete, 2 done
  value?: number;
  id?: string;
  opTime?: string;
}

export async function listHabits(userId: string): Promise<TickTickHabit[]> {
  return tickTickRequest<TickTickHabit[]>(userId, "/api/v2/habits");
}

export async function listHabitCheckins(userId: string, habitIds: string[], afterStamp?: number): Promise<{
  checkins: Record<string, TickTickHabitCheckin[]>;
}> {
  if (habitIds.length === 0) return { checkins: {} };
  const stamp = afterStamp ?? Number(
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ""),
  );
  return tickTickRequest(userId, "/api/v2/habitCheckins/query", {
    method: "POST",
    body: { habitIds, afterStamp: stamp },
  });
}
