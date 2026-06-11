"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

/* ── Domain ─────────────────────────────────────────────── */

const HOURS = Array.from({ length: 19 }, (_, i) => i + 6); // 6 AM → midnight (24)
const DAILY_NOTE_HOUR = 0;

/** 1 = poor (pale red) → 5 = great (pale green). */
const RATINGS = [1, 2, 3, 4, 5] as const;
type Rating = (typeof RATINGS)[number];

const RATING_COLORS: Record<Rating, string> = {
  1: "#F87171", // pale red
  2: "#FB923C", // pale orange
  3: "#FBBF24", // pale amber
  4: "#84CC16", // pale lime
  5: "#22C55E", // pale green
};

function formatHour(h: number): string {
  if (h === 12) return "12 PM";
  if (h === 24) return "12 AM";
  if (h > 12)   return `${h - 12} PM`;
  return `${h} AM`;
}

function shortHour(h: number): string {
  if (h === 24) return "12a";
  if (h === 12) return "12p";
  if (h > 12)   return `${h - 12}p`;
  return `${h}a`;
}

type Phase = "past" | "current" | "future" | "neutral";

function hourId(h: number): string { return `hour-${h}`; }

function toKey(d: Date): string { return d.toISOString().slice(0, 10); }
function isToday(d: Date): boolean { return toKey(d) === toKey(new Date()); }
function isFuture(d: Date): boolean {
  const today = new Date(); today.setHours(0,0,0,0);
  const cmp   = new Date(d); cmp.setHours(0,0,0,0);
  return cmp > today;
}

type Item = {
  id: string;
  hour: number;
  content: string;
  created_at: string;
};

/* ── Page ───────────────────────────────────────────────── */

export default function DiaryPage() {
  const [date, setDate]           = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [items, setItems]         = useState<Item[]>([]);
  const [ratings, setRatings]     = useState<Record<number, Rating>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now, setNow]             = useState<Date>(() => new Date());
  const [addOpen, setAddOpen]     = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dateKey     = toKey(date);
  const todayFlag   = isToday(date);
  const currentHour = todayFlag ? (now.getHours() === 0 ? 24 : now.getHours()) : -1;

  // Default hour for the top-level quick-add: the real-world current hour,
  // clamped into the 6 AM → 12 AM range. (1-5 AM falls back to noon.)
  const defaultAddHour = (() => {
    const h = now.getHours() === 0 ? 24 : now.getHours();
    return HOURS.includes(h) ? h : 12;
  })();

  // Load entries
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("diary_entries")
      .select("id, hour, content, created_at")
      .eq("date", dateKey)
      .order("created_at", { ascending: true })
      .then(({ data }) => { if (!cancelled) setItems((data ?? []) as Item[]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  // Load ratings
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("diary_hour_ratings")
      .select("hour, rating")
      .eq("date", dateKey)
      .then(({ data }) => {
        if (cancelled) return;
        const map: Record<number, Rating> = {};
        (data ?? []).forEach((r: { hour: number; rating: number }) => {
          map[r.hour] = r.rating as Rating;
        });
        setRatings(map);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  // Optimistic add: synthesize the row client-side so the new bullet appears
  // instantly (no flash while we wait for the network). The same UUID is used
  // on the server, so subsequent updates/deletes-by-id continue to work.
  const addItem = useCallback(async (hour: number) => {
    const tempId = crypto.randomUUID();
    const newItem: Item = {
      id: tempId,
      hour,
      content: "",
      created_at: new Date().toISOString(),
    };
    setItems((prev) => [...prev, newItem]);
    setEditingId(tempId);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return tempId;
    await supabase
      .from("diary_entries")
      .insert({ id: tempId, user_id: user.id, date: dateKey, hour, content: "" });
    return tempId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  // Quick-add (from the top-level popover): insert with content pre-filled.
  const quickAdd = useCallback(async (hour: number, content: string) => {
    const tempId = crypto.randomUUID();
    const newItem: Item = {
      id: tempId,
      hour,
      content,
      created_at: new Date().toISOString(),
    };
    setItems((prev) => [...prev, newItem]);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("diary_entries")
      .insert({ id: tempId, user_id: user.id, date: dateKey, hour, content });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const patchItem = useCallback((id: string, content: string) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, content } : it));
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setEditingId((current) => current === id ? null : current);
    await supabase.from("diary_entries").delete().eq("id", id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishEdit = useCallback(async (id: string, content: string) => {
    setEditingId((current) => current === id ? null : current);
    const trimmed = content.trim();
    if (!trimmed) {
      setItems((prev) => prev.filter((it) => it.id !== id));
      await supabase.from("diary_entries").delete().eq("id", id);
    } else {
      await supabase.from("diary_entries").update({ content }).eq("id", id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRating = useCallback(async (hour: number, value: Rating | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setRatings((prev) => {
      const next = { ...prev };
      if (value === null) delete next[hour]; else next[hour] = value;
      return next;
    });
    if (value === null) {
      await supabase.from("diary_hour_ratings")
        .delete()
        .eq("user_id", user.id)
        .eq("date", dateKey)
        .eq("hour", hour);
    } else {
      await supabase.from("diary_hour_ratings").upsert(
        { user_id: user.id, date: dateKey, hour, rating: value },
        { onConflict: "user_id,date,hour" }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  function navigate(delta: number) {
    setDate((d) => { const n = new Date(d); n.setDate(n.getDate() + delta); return n; });
    setEditingId(null);
  }

  function jumpToToday() {
    const d = new Date(); d.setHours(0,0,0,0);
    setDate(d);
    setEditingId(null);
  }

  const dailyNote    = items.find((it) => it.hour === DAILY_NOTE_HOUR) ?? null;
  const totalEntries = items.filter((it) => it.hour !== DAILY_NOTE_HOUR && it.content.trim()).length;

  async function startDailyNote() {
    if (dailyNote) { setEditingId(dailyNote.id); return; }
    await addItem(DAILY_NOTE_HOUR);
  }

  const subtitleEntries = totalEntries === 0
    ? "no entries yet"
    : `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`;

  const liveTime = todayFlag
    ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Main scroll area ── */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="px-10 py-10 mx-auto" style={{ maxWidth: 1080 }}>

          {/* Header */}
          <header className="mb-8 flex items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-[26px] font-semibold tracking-tight leading-none">
                  {date.toLocaleDateString("en-US", { weekday: "long" })}
                </h1>
                <span className="text-[14px] text-mute leading-none">
                  {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <div className="flex items-center gap-2.5 mt-2 text-[11.5px]">
                {liveTime ? (
                  <span className="inline-flex items-center gap-1.5 text-accent font-medium tabular-nums">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                    </span>
                    {liveTime}
                  </span>
                ) : null}
                {liveTime && <span className="text-line2">·</span>}
                <span className="text-mute">{subtitleEntries}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {!todayFlag && (
                <button
                  onClick={jumpToToday}
                  className="text-[12px] text-mute hover:text-ink px-2.5 py-1 rounded-md hover:bg-surface"
                >
                  Today
                </button>
              )}
              <div className="flex items-center">
                <button
                  onClick={() => navigate(-1)}
                  aria-label="Previous day"
                  className="p-1.5 rounded-md text-mute hover:text-ink hover:bg-surface"
                >
                  <ChevronLeft size={15} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => navigate(1)}
                  disabled={todayFlag}
                  aria-label="Next day"
                  className="p-1.5 rounded-md text-mute hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={15} strokeWidth={1.5} />
                </button>
              </div>

              {/* Main quick-add */}
              <div className="relative">
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-accent px-3 py-1.5 rounded-md hover:opacity-90"
                >
                  <Plus size={13} strokeWidth={2} />
                  Add entry
                </button>
                <QuickAddPopover
                  open={addOpen}
                  defaultHour={defaultAddHour}
                  onClose={() => setAddOpen(false)}
                  onSubmit={quickAdd}
                />
              </div>
            </div>
          </header>

          {/* Hourly satisfaction chart */}
          <RatingChart
            ratings={ratings}
            currentHour={currentHour}
            todayFlag={todayFlag}
            onJump={(h) => {
              const el = document.getElementById(hourId(h));
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />

          {/* Daily note */}
          <DailyNoteCard
            item={dailyNote}
            isEditing={editingId === dailyNote?.id}
            onStart={startDailyNote}
            onChange={(c) => { if (dailyNote) patchItem(dailyNote.id, c); }}
            onFinish={(c) => { if (dailyNote) finishEdit(dailyNote.id, c); }}
          />

          {/* Hour list — clean rows separated by hairlines */}
          <div className="mt-6 border-t border-line">
            {HOURS.map((hour) => {
              const phase: Phase = !todayFlag
                ? "neutral"
                : hour < currentHour
                  ? "past"
                  : hour === currentHour
                    ? "current"
                    : "future";
              // Past hours fade further the older they are.
              const distance = phase === "past" ? currentHour - hour : 0;
              const opacity  = distance > 0 ? Math.max(0.2, 1 - distance * 0.07) : 1;
              return (
                <HourBlock
                  key={hour}
                  hour={hour}
                  phase={phase}
                  opacity={opacity}
                  items={items.filter((it) => it.hour === hour)}
                  rating={ratings[hour] ?? null}
                  editingId={editingId}
                  onAdd={() => addItem(hour)}
                  onStartEdit={(id) => setEditingId(id)}
                  onChange={patchItem}
                  onFinish={finishEdit}
                  onDelete={deleteItem}
                  onRate={(v) => setRating(hour, v)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Right: Mini calendar ── */}
      <div className="flex-shrink-0 border-l border-line overflow-y-auto scroll-thin" style={{ width: 220 }}>
        <MiniCalendar selected={date} onSelect={(d) => { setDate(d); setEditingId(null); }} />
      </div>
    </div>
  );
}

/* ── Hourly satisfaction chart ───────────────────────────── */

function RatingChart({
  ratings, currentHour, todayFlag, onJump,
}: {
  ratings: Record<number, Rating>;
  currentHour: number; // -1 if not today
  todayFlag: boolean;
  onJump: (hour: number) => void;
}) {
  const ratedCount = HOURS.filter((h) => ratings[h] !== undefined).length;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-mute">
          Hourly satisfaction
        </p>
        <p className="text-[10px] text-mute tabular-nums">
          {ratedCount}/{HOURS.length} rated
        </p>
      </div>

      {/* Bars */}
      <div className="flex items-end gap-[3px] h-[56px] px-px">
        {HOURS.map((h) => {
          const r         = ratings[h] ?? null;
          // 5-step ramp: 1=28%, 2=44%, 3=60%, 4=76%, 5=92%. Unrated = 8%.
          const heightPct = r ? 12 + r * 16 : 8;
          const color     = r ? RATING_COLORS[r] : "var(--c-line2)";
          const isCur     = todayFlag && h === currentHour;
          const distance  = todayFlag && h < currentHour ? currentHour - h : 0;
          const baseOpacity = distance > 0 ? Math.max(0.2, 1 - distance * 0.07) : 1;
          const opacity   = r ? baseOpacity : baseOpacity * 0.55;

          return (
            <button
              key={h}
              type="button"
              onClick={() => onJump(h)}
              className="flex-1 flex flex-col items-stretch justify-end h-full relative group/bar hover:opacity-100"
              style={{ opacity }}
              aria-label={`${formatHour(h)}${r ? `, rating ${r} of 5` : ", no rating"}`}
              title={`${formatHour(h)}${r ? ` · ${r}/5` : ""}`}
            >
              {isCur && (
                <span
                  className="absolute -top-2 left-1/2 -translate-x-1/2 inline-block w-[5px] h-[5px] rotate-45 bg-accent"
                  aria-hidden
                />
              )}
              <span
                className="w-full rounded-sm transition-transform group-hover/bar:scale-y-105 origin-bottom"
                style={{ height: `${heightPct}%`, backgroundColor: color }}
              />
            </button>
          );
        })}
      </div>

      {/* X-axis labels: sparse to avoid clutter */}
      <div className="flex gap-[3px] mt-1.5 px-px">
        {HOURS.map((h) => {
          const showLabel = [6, 9, 12, 15, 18, 21, 24].includes(h);
          return (
            <div key={h} className="flex-1 text-center text-[9px] text-mute tabular-nums">
              {showLabel ? shortHour(h) : ""}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Daily note card ─────────────────────────────────────── */

function DailyNoteCard({
  item, isEditing, onStart, onChange, onFinish,
}: {
  item: Item | null;
  isEditing: boolean;
  onStart: () => void;
  onChange: (c: string) => void;
  onFinish: (c: string) => void;
}) {
  const ref    = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<string>(item?.content ?? "");
  latest.current = item?.content ?? "";

  useEffect(() => {
    if (isEditing && ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
      resize(ref.current);
    }
  }, [isEditing]);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 360)}px`;
  }

  const text    = item?.content ?? "";
  const hasText = Boolean(text.trim());

  return (
    <section
      className={[
        "rounded-xl border bg-surface px-5 py-4",
        isEditing ? "border-line2" : "border-line",
      ].join(" ")}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-mute">Daily note</p>
        {hasText && !isEditing && (
          <button onClick={onStart} className="text-[11px] text-mute hover:text-ink">Edit</button>
        )}
      </div>

      {isEditing ? (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { onChange(e.target.value); resize(e.target); }}
          onBlur={() => onFinish(latest.current)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onFinish(latest.current); } }}
          placeholder="What's the shape of today?"
          rows={3}
          className="w-full text-[14px] font-sans text-ink bg-transparent border-none outline-none resize-none leading-relaxed placeholder:text-mute"
          style={{ minHeight: 56, maxHeight: 360 }}
        />
      ) : hasText ? (
        <div
          onClick={onStart}
          className="cursor-text text-[14px] font-sans leading-relaxed whitespace-pre-wrap text-ink"
        >
          {text}
        </div>
      ) : (
        <button
          onClick={onStart}
          className="text-[13px] text-mute hover:text-dim font-sans"
        >
          What&apos;s the shape of today?
        </button>
      )}
    </section>
  );
}

/* ── Hour block ──────────────────────────────────────────── */

function HourBlock({
  hour, phase, opacity, items, rating, editingId, onAdd, onStartEdit, onChange, onFinish, onDelete, onRate,
}: {
  hour: number;
  phase: Phase;
  opacity: number;
  items: Item[];
  rating: Rating | null;
  editingId: string | null;
  onAdd: () => void;
  onStartEdit: (id: string) => void;
  onChange: (id: string, content: string) => void;
  onFinish: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRate: (value: Rating | null) => void;
}) {
  const hasItems  = items.length > 0;
  const isCurrent = phase === "current";

  const timeClass = isCurrent
    ? "text-accent"
    : hasItems
      ? "text-dim"
      : "text-mute";

  return (
    <section
      id={hourId(hour)}
      className="group/hour relative border-b border-line/60 py-3 px-2 hover:opacity-100 transition-opacity"
      style={{ opacity }}
    >
      {/* Accent strip on the left edge of the current hour */}
      {isCurrent && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-accent"
          aria-hidden
        />
      )}

      <div
        className="grid items-start gap-4"
        style={{ gridTemplateColumns: "110px minmax(0,1fr) auto" }}
      >
        {/* Left: hour label + Now pill */}
        <div className="flex items-center gap-2 pt-[3px]">
          {isCurrent ? (
            <span className="relative flex" aria-hidden>
              <span className="absolute inline-flex h-1.5 w-1.5 rounded-full bg-accent opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
          ) : (
            <span className="w-1.5" aria-hidden />
          )}
          <span className={`text-[12px] tabular-nums tracking-tight font-medium ${timeClass}`}>
            {formatHour(hour)}
          </span>
          {isCurrent && (
            <span className="text-[9px] uppercase tracking-[0.1em] font-semibold text-accent bg-accent-soft px-1.5 py-[1px] rounded">
              Now
            </span>
          )}
        </div>

        {/* Middle: bullets + click-to-add zone */}
        <div className="min-h-[24px] flex flex-col gap-[3px]">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              isEditing={editingId === it.id}
              onStartEdit={() => onStartEdit(it.id)}
              onChange={(c) => onChange(it.id, c)}
              onFinish={(c) => onFinish(it.id, c)}
              onDelete={() => onDelete(it.id)}
              onAddSibling={onAdd}
            />
          ))}
          <button
            onClick={onAdd}
            aria-label="Add a bullet"
            className="cursor-text rounded-sm text-left text-[11.5px] text-mute italic opacity-0 group-hover/hour:opacity-100 px-1 py-[2px]"
          >
            {hasItems ? "" : "click to add a bullet…"}
          </button>
        </div>

        {/* Right: satisfaction rating */}
        <div className="pt-[5px]">
          <RatingDots value={rating} onChange={onRate} />
        </div>
      </div>
    </section>
  );
}

/* ── Rating dots ─────────────────────────────────────────── */

function RatingDots({
  value, onChange,
}: {
  value: Rating | null;
  onChange: (v: Rating | null) => void;
}) {
  const [hover, setHover] = useState<Rating | null>(null);
  const effective = hover ?? value;
  // Color follows the topmost lit dot for at-a-glance reading.
  const litColor = effective ? RATING_COLORS[effective] : null;

  return (
    <div
      className="flex items-center gap-[3px]"
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label="Hour satisfaction"
    >
      {RATINGS.map((n) => {
        const lit = effective !== null && n <= effective;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`Rate ${n} out of 5`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(value === n ? null : n)}
            className="w-[10px] h-[10px] rounded-full border transition-colors"
            style={{
              backgroundColor: lit && litColor ? litColor : "transparent",
              borderColor: lit && litColor ? litColor : "var(--c-line2)",
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Quick-add popover ──────────────────────────────────── */

function QuickAddPopover({
  open, defaultHour, onClose, onSubmit,
}: {
  open: boolean;
  defaultHour: number;
  onClose: () => void;
  onSubmit: (hour: number, content: string) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [hour, setHour] = useState<number>(defaultHour);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the popover is opened
  useEffect(() => {
    if (open) {
      setText("");
      setHour(defaultHour);
      // Focus on next tick so the autofocus picks up after the panel mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultHour]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  /**
   * Submit the current text. When `closeAfter` is true (clicking the Add
   * button), the popover dismisses. When false (pressing Enter in the input),
   * the popover stays open with the text field cleared and refocused, so the
   * user can rapid-fire bullets to the same hour.
   */
  async function submit(closeAfter: boolean) {
    const t = text.trim();
    if (!t) return;
    await onSubmit(hour, t);
    if (closeAfter) {
      onClose();
    } else {
      setText("");
      inputRef.current?.focus();
    }
  }

  return (
    <>
      {/* Click-outside scrim (transparent) */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-0 top-full mt-2 z-40 bg-surface border border-line rounded-lg p-3"
        style={{ width: 300, boxShadow: "var(--shadow-drawer)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(false); }
          }}
          placeholder="What happened?"
          className="w-full bg-bg border border-line rounded-md px-2.5 py-1.5 text-[13px] text-ink placeholder:text-mute focus:outline-none focus:border-line2"
        />
        <div className="flex items-center gap-2 mt-2">
          <label className="text-[10.5px] uppercase tracking-wider text-mute font-medium flex-shrink-0">
            Hour
          </label>
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="flex-1 bg-bg border border-line rounded-md px-2 py-1 text-[12.5px] text-ink focus:outline-none focus:border-line2 tabular-nums"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
          <button
            onClick={() => submit(true)}
            disabled={!text.trim()}
            className="bg-accent text-white text-[12px] font-medium px-3 py-1 rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-[10.5px] text-mute">Enter to add another · Esc to close</p>
      </div>
    </>
  );
}

/* ── Item row ────────────────────────────────────────────── */

function ItemRow({
  item, isEditing, onStartEdit, onChange, onFinish, onDelete, onAddSibling,
}: {
  item: Item;
  isEditing: boolean;
  onStartEdit: () => void;
  onChange: (c: string) => void;
  onFinish: (c: string) => void;
  onDelete: () => void;
  onAddSibling: () => void;
}) {
  const ref    = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(item.content);
  latest.current = item.content;

  useEffect(() => {
    if (isEditing && ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
      resize(ref.current);
    }
  }, [isEditing]);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 22), 200)}px`;
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Enter: save current + create a new bullet sibling.
    // Shift+Enter: newline within current item.
    // Escape: dismiss without creating sibling.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const content = latest.current.trim();
      onFinish(latest.current);
      if (content) onAddSibling();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFinish(latest.current);
    }
  }

  // Bullet marker — kept consistent in both view and edit modes
  const Bullet = (
    <span className="text-mute select-none flex-shrink-0 leading-none mt-[7px]" style={{ fontSize: 8 }} aria-hidden>
      ●
    </span>
  );

  if (isEditing) {
    return (
      <div className="flex items-start gap-2 -mx-1 px-1">
        {Bullet}
        <textarea
          ref={ref}
          value={item.content}
          onChange={(e) => { onChange(e.target.value); resize(e.target); }}
          onKeyDown={handleKeyDown}
          onBlur={() => onFinish(latest.current)}
          placeholder="What happened?"
          rows={1}
          className="flex-1 min-w-0 text-[12.5px] font-sans text-ink bg-transparent border-none outline-none resize-none leading-snug placeholder:text-mute"
          style={{ minHeight: 18, maxHeight: 200 }}
        />
      </div>
    );
  }

  if (!item.content.trim()) return null;

  return (
    <div className="group/item flex items-start gap-2 -mx-1 px-1 py-[2px] rounded hover:bg-surface2/40">
      {Bullet}
      <p
        onClick={onStartEdit}
        className="flex-1 min-w-0 cursor-text text-[12.5px] font-sans leading-snug whitespace-pre-wrap text-ink"
      >
        {item.content}
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover/item:opacity-100 text-mute hover:text-ink p-0.5 -mt-0.5 flex-shrink-0"
        aria-label="Delete entry"
      >
        <Trash2 size={10} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/* ── Mini calendar ───────────────────────────────────────── */

function MiniCalendar({
  selected, onSelect,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
}) {
  const [view, setView] = useState(() => { const d = new Date(selected); d.setDate(1); return d; });

  useEffect(() => {
    setView(() => { const d = new Date(selected); d.setDate(1); return d; });
  }, [selected]);

  const today = new Date(); today.setHours(0,0,0,0);
  const year  = view.getFullYear();
  const month = view.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <div className="px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="p-1 text-mute hover:text-ink rounded"
          aria-label="Previous month"
        >
          <ChevronLeft size={13} strokeWidth={1.5} />
        </button>
        <span className="text-[12px] font-medium">
          {view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="p-1 text-mute hover:text-ink rounded"
          aria-label="Next month"
        >
          <ChevronRight size={13} strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} className="h-7 flex items-center justify-center text-[9px] uppercase text-mute">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cell = new Date(year, month, day); cell.setHours(0,0,0,0);
          const isSel    = toKey(cell) === toKey(selected);
          const isTodayC = toKey(cell) === toKey(today);
          const future   = isFuture(cell);
          return (
            <button
              key={i}
              disabled={future}
              onClick={() => onSelect(cell)}
              className={[
                "h-7 w-full flex items-center justify-center text-[12px] rounded",
                isSel
                  ? "bg-accent text-white font-medium"
                  : isTodayC
                    ? "border border-line2 text-dim"
                    : future
                      ? "text-mute opacity-30 cursor-not-allowed"
                      : "text-dim hover:bg-surface2",
              ].join(" ")}
            >
              {day}
            </button>
          );
        })}
      </div>

      {!isToday(selected) && (
        <button
          onClick={() => { const d = new Date(); d.setHours(0,0,0,0); onSelect(d); }}
          className="mt-4 w-full text-[11px] text-accent hover:underline text-center"
        >
          Jump to today
        </button>
      )}
    </div>
  );
}
