"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 6); // 6 AM → midnight (24)

function formatHour(h: number): string {
  if (h === 12) return "12:00 PM";
  if (h === 24) return "12:00 AM";
  if (h > 12)  return `${h - 12}:00 PM`;
  return `${h}:00 AM`;
}

function toKey(d: Date): string { return d.toISOString().slice(0, 10); }
function isToday(d: Date): boolean { return toKey(d) === toKey(new Date()); }
function isFuture(d: Date): boolean {
  const today = new Date(); today.setHours(0,0,0,0);
  const cmp   = new Date(d); cmp.setHours(0,0,0,0);
  return cmp > today;
}

type DayEntries = Record<number, string>;
type Entries    = Record<string, DayEntries>;

// hour 0 = daily note (requires updated DB constraint — see supabase/schema.sql)
const DAILY_NOTE_HOUR = 0;

export default function DiaryPage() {
  const [date, setDate]         = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [entries, setEntries]   = useState<Entries>({});
  const [editingHour, setEditing] = useState<number | null>(null);
  const [now, setNow]           = useState(new Date());
  const supabase = createClient();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dateKey    = toKey(date);
  const todayFlag  = isToday(date);
  const currentHour = todayFlag ? (now.getHours() === 0 ? 24 : now.getHours()) : -1;
  const dayEntries  = entries[dateKey] ?? {};
  const entryCount  = HOURS.filter((h) => dayEntries[h]?.trim()).length;

  useEffect(() => {
    supabase.from("diary_entries").select("hour, content").eq("date", dateKey)
      .then(({ data }) => {
        if (!data) return;
        const loaded: DayEntries = {};
        data.forEach(({ hour, content }: { hour: number; content: string }) => { loaded[hour] = content; });
        setEntries((prev) => ({ ...prev, [dateKey]: loaded }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  function setEntry(hour: number, text: string) {
    setEntries((prev) => ({ ...prev, [dateKey]: { ...(prev[dateKey] ?? {}), [hour]: text } }));
  }

  async function saveEntry(hour: number, content: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("diary_entries").upsert(
      { user_id: user.id, date: dateKey, hour, content },
      { onConflict: "user_id,date,hour" }
    );
  }

  function navigate(delta: number) {
    setDate((d) => { const n = new Date(d); n.setDate(n.getDate() + delta); return n; });
    setEditing(null);
  }

  const subtitle = todayFlag
    ? entryCount > 0 ? `${entryCount} ${entryCount === 1 ? "entry" : "entries"} · today` : "today"
    : entryCount > 0 ? `${entryCount} ${entryCount === 1 ? "entry" : "entries"}` : "";

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Main scroll area ── */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="px-12 py-10" style={{ maxWidth: 900, margin: "0 auto" }}>
          <PageHeader
            title={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            subtitle={subtitle}
            right={
              <div className="flex items-center gap-1">
                <button onClick={() => navigate(-1)} className="p-1.5 rounded-md text-mute hover:text-ink hover:bg-surface">
                  <ChevronLeft size={15} strokeWidth={1.5} />
                </button>
                <button onClick={() => navigate(1)} disabled={todayFlag} className="p-1.5 rounded-md text-mute hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={15} strokeWidth={1.5} />
                </button>
              </div>
            }
          />

          {/* Hour list */}
          <div>
            {HOURS.map((hour, i) => (
              <HourRow
                key={hour}
                hour={hour}
                text={dayEntries[hour] ?? ""}
                isLast={i === HOURS.length - 1}
                isCurrent={hour === currentHour}
                isEditing={editingHour === hour}
                onStartEdit={() => setEditing(hour)}
                onEndEdit={(t) => { setEditing(null); saveEntry(hour, t); }}
                onChange={(t) => setEntry(hour, t)}
              />
            ))}
          </div>

          {/* Daily note */}
          <div className="mt-10 pt-8 border-t border-line">
            <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-mute mb-4">Daily note</p>
            <DailyNoteEditor
              text={dayEntries[DAILY_NOTE_HOUR] ?? ""}
              isEditing={editingHour === DAILY_NOTE_HOUR}
              onStartEdit={() => setEditing(DAILY_NOTE_HOUR)}
              onEndEdit={(t) => { setEditing(null); saveEntry(DAILY_NOTE_HOUR, t); }}
              onChange={(t) => setEntry(DAILY_NOTE_HOUR, t)}
            />
          </div>
        </div>
      </div>

      {/* ── Right: Mini calendar ── */}
      <div className="flex-shrink-0 border-l border-line overflow-y-auto scroll-thin" style={{ width: 220 }}>
        <MiniCalendar
          selected={date}
          onSelect={(d) => { setDate(d); setEditing(null); }}
        />
      </div>
    </div>
  );
}

/* ── Hour row ── */
function HourRow({ hour, text, isLast, isCurrent, isEditing, onStartEdit, onEndEdit, onChange }: {
  hour: number; text: string; isLast: boolean; isCurrent: boolean;
  isEditing: boolean; onStartEdit: () => void; onEndEdit: (t: string) => void;
  onChange: (t: string) => void;
}) {
  const ref    = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(text);
  latest.current = text;

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
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }

  // Enter key → new bullet line
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const el  = ref.current!;
      const pos = el.selectionStart;
      const val = el.value;
      const newVal = val.slice(0, pos) + "\n" + val.slice(pos);
      onChange(newVal);
      requestAnimationFrame(() => {
        el.setSelectionRange(pos + 1, pos + 1);
        resize(el);
      });
    }
  }

  const hasText  = Boolean(text.trim());
  const lines    = text.split("\n").filter((l) => l.trim());
  const isBullet = lines.length >= 2;              // any multiline → bullets
  const dotClass  = isCurrent ? "bg-accent" : hasText ? "bg-line2" : "bg-line";
  const timeClass = isCurrent ? "text-accent font-medium" : hasText ? "text-dim" : "text-mute";

  return (
    <div className={`grid gap-6 py-3 ${!isLast ? "border-b border-line/60" : ""}`} style={{ gridTemplateColumns: "110px 1fr" }}>
      <div className={`flex items-start gap-2 pt-[7px] text-[12px] tabular-nums tracking-tight ${timeClass}`}>
        <div className={`w-1 h-1 rounded-full mt-[5px] flex-shrink-0 ${dotClass}`} />
        {formatHour(hour)}
      </div>
      <div className="min-h-[28px] group">
        {isEditing ? (
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => { onChange(e.target.value); resize(e.target); }}
            onKeyDown={handleKeyDown}
            onBlur={() => onEndEdit(latest.current)}
            placeholder="What happened?"
            rows={2}
            className="w-full text-[14px] font-serif text-ink bg-transparent border-none outline-none resize-none leading-relaxed placeholder:text-mute"
            style={{ minHeight: 28, maxHeight: 240 }}
          />
        ) : hasText ? (
          <div onClick={onStartEdit} className="cursor-text -mx-1 px-1 rounded hover:bg-surface/40">
            {isBullet ? (
              <ul className="list-disc pl-4 space-y-1">
                {lines.map((line, i) => <li key={i} className="text-[14px] font-serif leading-relaxed marker:text-mute">{line}</li>)}
              </ul>
            ) : (
              <p className="text-[14px] font-serif leading-relaxed whitespace-pre-wrap">{text}</p>
            )}
          </div>
        ) : (
          <button onClick={onStartEdit} className="text-[13px] text-mute hover:text-dim opacity-0 group-hover:opacity-100">
            + add an entry
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Daily note editor ── */
function DailyNoteEditor({ text, isEditing, onStartEdit, onEndEdit, onChange }: {
  text: string; isEditing: boolean; onStartEdit: () => void;
  onEndEdit: (t: string) => void; onChange: (t: string) => void;
}) {
  const ref    = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    if (isEditing && ref.current) { ref.current.focus(); resize(ref.current); }
  }, [isEditing]);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const el = ref.current!;
      const pos = el.selectionStart;
      const val = el.value;
      const newVal = val.slice(0, pos) + "\n" + val.slice(pos);
      onChange(newVal);
      requestAnimationFrame(() => { el.setSelectionRange(pos + 1, pos + 1); resize(el); });
    }
  }

  const hasText  = Boolean(text.trim());
  const lines    = text.split("\n").filter((l) => l.trim());
  const isBullet = lines.length >= 2;

  return (
    <div className="group min-h-[60px]">
      {isEditing ? (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { onChange(e.target.value); resize(e.target); }}
          onKeyDown={handleKeyDown}
          onBlur={() => onEndEdit(latest.current)}
          placeholder="Add a note for the day…"
          rows={3}
          className="w-full text-[14px] font-serif text-ink bg-transparent border-none outline-none resize-none leading-relaxed placeholder:text-mute"
          style={{ minHeight: 60, maxHeight: 400 }}
        />
      ) : hasText ? (
        <div onClick={onStartEdit} className="cursor-text -mx-1 px-1 rounded hover:bg-surface/40">
          {isBullet ? (
            <ul className="list-disc pl-4 space-y-1">
              {lines.map((line, i) => <li key={i} className="text-[14px] font-serif leading-relaxed marker:text-mute">{line}</li>)}
            </ul>
          ) : (
            <p className="text-[14px] font-serif leading-relaxed whitespace-pre-wrap">{text}</p>
          )}
        </div>
      ) : (
        <button onClick={onStartEdit} className="text-[13px] text-mute hover:text-dim opacity-0 group-hover:opacity-100">
          + add a note for the day
        </button>
      )}
    </div>
  );
}

/* ── Mini calendar (persistent) ── */
function MiniCalendar({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
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
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setView(new Date(year, month - 1, 1))} className="p-1 text-mute hover:text-ink rounded">
          <ChevronLeft size={13} strokeWidth={1.5} />
        </button>
        <span className="text-[12px] font-medium">
          {view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setView(new Date(year, month + 1, 1))} className="p-1 text-mute hover:text-ink rounded">
          <ChevronRight size={13} strokeWidth={1.5} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} className="h-7 flex items-center justify-center text-[9px] uppercase text-mute">{d}</div>
        ))}
      </div>

      {/* Day grid */}
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
                isSel    ? "bg-accent text-white font-medium"
                : isTodayC ? "border border-line2 text-dim"
                : future   ? "text-mute opacity-30 cursor-not-allowed"
                : "text-dim hover:bg-surface2",
              ].join(" ")}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Jump to today */}
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
