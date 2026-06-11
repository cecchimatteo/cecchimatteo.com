"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, ExternalLink, Rss, X } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase";

/* ── Types ── */
interface FeedItem {
  id:             number;
  source:         string;          // 'ubs_daily' | 'rbc_macromemo' | 'jpm_eotm' | future…
  url:            string;
  title:          string;
  published_date: string;          // 'YYYY-MM-DD'
  metadata:       Record<string, unknown> | null;
  first_seen_at:  string;
}

/* ── Source metadata (slug → display name + brand colour) ── */
const SOURCE_META: Record<string, { label: string; short: string; color: string }> = {
  ubs_daily:     { label: "UBS CIO Daily",         short: "UBS", color: "#EC0016" },
  rbc_macromemo: { label: "RBC GAM MacroMemo",     short: "RBC", color: "#0051A5" },
  jpm_eotm:      { label: "JPM Eye on the Market", short: "JPM", color: "#0066B2" },
};

function sourceMeta(slug: string) {
  return SOURCE_META[slug] ?? {
    label: slug,
    short: slug.slice(0, 3).toUpperCase(),
    color: "var(--color-mute)",
  };
}

/* ── Date helpers ── */
function ymdLocal(d: Date): string {
  // Format a Date as YYYY-MM-DD in the local timezone — matches the
  // published_date strings that come back from Postgres.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function relativeDateLabel(ymd: string): string {
  const today     = new Date();
  const todayYmd  = ymdLocal(today);
  const yest      = new Date(today); yest.setDate(today.getDate() - 1);
  const yestYmd   = ymdLocal(yest);

  if (ymd === todayYmd) return "Today";
  if (ymd === yestYmd)  return "Yesterday";

  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === today.getFullYear();
  return date.toLocaleDateString("en-CA", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    year:    sameYear ? undefined : "numeric",
  });
}

function fmtRelativeTime(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)         return "just now";
  if (sec < 3600)       return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400)     return `${Math.round(sec / 3600)}h ago`;
  if (sec < 86_400 * 7) return `${Math.round(sec / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/* ── Page ── */
export default function FeedPage() {
  const [items,    setItems]    = useState<FeedItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [source,   setSource]   = useState<string | null>(null);   // null = all sources
  const [search,   setSearch]   = useState("");

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("macro_feed")
      .select("*")
      .order("published_date", { ascending: false })
      .order("first_seen_at",  { ascending: false })
      .limit(500);
    setItems((data as FeedItem[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  /* ── Distinct sources actually present in the data ── */
  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) s.add(i.source);
    return [...s];
  }, [items]);

  /* ── Most recent ingestion across all items (for the header subtitle) ── */
  const lastSeenAt = useMemo(() => {
    let max = "";
    for (const i of items) if (i.first_seen_at > max) max = i.first_seen_at;
    return max;
  }, [items]);

  /* ── Apply filters ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (source && i.source !== source) return false;
      if (q && !i.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, source, search]);

  /* ── Group by published_date (which is already sorted desc) ── */
  const groups = useMemo(() => {
    const out: { date: string; items: FeedItem[] }[] = [];
    for (const item of filtered) {
      const last = out[out.length - 1];
      if (last && last.date === item.published_date) {
        last.items.push(item);
      } else {
        out.push({ date: item.published_date, items: [item] });
      }
    }
    return out;
  }, [filtered]);

  /* ── Render ── */
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="px-12 py-10" style={{ maxWidth: 880, margin: "0 auto" }}>

        <PageHeader
          title="Feed"
          subtitle={
            loading && items.length === 0
              ? "Loading…"
              : items.length === 0
                ? "No items yet. Run the scrapers on the VPS to populate this feed."
                : `${items.length} item${items.length !== 1 ? "s" : ""} · ${sources.map((s) => sourceMeta(s).short).join(" · ")}${lastSeenAt ? ` · updated ${fmtRelativeTime(lastSeenAt)}` : ""}`
          }
          right={
            <button
              onClick={load}
              disabled={loading}
              className="h-8 px-3 text-[13.5px] font-medium bg-surface border border-line rounded-md text-dim hover:text-ink hover:border-line2 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw size={13} strokeWidth={1.5} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          }
        />

        {/* ── Filter bar ── */}
        {items.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles…"
                className="h-8 w-64 pl-8 pr-3 bg-surface border border-line rounded-md text-[13.5px] text-ink placeholder:text-mute focus:outline-none focus:border-line2"
              />
            </div>

            {/* Source filter chips */}
            <div className="flex items-center gap-1">
              <SourceChip active={source === null} onClick={() => setSource(null)} label="All" />
              {sources.map((s) => {
                const m = sourceMeta(s);
                return (
                  <SourceChip
                    key={s}
                    active={source === s}
                    onClick={() => setSource(s === source ? null : s)}
                    label={m.short}
                    color={m.color}
                  />
                );
              })}
            </div>

            {(source || search) && (
              <button
                onClick={() => { setSource(null); setSearch(""); }}
                className="h-8 px-2.5 text-[12px] text-mute hover:text-ink flex items-center gap-1"
              >
                <X size={12} strokeWidth={1.5} /> Clear
              </button>
            )}

            <div className="ml-auto text-[12px] text-mute tabular-nums">
              {filtered.length.toLocaleString()} / {items.length.toLocaleString()}
            </div>
          </div>
        )}

        {/* ── Body ── */}
        {loading && items.length === 0 ? (
          <div className="rounded-lg border border-line p-12 text-center text-[13.5px] text-mute">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Rss}
            line="No feed items yet. Once a scraper run completes on the VPS, results show up here."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            line="No items match these filters."
          />
        ) : (
          <div className="space-y-8">
            {groups.map(({ date, items: dayItems }) => (
              <section key={date}>
                <h2 className="mb-3 flex items-baseline gap-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
                    {relativeDateLabel(date)}
                  </span>
                  <span className="text-[10px] text-mute tabular-nums opacity-60">{date}</span>
                  <span className="flex-1 h-px bg-line ml-2" />
                </h2>

                <ul className="rounded-lg border border-line overflow-hidden bg-surface/40">
                  {dayItems.map((item, i) => (
                    <li
                      key={item.id}
                      className={i < dayItems.length - 1 ? "border-b border-line/60" : ""}
                    >
                      <FeedRow item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="text-[11px] text-mute mt-8">
          {sources.length > 0 && (
            <>
              Sources: {sources.map((s) => sourceMeta(s).label).join(" · ")}
              {" · "}
            </>
          )}
          Scrapers run on a VPS cron and upsert into Supabase.
        </p>
      </div>
    </div>
  );
}

/* ── Source filter chip ── */
function SourceChip({
  active, onClick, label, color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-md text-[13.5px] font-medium tracking-wide transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-surface2 border border-line2 text-ink"
          : "bg-surface border border-line text-dim hover:text-ink hover:border-line2"
      }`}
    >
      {color && (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.65 }}
        />
      )}
      {label}
    </button>
  );
}

/* ── Feed row ── */
function FeedRow({ item }: { item: FeedItem }) {
  const m = sourceMeta(item.source);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-4 px-4 py-3 hover:bg-surface transition-colors"
    >
      <SourceBadge label={m.short} color={m.color} />

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-ink truncate group-hover:underline decoration-line2 underline-offset-2">
          {item.title}
        </p>
        <p className="text-[11px] text-mute mt-0.5 flex items-center gap-1.5">
          <span>{m.label}</span>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">First seen {fmtRelativeTime(item.first_seen_at)}</span>
        </p>
      </div>

      <ExternalLink
        size={13}
        strokeWidth={1.5}
        className="text-mute group-hover:text-ink flex-shrink-0"
      />
    </a>
  );
}

/* ── Source badge (left of each row) ── */
function SourceBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-11 h-6 rounded text-[10px] font-bold tracking-wider border flex-shrink-0"
      style={{
        color,
        borderColor: color,
        background:  "color-mix(in srgb, " + color + " 8%, transparent)",
      }}
    >
      {label}
    </span>
  );
}
