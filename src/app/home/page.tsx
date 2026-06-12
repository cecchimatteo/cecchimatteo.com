"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Circle, Trash2, Edit2, Plus, RefreshCw, Calendar,
  Flag, ListTodo, Inbox, ChevronRight, Search, X, AlertCircle,
  Eye, EyeOff, Lock, Mail, ShieldCheck,
} from "lucide-react";
import {
  PageHeader, Modal, TextField, TextArea, PrimaryButton, GhostButton, EmptyState, Pill,
} from "@/components/ui";

/* ── Types (mirror server lib) ─────────────────────────── */

type Priority = 0 | 1 | 3 | 5;

interface TickTickProject {
  id:        string;
  name:      string;
  color?:    string | null;
  closed?:   boolean | null;
  groupId?:  string | null;
  kind?:     "TASK" | "NOTE";
  sortOrder?: number;
}

interface TickTickChecklistItem {
  id?:        string;
  title:      string;
  status?:    0 | 2;
  startDate?: string;
}

interface TickTickTask {
  id:         string;
  projectId:  string;
  title:      string;
  content?:   string;
  desc?:      string;
  isAllDay?:  boolean;
  startDate?: string;
  dueDate?:   string;
  timeZone?:  string;
  priority?:  Priority;
  status?:    0 | 2;
  items?:     TickTickChecklistItem[];
}

type ConnState =
  | { kind: "loading" }
  | { kind: "unconfigured" }
  | { kind: "disconnected" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

/* ── Helpers ────────────────────────────────────────────── */

const PRIORITY_LABEL: Record<Priority, string> = { 0: "None", 1: "Low", 3: "Medium", 5: "High" };
const PRIORITY_COLOR: Record<Priority, string> = {
  0: "var(--c-mute)",
  1: "#3B82F6",
  3: "#F59E0B",
  5: "#DC2626",
};

function pad(n: number) { return String(n).padStart(2, "0"); }

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  // TickTick accepts standard ISO 8601 with offset; using the local offset
  // here keeps "today at 5pm" meaning the same thing across timezones.
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const h = pad(Math.floor(Math.abs(off) / 60));
  const m = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${h}${m}`;
}

function formatDue(iso?: string): { label: string; tone: "overdue" | "today" | "soon" | "future" | "none" } {
  if (!iso) return { label: "", tone: "none" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: "", tone: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let label: string;
  if (diffDays === 0) label = `Today · ${time}`;
  else if (diffDays === 1) label = `Tomorrow · ${time}`;
  else if (diffDays === -1) label = `Yesterday · ${time}`;
  else if (diffDays > 0 && diffDays < 7) label = d.toLocaleDateString("en-US", { weekday: "short" }) + ` · ${time}`;
  else label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (diffDays >= 0 ? ` · ${time}` : "");
  const tone = diffDays < 0 ? "overdue" : diffDays === 0 ? "today" : diffDays <= 3 ? "soon" : "future";
  return { label, tone };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = (data as { error?: string })?.error ?? `request_failed_${res.status}`;
    throw new Error(err);
  }
  return data as T;
}

/* ── Page ──────────────────────────────────────────────── */

export default function HomePage() {
  const [conn,       setConn]       = useState<ConnState>({ kind: "loading" });
  const [projects,   setProjects]   = useState<TickTickProject[]>([]);
  const [tasks,      setTasks]      = useState<TickTickTask[]>([]);
  const [inboxId,    setInboxId]    = useState<string>("");
  const [selected,   setSelected]   = useState<string>("all"); // "all" | projectId | inboxId
  const [query,      setQuery]      = useState("");
  const [showDone,   setShowDone]   = useState(false);
  const [doneLoaded, setDoneLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editTask,   setEditTask]   = useState<TickTickTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [banner,     setBanner]     = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const s = await api<{ connected: boolean; configured: boolean }>("/api/ticktick/status");
      if (!s.configured) setConn({ kind: "unconfigured" });
      else if (!s.connected) setConn({ kind: "disconnected" });
      else setConn({ kind: "connected" });
      return s;
    } catch (err) {
      setConn({ kind: "error", message: err instanceof Error ? err.message : "status_failed" });
      return null;
    }
  }, []);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api<{
        inboxId: string;
        projects: TickTickProject[];
        tasks: TickTickTask[];
      }>("/api/ticktick/all-tasks");
      setInboxId(data.inboxId ?? "");
      setProjects(data.projects ?? []);
      setTasks((prev) => {
        // Preserve any completed-history we lazy-loaded via /completed.
        const open = data.tasks ?? [];
        const completed = prev.filter((t) => t.status === 2);
        const openIds = new Set(open.map((t) => t.id));
        const merged = [...open, ...completed.filter((t) => !openIds.has(t.id))];
        return merged;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "load_failed";
      if (msg === "ticktick_auth" || msg === "unauthorized") setConn({ kind: "disconnected" });
      else setBanner(msg);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadCompleted = useCallback(async () => {
    try {
      const list = await api<TickTickTask[]>("/api/ticktick/completed?limit=100");
      setTasks((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        const fresh = (list ?? []).filter((t) => !ids.has(t.id));
        return [...prev, ...fresh];
      });
      setDoneLoaded(true);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "completed_load_failed");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await checkStatus();
      if (s?.connected) await loadAll();
    })();
  }, [checkStatus, loadAll]);

  function toggleShowDone(next: boolean) {
    setShowDone(next);
    if (next && !doneLoaded && conn.kind === "connected") {
      void loadCompleted();
    }
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let all = 0;
    for (const t of tasks) {
      if (t.status === 2) continue;
      all++;
      map.set(t.projectId, (map.get(t.projectId) ?? 0) + 1);
    }
    return { all, byProject: map };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (!showDone) list = list.filter((t) => t.status !== 2);
    if (selected !== "all") list = list.filter((t) => t.projectId === selected);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.title, t.content, t.desc].filter(Boolean).join(" ").toLowerCase().includes(q),
      );
    }
    // Order: overdue/today first, then by due date asc, then by priority desc.
    return [...list].sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (da !== db) return da - db;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  }, [tasks, selected, query, showDone]);

  // The unofficial API exposes an inboxId but doesn't include the Inbox in
  // /project. We synthesize an Inbox entry so the UI can filter / label it.
  const allProjects = useMemo<TickTickProject[]>(() => {
    if (!inboxId) return projects;
    const inbox: TickTickProject = {
      id: inboxId,
      name: "Inbox",
      color: "#3358F4",
      sortOrder: -1,
    };
    return [inbox, ...projects.filter((p) => p.id !== inboxId)];
  }, [projects, inboxId]);

  const projectsById = useMemo(() => {
    const map = new Map<string, TickTickProject>();
    for (const p of allProjects) map.set(p.id, p);
    return map;
  }, [allProjects]);

  /* ── Mutations (optimistic) ── */

  async function completeTask(t: TickTickTask) {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: 2 } : x)));
    try {
      await api(`/api/ticktick/tasks/${t.id}/complete?projectId=${encodeURIComponent(t.projectId)}`, {
        method: "POST",
      });
    } catch (err) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: 0 } : x)));
      setBanner(err instanceof Error ? err.message : "complete_failed");
    }
  }

  async function deleteTask(t: TickTickTask) {
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await api(`/api/ticktick/tasks/${t.id}?projectId=${encodeURIComponent(t.projectId)}`, {
        method: "DELETE",
      });
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "delete_failed");
      await loadAll();
    }
  }

  async function saveTask(updated: TickTickTask) {
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    try {
      const saved = await api<TickTickTask>(`/api/ticktick/tasks/${updated.id}`, {
        method: "POST",
        body: JSON.stringify(updated),
      });
      if (saved?.id) setTasks((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "save_failed");
      await loadAll();
    }
  }

  async function createTask(input: Partial<TickTickTask>) {
    if (!input.title || !input.projectId) return;
    try {
      const created = await api<TickTickTask>("/api/ticktick/tasks", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (created?.id) setTasks((prev) => [created, ...prev]);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "create_failed");
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect TickTick? Your stored credentials will be deleted from Daybook.")) return;
    try {
      await api("/api/ticktick/disconnect", { method: "POST" });
      setConn({ kind: "disconnected" });
      setProjects([]);
      setTasks([]);
      setInboxId("");
      setDoneLoaded(false);
      setSelected("all");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "disconnect_failed");
    }
  }

  /* ── Render states ── */

  if (conn.kind === "loading") {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="w-full px-12 py-10">
          <PageHeader title="Home" subtitle="Loading…" />
        </div>
      </div>
    );
  }

  if (conn.kind === "unconfigured") {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="w-full max-w-2xl px-12 py-10 mx-auto">
          <PageHeader title="Home" subtitle="TickTick is not configured yet" />
          <SetupNotice />
        </div>
      </div>
    );
  }

  if (conn.kind === "disconnected" || conn.kind === "error") {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="w-full max-w-md px-6 py-10 mx-auto">
          <PageHeader title="Home" subtitle="Sign in to TickTick to load your tasks" />
          {conn.kind === "error" && (
            <Banner kind="error" message={conn.message} onClose={() => setConn({ kind: "disconnected" })} />
          )}
          {banner && <Banner kind="info" message={banner} onClose={() => setBanner(null)} />}
          <SignInCard
            onSignedIn={async () => {
              setBanner("TickTick connected");
              setConn({ kind: "connected" });
              await loadAll();
            }}
          />
        </div>
      </div>
    );
  }

  /* ── Connected view ── */

  return (
    <div className="h-full overflow-hidden flex">
      <ProjectSidebar
        projects={allProjects}
        inboxId={inboxId}
        selected={selected}
        onSelect={setSelected}
        counts={counts}
      />

      <div className="flex-1 min-w-0 overflow-y-auto scroll-thin">
        <div className="w-full px-10 py-8">
          <PageHeader
            title={selected === "all" ? "All tasks" : projectsById.get(selected)?.name ?? "Tasks"}
            subtitle={`${filteredTasks.filter((t) => t.status !== 2).length} open · ${tasks.filter((t) => t.status === 2).length} completed`}
            right={
              <div className="flex items-center gap-2">
                <GhostButton onClick={() => loadAll()} icon={RefreshCw}>
                  {refreshing ? "Refreshing…" : "Refresh"}
                </GhostButton>
                <GhostButton onClick={() => setCreateOpen(true)} icon={Plus}>New task</GhostButton>
              </div>
            }
          />

          {banner && <Banner kind="info" message={banner} onClose={() => setBanner(null)} />}

          <div className="flex items-center justify-between gap-4 mb-5 -mt-3">
            <SearchInput value={query} onChange={setQuery} />
            <div className="flex items-center gap-2">
              <label className="text-[12.5px] text-mute flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => toggleShowDone(e.target.checked)}
                  className="accent-accent"
                />
                Show completed
              </label>
              <button
                onClick={disconnect}
                className="text-[12.5px] text-mute hover:text-neg px-2 py-1"
                title="Disconnect TickTick"
              >
                Disconnect
              </button>
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <EmptyState
              icon={Inbox}
              line={query ? `No tasks match “${query}”.` : "Nothing to do here. Nice."}
            />
          ) : (
            <ul className="rounded-xl bg-surface border border-line divide-y divide-line overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
              {filteredTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  project={projectsById.get(t.projectId)}
                  showProjectChip={selected === "all"}
                  onToggle={() => completeTask(t)}
                  onEdit={() => setEditTask(t)}
                  onDelete={() => deleteTask(t)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {editTask && (
        <TaskDrawer
          key={editTask.id}
          mode="edit"
          initial={editTask}
          projects={allProjects}
          onClose={() => setEditTask(null)}
          onSave={async (t) => { await saveTask(t as TickTickTask); setEditTask(null); }}
          onDelete={async (t) => { await deleteTask(t as TickTickTask); setEditTask(null); }}
        />
      )}
      {createOpen && (
        <TaskDrawer
          mode="create"
          initial={{ projectId: selected !== "all" ? selected : inboxId || projects[0]?.id || "" }}
          projects={allProjects}
          onClose={() => setCreateOpen(false)}
          onSave={async (t) => { await createTask(t); setCreateOpen(false); }}
        />
      )}
    </div>
  );
}

/* ── Project sidebar ───────────────────────────────────── */

function ProjectSidebar({
  projects, inboxId, selected, onSelect, counts,
}: {
  projects: TickTickProject[];
  inboxId: string;
  selected: string;
  onSelect: (id: string) => void;
  counts: { all: number; byProject: Map<string, number> };
}) {
  const sorted = useMemo(
    () => projects
      .filter((p) => !p.closed && p.id !== inboxId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [projects, inboxId],
  );
  return (
    <aside
      className="border-r border-line flex-shrink-0 overflow-y-auto scroll-thin"
      style={{ width: 240 }}
    >
      <div className="px-5 pt-7 pb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">
        Projects
      </div>
      <ul className="px-2 pb-2 space-y-0.5">
        <ProjectItem
          name="All tasks"
          color="var(--c-accent)"
          active={selected === "all"}
          count={counts.all}
          onClick={() => onSelect("all")}
          icon={<ListTodo size={14} strokeWidth={1.6} />}
        />
        {inboxId && (
          <ProjectItem
            name="Inbox"
            color="var(--c-accent)"
            active={selected === inboxId}
            count={counts.byProject.get(inboxId) ?? 0}
            onClick={() => onSelect(inboxId)}
            icon={<Inbox size={14} strokeWidth={1.6} />}
          />
        )}
      </ul>
      {sorted.length > 0 && (
        <>
          <div className="px-5 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">
            Lists
          </div>
          <ul className="px-2 pb-6 space-y-0.5">
            {sorted.map((p) => (
              <ProjectItem
                key={p.id}
                name={p.name}
                color={p.color || "var(--c-mute)"}
                active={selected === p.id}
                count={counts.byProject.get(p.id) ?? 0}
                onClick={() => onSelect(p.id)}
              />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function ProjectItem({
  name, color, active, count, onClick, icon,
}: {
  name: string;
  color?: string;
  active: boolean;
  count: number;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={[
          "group w-full flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md relative text-left",
          active ? "bg-surface text-ink" : "text-dim hover:text-ink hover:bg-surface/60",
        ].join(" ")}
        style={active ? { boxShadow: "var(--shadow-card)" } : undefined}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent" />
        )}
        <span className="shrink-0 flex items-center justify-center" style={{ color }}>
          {icon ?? <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
        </span>
        <span className="flex-1 truncate text-[13px] font-medium">{name}</span>
        {count > 0 && (
          <span className="text-[11px] tabular-nums text-mute">{count}</span>
        )}
      </button>
    </li>
  );
}

/* ── Task row ──────────────────────────────────────────── */

function TaskRow({
  task, project, showProjectChip, onToggle, onEdit, onDelete,
}: {
  task: TickTickTask;
  project?: TickTickProject;
  showProjectChip: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const due = formatDue(task.dueDate);
  const completed = task.status === 2;
  return (
    <li
      className="group px-4 py-3 flex items-start gap-3 hover:bg-surface2/50 cursor-pointer"
      onClick={onEdit}
    >
      <button
        onClick={(e) => { e.stopPropagation(); if (!completed) onToggle(); }}
        aria-label={completed ? "Completed" : "Complete task"}
        className="mt-0.5 shrink-0 text-mute hover:text-accent"
        title={completed ? "Completed" : "Mark complete"}
      >
        {completed
          ? <CheckCircle2 size={18} strokeWidth={1.6} className="text-accent" />
          : <Circle      size={18} strokeWidth={1.6} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {(task.priority ?? 0) > 0 && (
            <Flag
              size={12}
              strokeWidth={2}
              style={{ color: PRIORITY_COLOR[(task.priority ?? 0) as Priority] }}
            />
          )}
          <span className={[
            "text-[13.5px] tracking-[-0.01em]",
            completed ? "text-mute line-through" : "text-ink group-hover:text-accent font-medium",
          ].join(" ")}
          >
            {task.title}
          </span>
          {showProjectChip && project && (
            <span
              className="text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                background: "var(--c-surface2)",
                color: project.color || "var(--c-mute)",
                border: "1px solid var(--c-line)",
              }}
            >
              {project.name}
            </span>
          )}
        </div>
        {(task.content || task.desc) && (
          <div className="text-[12.5px] text-mute mt-1 line-clamp-2">
            {task.content || task.desc}
          </div>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          {due.label && (
            <span
              className={[
                "inline-flex items-center gap-1 text-[12px]",
                due.tone === "overdue" ? "text-neg" :
                due.tone === "today"   ? "text-accent" :
                due.tone === "soon"    ? "text-dim" : "text-mute",
              ].join(" ")}
            >
              <Calendar size={11} strokeWidth={1.8} /> {due.label}
            </span>
          )}
          {task.items && task.items.length > 0 && (
            <span className="text-[12px] text-mute tabular-nums">
              {task.items.filter((i) => i.status === 2).length}/{task.items.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="w-7 h-7 rounded-full grid place-items-center text-mute hover:bg-accent-soft hover:text-accent"
          aria-label="Edit"
        >
          <Edit2 size={14} strokeWidth={1.6} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm("Delete this task?")) onDelete(); }}
          className="w-7 h-7 rounded-full grid place-items-center text-mute hover:bg-neg-soft hover:text-neg"
          aria-label="Delete"
        >
          <Trash2 size={14} strokeWidth={1.6} />
        </button>
        <ChevronRight size={14} className="text-mute" />
      </div>
    </li>
  );
}

/* ── Search ────────────────────────────────────────────── */

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full max-w-sm">
      <Search
        size={14}
        strokeWidth={1.6}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tasks…"
        className="w-full bg-surface border border-line rounded-md pl-9 pr-8 py-2 text-[13.5px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-mute hover:text-ink hover:bg-surface2"
        >
          <X size={12} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

/* ── Banner ────────────────────────────────────────────── */

function Banner({ kind, message, onClose }: { kind: "info" | "error"; message: string; onClose: () => void }) {
  const isErr = kind === "error";
  return (
    <div
      className={`mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-[13px] ${
        isErr ? "border-neg/40 bg-neg-soft text-neg" : "border-line bg-surface text-dim"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <AlertCircle size={14} strokeWidth={1.6} className={isErr ? "text-neg" : "text-mute"} />
        <span className="truncate">{message}</span>
      </span>
      <button onClick={onClose} className="text-mute hover:text-ink shrink-0" aria-label="Dismiss">
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/* ── Setup notice (when env vars missing) ──────────────── */

function SetupNotice() {
  return (
    <div className="rounded-xl bg-surface border border-line p-6" style={{ boxShadow: "var(--shadow-card)" }}>
      <h2 className="text-[16px] font-semibold tracking-tight">One-time TickTick setup</h2>
      <p className="mt-1 text-[13.5px] text-dim">
        Daybook signs in to TickTick on your behalf and stores your password
        <strong> AES-256-GCM encrypted </strong>
        in your own Supabase. We need a single 32-byte key in
        {" "}<code className="px-1 rounded bg-surface2">.env.local</code> to encrypt it.
      </p>
      <ol className="mt-4 space-y-2 text-[13.5px] text-dim list-decimal list-inside">
        <li>
          Apply the migration{" "}
          <code className="px-1 rounded bg-surface2">supabase/ticktick_credentials.sql</code>{" "}
          in your Supabase SQL editor.
        </li>
        <li>
          Generate a fresh key:{" "}
          <code className="px-1 rounded bg-surface2">openssl rand -hex 32</code>
        </li>
        <li>Add it to <code className="px-1 rounded bg-surface2">.env.local</code>:</li>
      </ol>
      <pre className="mt-3 bg-surface2 border border-line rounded-md p-3 text-[12.5px] overflow-x-auto">
{`# 64 hex characters (32 random bytes). Treat as a secret.
TICKTICK_ENC_KEY=...`}
      </pre>
      <p className="mt-3 text-[12.5px] text-mute">
        Restart <code>npm run dev</code> and reload. Full instructions live in <code>TICKTICK_SETUP.md</code>.
      </p>
    </div>
  );
}

/* ── Sign-in card ──────────────────────────────────────── */

function SignInCard({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [region,   setRegion]   = useState<"global" | "china">("global");
  const [show,     setShow]     = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/ticktick/signin", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, region }),
      });
      await onSignedIn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "signin_failed";
      if (msg === "ticktick_auth") setErr("Invalid email or password.");
      else if (msg === "ticktick_captcha") setErr("TickTick is asking for a captcha. Sign in once at ticktick.com in your browser, then retry.");
      else setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl bg-surface border border-line p-6"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-accent-soft text-accent grid place-items-center">
          <ListTodo size={16} strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Sign in to TickTick</h2>
          <p className="text-[12px] text-mute">Email + password is sent to TickTick over HTTPS, then encrypted at rest.</p>
        </div>
      </div>

      {err && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-neg/40 bg-neg-soft text-neg px-3 py-2 text-[12.5px]">
          <AlertCircle size={14} strokeWidth={1.6} />
          <span>{err}</span>
        </div>
      )}

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Email</span>
          <div className="relative">
            <Mail size={14} strokeWidth={1.6} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-bg border border-line rounded-md pl-9 pr-3 py-2 text-[13.5px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
            />
          </div>
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Password</span>
          <div className="relative">
            <Lock size={14} strokeWidth={1.6} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-bg border border-line rounded-md pl-9 pr-9 py-2 text-[13.5px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded text-mute hover:text-ink hover:bg-surface2"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Region</span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as "global" | "china")}
            className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-line2 focus:bg-surface2"
          >
            <option value="global">Global (ticktick.com)</option>
            <option value="china">China (dida365.com)</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-mute inline-flex items-center gap-1.5">
          <ShieldCheck size={12} strokeWidth={1.8} className="text-accent" />
          Encrypted with AES-256-GCM
        </span>
        <PrimaryButton onClick={() => submit()} disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </div>
      <p className="mt-3 text-[11.5px] text-mute">
        2FA-enabled TickTick accounts can&rsquo;t use this method.
        Strongly recommend a TickTick-only password (don&rsquo;t reuse it elsewhere).
      </p>
    </form>
  );
}

/* ── Task drawer (create + edit) ───────────────────────── */

function TaskDrawer({
  mode, initial, projects, onClose, onSave, onDelete,
}: {
  mode: "create" | "edit";
  initial: Partial<TickTickTask>;
  projects: TickTickProject[];
  onClose: () => void;
  onSave: (t: Partial<TickTickTask>) => void | Promise<void>;
  onDelete?: (t: Partial<TickTickTask>) => void | Promise<void>;
}) {
  const [title,    setTitle]    = useState(initial.title ?? "");
  const [content,  setContent]  = useState(initial.content ?? initial.desc ?? "");
  const [projectId, setProjectId] = useState(initial.projectId ?? projects[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>((initial.priority ?? 0) as Priority);
  const [due,      setDue]      = useState(toLocalInput(initial.dueDate));
  const [start,    setStart]    = useState(toLocalInput(initial.startDate));

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    const payload: Partial<TickTickTask> = {
      ...initial,
      title:     title.trim(),
      content:   content,
      projectId,
      priority,
      dueDate:   fromLocalInput(due),
      startDate: fromLocalInput(start),
    };
    await onSave(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "New task" : "Edit task"}
      width={620}
      footer={
        <>
          {mode === "edit" && onDelete && (
            <button
              onClick={() => { if (confirm("Delete this task?")) onDelete(initial); }}
              className="text-[13.5px] text-mute hover:text-neg px-3 py-2 mr-auto"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="text-[13.5px] text-dim hover:text-ink px-3 py-2">Cancel</button>
          <PrimaryButton onClick={submit} disabled={!title.trim() || !projectId}>
            {mode === "create" ? "Create" : "Save"}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Buy milk" autoFocus />

        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-line2 focus:bg-surface2"
          >
            {projects.length === 0 ? (
              <option value="">No projects available</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Due</span>
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-line2 focus:bg-surface2"
            />
          </div>
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Start</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-line2 focus:bg-surface2"
            />
          </div>
        </div>

        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Priority</span>
          <div className="flex items-center gap-1">
            {([0, 1, 3, 5] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`px-3 py-1.5 rounded-md text-[12.5px] inline-flex items-center gap-1.5 border ${
                  priority === p
                    ? "bg-surface text-ink border-line2"
                    : "text-mute border-line hover:text-ink hover:border-line2"
                }`}
              >
                {p > 0 && <Flag size={12} style={{ color: PRIORITY_COLOR[p] }} />}
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <TextArea label="Notes" value={content} onChange={setContent} rows={4} placeholder="Anything else…" />

        {mode === "edit" && initial.items && initial.items.length > 0 && (
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Subtasks</span>
            <div className="space-y-1">
              {initial.items.map((i, idx) => (
                <div key={i.id ?? idx} className="flex items-center gap-2 text-[13px]">
                  {i.status === 2
                    ? <CheckCircle2 size={14} className="text-accent" />
                    : <Circle size={14} className="text-mute" />}
                  <span className={i.status === 2 ? "text-mute line-through" : "text-dim"}>{i.title}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-mute italic">
              Subtasks are read-only here for now — open in TickTick to edit.
            </p>
          </div>
        )}

        {mode === "edit" && (
          <div className="flex items-center gap-2 text-[12px] text-mute">
            <Pill>ID: {initial.id}</Pill>
          </div>
        )}
      </div>
    </Modal>
  );
}
