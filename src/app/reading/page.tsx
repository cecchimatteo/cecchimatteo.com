"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link2, FileText, Globe, ExternalLink, Trash2, Edit2,
  ChevronRight, Bookmark,
} from "lucide-react";
import {
  PageHeader, Modal, TextField, PrimaryButton, GhostButton, EmptyState,
} from "@/components/ui";
import { RichEditor } from "@/components/RichEditor";
import { createClient } from "@/lib/supabase";

/* ── Types ── */
interface ReadingItem {
  id:         string;
  kind:       "url" | "pdf";
  title:      string;
  url?:       string;
  source:     string;
  summary:    string;          // HTML for new entries, plain text for legacy
  pageCount?: number;
  fileName?:  string;
  createdAt:  string;
}

type Kind = "url" | "pdf";

/* Shared grid template — header + every row stay aligned */
const ROW_GRID =
  "grid grid-cols-[60px_24px_minmax(0,1fr)_140px_88px] items-center gap-4";

/* ── Helpers ───────────────────────────────────────────── */

function cleanSource(s: string): string {
  return (s || "").replace(/^(https?:\/\/)?(www\.)?/, "");
}

function dayParts(d: Date) {
  return {
    day: d.getDate(),
    mon: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    year: d.getFullYear(),
  };
}

function looksLikeHtml(s: string): boolean { return /<\w+[\s>]/.test(s); }
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function plainToHtml(s: string): string {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return lines.length === 1 ? `<p>${escapeHtml(lines[0])}</p>` : "<p></p>";
  }
  return `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}
function summaryToHtml(summary: string): string {
  if (!summary) return "";
  return looksLikeHtml(summary) ? summary : plainToHtml(summary);
}
function isEmptySummary(html: string): boolean {
  return !html || html === "<p></p>" || /^<p>\s*<\/p>$/.test(html);
}

function rowFromDb(r: Record<string, unknown>): ReadingItem {
  return {
    id:        r.id as string,
    kind:      r.kind as Kind,
    title:     r.title as string,
    url:       r.url as string | undefined,
    source:    r.source as string,
    summary:   r.summary as string,
    pageCount: r.page_count as number | undefined,
    fileName:  r.file_name as string | undefined,
    createdAt: r.created_at as string,
  };
}

/* ── Page ──────────────────────────────────────────────── */

export default function ReadingPage() {
  const [items,       setItems]       = useState<ReadingItem[]>([]);
  const [filter,      setFilter]      = useState<"all" | Kind>("all");
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [editEntry,   setEditEntry]   = useState<ReadingItem | null>(null);
  const [urlOpen,     setUrlOpen]     = useState(false);
  const [pdfOpen,     setPdfOpen]     = useState(false);

  const supabase = createClient();

  useEffect(() => {
    supabase
      .from("reading_items")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setItems(data.map(rowFromDb)); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addItem(item: Omit<ReadingItem, "id" | "createdAt">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("reading_items")
      .insert({
        user_id:    user.id,
        kind:       item.kind,
        title:      item.title,
        url:        item.url,
        source:     item.source,
        summary:    item.summary,
        page_count: item.pageCount,
        file_name:  item.fileName,
      })
      .select()
      .single();
    if (data) setItems((prev) => [rowFromDb(data), ...prev]);
  }

  async function updateItem(updated: ReadingItem) {
    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    await supabase.from("reading_items").update({
      title:      updated.title,
      url:        updated.url,
      source:     updated.source,
      summary:    updated.summary,
      page_count: updated.pageCount,
    }).eq("id", updated.id);
  }

  async function deleteItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (expandedId === id) setExpandedId(null);
    await supabase.from("reading_items").delete().eq("id", id);
  }

  const counts = useMemo(() => ({
    all: items.length,
    url: items.filter((i) => i.kind === "url").length,
    pdf: items.filter((i) => i.kind === "pdf").length,
  }), [items]);

  const filtered = useMemo(
    () => items.filter((i) => filter === "all" || i.kind === filter),
    [items, filter]
  );

  const currentId = items[0]?.id; // most-recently added = currently reading

  return (
    <div className="w-full px-12 py-10">
      <PageHeader
        title="Reading Log"
        subtitle={`${items.length} saved`}
        right={
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setUrlOpen(true)} icon={Link2}>URL</GhostButton>
            <GhostButton onClick={() => setPdfOpen(true)} icon={FileText}>PDF</GhostButton>
          </div>
        }
      />

      <div className="flex items-center justify-end mb-5 -mt-3">
        <FilterTabs value={filter} onChange={setFilter} counts={counts} />
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Bookmark} line="Nothing here yet — save a link or PDF to get started." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Bookmark} line="No entries match this filter." />
      ) : (
        <ReadingTable
          items={filtered}
          currentId={currentId}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((c) => (c === id ? null : id))}
          onEdit={(entry) => setEditEntry(entry)}
          onDelete={deleteItem}
        />
      )}

      {editEntry && (
        <EditDrawer
          key={editEntry.id}
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSave={updateItem}
        />
      )}
      {urlOpen && <AddUrlDrawer onClose={() => setUrlOpen(false)} onAdd={addItem} />}
      {pdfOpen && <AddPdfDrawer onClose={() => setPdfOpen(false)} onAdd={addItem} />}
    </div>
  );
}

/* ── Table ─────────────────────────────────────────────── */

function ReadingTable({
  items, currentId, expandedId, onToggle, onEdit, onDelete,
}: {
  items: ReadingItem[];
  currentId?: string;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onEdit: (entry: ReadingItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="rounded-xl bg-surface border border-line overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className={`${ROW_GRID} px-5 py-2.5 border-b border-line text-[10px] font-semibold uppercase tracking-[0.14em] text-mute`}>
        <span>Date</span>
        <span />
        <span>Title</span>
        <span>Source</span>
        <span />
      </div>
      <div className="divide-y divide-line">
        {items.map((entry) => (
          <ReadingRow
            key={entry.id}
            entry={entry}
            current={entry.id === currentId}
            expanded={entry.id === expandedId}
            onToggle={() => onToggle(entry.id)}
            onEdit={() => onEdit(entry)}
            onDelete={() => onDelete(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ReadingRow({
  entry, current, expanded, onToggle, onEdit, onDelete,
}: {
  entry: ReadingItem;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group">
      <div
        onClick={onToggle}
        className={[
          `${ROW_GRID} px-5 py-3.5 cursor-pointer hover:bg-surface2/60`,
          current ? "border-l-[3px] border-l-accent pl-[17px]" : "pl-5",
          expanded ? "bg-surface2/50" : "",
        ].join(" ")}
      >
        <DateCell date={new Date(entry.createdAt)} />

        <span className="text-mute group-hover:text-dim">
          {entry.kind === "pdf"
            ? <FileText size={16} strokeWidth={1.6} />
            : <Globe    size={16} strokeWidth={1.6} />}
        </span>

        <span className="min-w-0 flex items-center gap-2">
          {current && (
            <span className="relative flex h-1.5 w-1.5 shrink-0" title="Currently reading">
              <span className="now-ping absolute inline-flex h-full w-full rounded-full bg-accent" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
            </span>
          )}
          <span
            className={`text-[13.5px] font-medium tracking-[-0.01em] truncate ${
              expanded ? "text-accent" : "text-ink group-hover:text-accent"
            }`}
            title={entry.title}
          >
            {entry.title}
          </span>
        </span>

        <span className="text-[13.5px] text-mute truncate flex items-center gap-1.5">
          {cleanSource(entry.source) || "—"}
          {entry.kind === "pdf" && entry.pageCount != null && (
            <span className="text-mute/70 tabular-nums whitespace-nowrap">
              · {entry.pageCount}p
            </span>
          )}
        </span>

        {/* Actions */}
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="w-7 h-7 rounded-full grid place-items-center text-mute opacity-0 group-hover:opacity-100 hover:bg-accent-soft hover:text-accent"
            aria-label="Edit"
          >
            <Edit2 size={14} strokeWidth={1.6} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-7 h-7 rounded-full grid place-items-center text-mute opacity-0 group-hover:opacity-100 hover:bg-neg-soft hover:text-neg"
            aria-label="Delete"
          >
            <Trash2 size={14} strokeWidth={1.6} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`w-7 h-7 rounded-full grid place-items-center ${
              expanded ? "text-accent bg-accent-soft" : "text-mute hover:text-ink hover:bg-surface2"
            }`}
            aria-label={expanded ? "Hide notes" : "Show notes"}
            aria-expanded={expanded}
          >
            <ChevronRight
              size={16}
              style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 160ms ease" }}
            />
          </button>
        </div>
      </div>

      {/* Inline expand */}
      {expanded && (
        <div className="scrim-enter px-5 pt-4 pb-6">
          <div className="ml-[100px] border-l-2 border-accent/40 pl-5">
            {entry.summary ? (
              <div
                className="note-body"
                style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--c-dim)" }}
                dangerouslySetInnerHTML={{ __html: summaryToHtml(entry.summary) }}
              />
            ) : (
              <p className="text-mute italic" style={{ fontSize: 13.5 }}>
                No notes yet — add some with Edit.
              </p>
            )}
            <div className="flex items-center gap-4 mt-3.5 text-[13.5px]">
              {entry.url && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
                >
                  <ExternalLink size={13} /> Open original
                </a>
              )}
              {entry.fileName && (
                <span className="inline-flex items-center gap-1.5 text-mute">
                  <FileText size={13} /> {entry.fileName}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="inline-flex items-center gap-1.5 text-mute hover:text-ink"
              >
                <Edit2 size={13} /> Edit notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Date cell ─────────────────────────────────────────── */

function DateCell({ date }: { date: Date }) {
  const { day, mon } = dayParts(date);
  return (
    <div className="flex items-baseline gap-1.5 leading-none select-none">
      <span
        className="text-[19px] font-semibold tabular-nums tracking-[-0.03em] text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {day}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">
        {mon}
      </span>
    </div>
  );
}

/* ── Filter tabs ───────────────────────────────────────── */

function FilterTabs({
  value, onChange, counts,
}: {
  value: "all" | Kind;
  onChange: (v: "all" | Kind) => void;
  counts: { all: number; url: number; pdf: number };
}) {
  const tabs: { id: "all" | Kind; label: string; n: number }[] = [
    { id: "all", label: "All",   n: counts.all },
    { id: "url", label: "Links", n: counts.url },
    { id: "pdf", label: "PDFs",  n: counts.pdf },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface2 border border-line">
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 rounded-md text-[13.5px] font-medium ${
              active ? "bg-surface text-ink" : "text-mute hover:text-dim"
            }`}
            style={active ? { boxShadow: "var(--shadow-card)" } : undefined}
          >
            {tab.label}
            <span
              className={`ml-1.5 tabular-nums text-[11px] ${active ? "text-mute" : "text-mute/70"}`}
            >
              {tab.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Edit drawer ───────────────────────────────────────── */

function EditDrawer({
  entry, onClose, onSave,
}: {
  entry: ReadingItem;
  onClose: () => void;
  onSave: (e: ReadingItem) => void | Promise<void>;
}) {
  // Lazy init from `entry` (the parent keys this component by `entry.id`, so
  // a fresh mount per entry is guaranteed — this is also what allows the
  // RichEditor to receive the saved HTML on its very first render, which is
  // required because the editor intentionally does not sync `value` after
  // mount).
  const [title,   setTitle]   = useState(entry.title || "");
  const [source,  setSource]  = useState(entry.source || "");
  const [url,     setUrl]     = useState(entry.url || "");
  const [pages,   setPages]   = useState(entry.pageCount != null ? String(entry.pageCount) : "");
  const [summary, setSummary] = useState(entry.summary || "");

  const save = async () => {
    await onSave({
      ...entry,
      title:    title.trim() || entry.title,
      source:   source.trim() || entry.source,
      url:      entry.kind === "url" ? url.trim() : entry.url,
      pageCount: entry.kind === "pdf" ? (pages ? Number(pages) : undefined) : entry.pageCount,
      summary:  isEmptySummary(summary) ? "" : summary,
    });
    onClose();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Edit entry"
      width={760}
      footer={
        <>
          <button onClick={onClose} className="text-[13.5px] text-dim hover:text-ink px-3 py-2">Cancel</button>
          <PrimaryButton onClick={save} disabled={!title.trim()}>Save changes</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField label="Title" value={title} onChange={setTitle} autoFocus />
        {entry.kind === "url" ? (
          <>
            <TextField label="URL"    value={url}    onChange={setUrl}    placeholder="https://…" />
            <TextField label="Source" value={source} onChange={setSource} placeholder="domain" />
          </>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 100px" }}>
            <TextField label="Source / author" value={source} onChange={setSource} placeholder="arXiv · 2024" />
            <TextField label="Pages"           value={pages}  onChange={setPages}  placeholder="—" type="number" />
          </div>
        )}
        <RichSummary value={summary} onChange={setSummary} />
      </div>
    </Modal>
  );
}

/* ── Add drawers ──────────────────────────────────────── */

function AddUrlDrawer({
  onClose, onAdd,
}: {
  onClose: () => void;
  onAdd: (item: Omit<ReadingItem, "id" | "createdAt">) => void | Promise<void>;
}) {
  const [url,     setUrl]     = useState("");
  const [title,   setTitle]   = useState("");
  const [summary, setSummary] = useState("");

  const domain = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();

  const submit = async () => {
    if (!url.trim()) return;
    await onAdd({
      kind:    "url",
      title:   title.trim() || domain || url,
      source:  domain || "link",
      url:     url.trim(),
      summary: isEmptySummary(summary) ? "" : summary,
    });
    onClose();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Save a URL"
      width={760}
      footer={
        <>
          <button onClick={onClose} className="text-[13.5px] text-dim hover:text-ink px-3 py-2">Cancel</button>
          <PrimaryButton onClick={submit} disabled={!url.trim()}>Save</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField label="URL"   value={url}   onChange={setUrl}
                   placeholder="https://…" autoFocus type="url" />
        <TextField label="Title" value={title} onChange={setTitle}
                   placeholder={domain ? `Auto: ${domain}` : "Article title"} />
        <RichSummary value={summary} onChange={setSummary} />
      </div>
    </Modal>
  );
}

function AddPdfDrawer({
  onClose, onAdd,
}: {
  onClose: () => void;
  onAdd: (item: Omit<ReadingItem, "id" | "createdAt">) => void | Promise<void>;
}) {
  const [title,   setTitle]   = useState("");
  const [source,  setSource]  = useState("");
  const [pages,   setPages]   = useState("");
  const [summary, setSummary] = useState("");
  const [file,    setFile]    = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!title.trim()) return;
    await onAdd({
      kind:      "pdf",
      title:     title.trim(),
      source:    source.trim() || (file ? file.name : "PDF"),
      pageCount: pages ? Number(pages) : undefined,
      summary:   isEmptySummary(summary) ? "" : summary,
      fileName:  file?.name,
    });
    onClose();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Add a PDF"
      width={760}
      footer={
        <>
          <button onClick={onClose} className="text-[13.5px] text-dim hover:text-ink px-3 py-2">Cancel</button>
          <PrimaryButton onClick={submit} disabled={!title.trim()}>Save</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-mute mb-2">PDF file</div>
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full border border-dashed border-line2 rounded-md py-8 text-center hover:border-mute hover:bg-surface2/50"
          >
            <FileText size={20} strokeWidth={1.25} className="mx-auto text-mute" />
            <div className="text-[13.5px] text-dim mt-2">
              {file ? file.name : "Drop a PDF here or click to browse"}
            </div>
            {file && (
              <div className="text-[11px] text-mute mt-1">
                {(file.size / 1024).toFixed(0)} KB
              </div>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
              }
            }}
          />
        </div>
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Paper / book title" />
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 100px" }}>
          <TextField label="Source / author" value={source} onChange={setSource} placeholder="arXiv · 2024" />
          <TextField label="Pages"           value={pages}  onChange={setPages}  placeholder="—" type="number" />
        </div>
        <RichSummary value={summary} onChange={setSummary} />
      </div>
    </Modal>
  );
}

/* ── Shared rich summary block ────────────────────────── */

function RichSummary({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // IMPORTANT: this wrapper must NOT be a <label>. A <label> sends any click
  // inside it to the first form control it contains — which, for a rich
  // editor, is the first toolbar <button> (Bold). That made clicks anywhere
  // in the notes area silently re-target the Bold button instead of putting
  // the caret in the editor, which felt like "focus jumped to the format
  // row and I have to tab a few times before I can type".
  return (
    <div className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">
        Notes / summary
      </span>
      <RichEditor
        value={value}
        onChange={onChange}
        placeholder="What did you take away?"
        minHeight={160}
      />
    </div>
  );
}
