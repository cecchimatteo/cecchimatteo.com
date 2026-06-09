"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  Link2, FileText, ExternalLink, Trash2, Bookmark, Search,
  ChevronRight, ChevronDown, ChevronLeft,
} from "lucide-react";

const PAGE_SIZE = 30;
import {
  PageHeader, Modal, TextField, PrimaryButton, GhostButton,
  EmptyState, FAB,
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

/* ── Legacy plain-text → HTML conversion for backwards compatibility ── */
function looksLikeHtml(s: string): boolean {
  return /<\w+[\s>]/.test(s);
}

function plainToHtml(s: string): string {
  // Multi-line plain text → bullet list; single line → paragraph.
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return lines.length === 1 ? `<p>${escapeHtml(lines[0])}</p>` : "<p></p>";
  }
  return `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summaryToHtml(summary: string): string {
  if (!summary) return "";
  return looksLikeHtml(summary) ? summary : plainToHtml(summary);
}

/* ── Page ── */
export default function ReadingPage() {
  const [items,       setItems]       = useState<ReadingItem[]>([]);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [modalOpen,   setModalOpen]   = useState(false);
  const [filterKind,  setFilterKind]  = useState<Kind | null>(null);
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(0);

  const supabase = createClient();

  useEffect(() => {
    supabase.from("reading_items").select("*").order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        setItems(data.map((r: Record<string, unknown>) => ({
          id:        r.id as string,
          kind:      r.kind as Kind,
          title:     r.title as string,
          url:       r.url as string | undefined,
          source:    r.source as string,
          summary:   r.summary as string,
          pageCount: r.page_count as number | undefined,
          fileName:  r.file_name as string | undefined,
          createdAt: r.created_at as string,
        })));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addItem(item: Omit<ReadingItem, "id" | "createdAt">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("reading_items")
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
      .select().single();
    if (data) {
      setItems((prev) => [{
        id:        data.id,
        kind:      data.kind,
        title:     data.title,
        url:       data.url,
        source:    data.source,
        summary:   data.summary,
        pageCount: data.page_count,
        fileName:  data.file_name,
        createdAt: data.created_at,
      }, ...prev]);
    }
  }

  async function deleteItem(id: string) {
    await supabase.from("reading_items").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filterKind && i.kind !== filterKind) return false;
      if (q) {
        const hay = `${i.title} ${i.source} ${i.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filterKind, search]);

  // Reset to first page whenever the filtered set changes shape
  useEffect(() => { setPage(0); }, [filterKind, search]);

  const pageCount  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, pageCount - 1);
  const pageStart  = safePage * PAGE_SIZE;
  const pageEnd    = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageItems  = filtered.slice(pageStart, pageEnd);

  const pdfCount = items.filter((i) => i.kind === "pdf").length;
  const urlCount = items.length - pdfCount;
  const hasFilters = filterKind !== null || search !== "";

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="px-12 py-10" style={{ maxWidth: 1100, margin: "0 auto" }}>

        <PageHeader
          title="Reading Log"
          subtitle={`${items.length} item${items.length !== 1 ? "s" : ""} · ${urlCount} URL${urlCount !== 1 ? "s" : ""} · ${pdfCount} PDF${pdfCount !== 1 ? "s" : ""}`}
        />

        {/* ── Filter bar ── */}
        {items.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, source, summary…"
                className="h-8 w-64 pl-8 pr-3 bg-surface border border-line rounded-md text-[13px] text-ink placeholder:text-mute focus:outline-none focus:border-line2"
              />
            </div>

            <div className="flex items-center gap-1">
              <FilterChip active={filterKind === null}  onClick={() => setFilterKind(null)}  label="All" />
              <FilterChip active={filterKind === "url"} onClick={() => setFilterKind(filterKind === "url" ? null : "url")} label="URL" icon={Link2} />
              <FilterChip active={filterKind === "pdf"} onClick={() => setFilterKind(filterKind === "pdf" ? null : "pdf")} label="PDF" icon={FileText} />
            </div>

            {hasFilters && (
              <button
                onClick={() => { setFilterKind(null); setSearch(""); }}
                className="h-8 px-2.5 text-[12px] text-mute hover:text-ink"
              >
                Clear
              </button>
            )}

            <div className="ml-auto text-[12px] text-mute tabular-nums">
              {filtered.length} / {items.length}
            </div>
          </div>
        )}

        {/* ── Table ── */}
        {items.length === 0 ? (
          <EmptyState icon={Bookmark} line="Nothing saved yet. Add a URL or PDF to get started." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} line="No entries match these filters." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface">
                    <th className="w-9" />
                    <th className="px-3 py-2.5 text-left  text-[10.5px] uppercase tracking-[0.07em] font-semibold text-mute">Title</th>
                    <th className="px-3 py-2.5 text-left  text-[10.5px] uppercase tracking-[0.07em] font-semibold text-mute">Source</th>
                    <th className="px-3 py-2.5 text-right text-[10.5px] uppercase tracking-[0.07em] font-semibold text-mute">Added</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item, i) => {
                    const isOpen   = expandedId === item.id;
                    const isLast   = i === pageItems.length - 1;
                    const dateStr  = new Date(item.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
                    return (
                      <Fragment key={item.id}>
                        <tr
                          onClick={() => setExpandedId(isOpen ? null : item.id)}
                          className={`group cursor-pointer select-none hover:bg-surface/60 ${!isLast || isOpen ? "border-b border-line/60" : ""}`}
                        >
                          <td className="pl-3 pr-0 py-2.5 text-mute">
                            {isOpen
                              ? <ChevronDown  size={14} strokeWidth={1.5} />
                              : <ChevronRight size={14} strokeWidth={1.5} className="opacity-40 group-hover:opacity-80 transition-opacity" />}
                          </td>
                          <td className="px-3 py-2.5 max-w-[520px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="flex-shrink-0 text-mute">
                                {item.kind === "pdf"
                                  ? <FileText size={13} strokeWidth={1.5} />
                                  : <Link2    size={13} strokeWidth={1.5} />}
                              </span>
                              <span className="text-ink font-medium truncate" title={item.title}>{item.title}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-dim truncate max-w-[240px]" title={item.source}>{item.source || "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-mute whitespace-nowrap">{dateStr}</td>
                          <td className="w-8" />
                        </tr>

                        {isOpen && (
                          <tr className={!isLast ? "border-b border-line/60" : ""}>
                            <td colSpan={5} className="px-12 py-5 bg-surface/30">
                              <ExpandedRow item={item} onDelete={() => deleteItem(item.id)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            {filtered.length > 0 && (
              <div className="mt-4 flex items-center justify-between text-[12px] text-mute">
                <span className="tabular-nums">
                  {pageStart + 1}–{pageEnd} of {filtered.length}
                </span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <PagerBtn disabled={safePage === 0}              onClick={() => setPage(safePage - 1)}>
                      <ChevronLeft size={13} strokeWidth={1.5} /> Prev
                    </PagerBtn>
                    <span className="px-3 tabular-nums">
                      Page {safePage + 1} of {pageCount}
                    </span>
                    <PagerBtn disabled={safePage >= pageCount - 1}   onClick={() => setPage(safePage + 1)}>
                      Next <ChevronRight size={13} strokeWidth={1.5} />
                    </PagerBtn>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <FAB onClick={() => setModalOpen(true)} label="Add reading item" />

      <AddItemModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={addItem}
      />
    </div>
  );
}

/* ── Pager button ── */
function PagerBtn({
  onClick, disabled, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md border border-line bg-surface text-dim hover:text-ink hover:border-line2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-dim"
    >
      {children}
    </button>
  );
}

/* ── Filter chip ── */
function FilterChip({
  active, onClick, label, icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-surface2 border border-line2 text-ink"
          : "bg-surface border border-line text-dim hover:text-ink hover:border-line2"
      }`}
    >
      {Icon && <Icon size={12} strokeWidth={1.5} />}
      {label}
    </button>
  );
}

/* ── Expanded row body (summary + actions) ── */
function ExpandedRow({
  item, onDelete,
}: {
  item: ReadingItem;
  onDelete: () => void;
}) {
  const html = summaryToHtml(item.summary);
  return (
    <div className="flex flex-col gap-4">
      {html && (
        <div
          className="note-body border-l-2 border-line pl-4"
          style={{ fontSize: 13, color: "var(--c-dim)" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      <div className="flex items-center gap-5 text-[12px] flex-wrap">
        {item.kind === "url" && item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink size={12} strokeWidth={1.5} /> Open
          </a>
        )}
        {item.fileName && (
          <span className="flex items-center gap-1 text-mute">
            <FileText size={12} strokeWidth={1.5} /> {item.fileName}
          </span>
        )}
        {item.pageCount != null && (
          <span className="text-mute tabular-nums">{item.pageCount} pages</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="ml-auto flex items-center gap-1 text-mute hover:text-[#E04E58] transition-colors"
        >
          <Trash2 size={12} strokeWidth={1.5} /> Delete
        </button>
      </div>
    </div>
  );
}

/* ── Add-item modal ── */
function AddItemModal({
  open, onClose, onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (item: Omit<ReadingItem, "id" | "createdAt">) => void;
}) {
  const [kind,    setKind]    = useState<Kind>("url");
  const [url,     setUrl]     = useState("");
  const [title,   setTitle]   = useState("");
  const [source,  setSource]  = useState("");
  const [pages,   setPages]   = useState("");
  const [file,    setFile]    = useState<File | null>(null);
  const [summary, setSummary] = useState("");          // HTML
  const [dragging, setDrag]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setKind("url");
    setUrl(""); setTitle(""); setSource(""); setPages("");
    setFile(null); setSummary("");
  }

  function close() { reset(); onClose(); }

  function domain(u: string) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
  }

  function handleFile(f: File) {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
  }

  function isEmptySummary() {
    // Tiptap empty state is "<p></p>"
    return !summary || summary === "<p></p>" || /^<p>\s*<\/p>$/.test(summary);
  }

  const canSave = kind === "url"
    ? url.trim().length > 0
    : title.trim().length > 0;

  function save() {
    if (kind === "url") {
      onSave({
        kind:    "url",
        url:     url.trim(),
        title:   title.trim() || `Auto: ${domain(url)}`,
        source:  domain(url),
        summary: isEmptySummary() ? "" : summary,
      });
    } else {
      onSave({
        kind:      "pdf",
        title:     title.trim(),
        source:    source.trim(),
        summary:   isEmptySummary() ? "" : summary,
        pageCount: pages ? parseInt(pages, 10) : undefined,
        fileName:  file?.name,
      });
    }
    close();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add to reading log"
      width={640}
      footer={
        <>
          <GhostButton onClick={close}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!canSave}>Save</PrimaryButton>
        </>
      }
    >
      {/* Type toggle */}
      <div className="mb-5 flex items-center gap-0.5 bg-surface2 rounded-md p-0.5 w-fit">
        {(["url", "pdf"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`px-3 h-7 text-[12px] font-medium rounded transition-colors flex items-center gap-1.5 ${
              kind === k
                ? "bg-bg text-ink shadow-sm"
                : "text-mute hover:text-ink"
            }`}
          >
            {k === "url" ? <Link2 size={12} strokeWidth={1.5} /> : <FileText size={12} strokeWidth={1.5} />}
            {k === "url" ? "URL" : "PDF"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {kind === "url" ? (
          <>
            <TextField label="URL"   value={url}   onChange={setUrl}   placeholder="https://…" autoFocus type="url" />
            <TextField label="Title" value={title} onChange={setTitle} placeholder={url ? `Auto: ${domain(url)}` : "Title"} />
          </>
        ) : (
          <>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f?.type === "application/pdf") handleFile(f);
              }}
              className={`w-full flex flex-col items-center justify-center py-7 border-2 border-dashed rounded-md cursor-pointer ${
                dragging
                  ? "border-mute bg-surface2/50"
                  : "border-line2 hover:border-mute hover:bg-surface2/50"
              }`}
            >
              <FileText size={20} strokeWidth={1.25} className="text-mute mb-2" />
              {file ? (
                <>
                  <span className="text-[13px] font-medium">{file.name}</span>
                  <span className="text-[11px] text-mute mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
                </>
              ) : (
                <span className="text-[13px] text-mute">Drop a PDF here or click to browse</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <TextField label="Title" value={title} onChange={setTitle} placeholder="Paper / book title" autoFocus />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 100px" }}>
              <TextField label="Source / author" value={source} onChange={setSource} placeholder="Author or journal" />
              <TextField label="Pages"           value={pages}  onChange={setPages}  placeholder="—" type="number" />
            </div>
          </>
        )}

        {/* Rich-text summary */}
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">
            Notes / summary
          </span>
          <RichEditor
            value={summary}
            onChange={setSummary}
            placeholder="What did you take away?"
            minHeight={180}
          />
        </label>
      </div>
    </Modal>
  );
}
