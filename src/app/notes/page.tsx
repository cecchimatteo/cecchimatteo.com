"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Trash2, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { NotesEditor } from "@/components/NotesEditor";
import { createClient } from "@/lib/supabase";

const SECTION_COLORS = ["#5B7FFF", "#F5A623", "#7C5CFF", "#3CC78D", "#E04E58", "#0EA5C7"];
const LS_PREFIX = "note_draft_";

interface Section { id: string; name: string; color: string; position: number; }
interface Note    { id: string; sectionId: string; title: string; html: string; updated: Date; }

function fmtRelative(d: Date): string {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtEdited(d: Date): string {
  return `Edited ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export default function NotesPage() {
  const [sections, setSections]             = useState<Section[]>([]);
  const [notes, setNotes]                   = useState<Note[]>([]);
  const [activeSectionId, setActiveSection] = useState<string | null>(null);
  const [activeNoteId, setActiveNote]       = useState<string | null>(null);
  const [renamingId, setRenamingId]         = useState<string | null>(null);
  const [renameValue, setRenameValue]       = useState("");
  const [collapsed, setCollapsed]           = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const saveTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to a "flush now" fn — updated whenever the active note changes
  // so visibilitychange / beforeunload can call it safely
  const pendingFlushRef = useRef<(() => void) | null>(null);
  const supabase = createClient();

  const activeSection = sections.find((s) => s.id === activeSectionId) ?? null;
  const sectionNotes  = notes.filter((n) => n.sectionId === activeSectionId).sort((a, b) => b.updated.getTime() - a.updated.getTime());
  const activeNote    = notes.find((n) => n.id === activeNoteId) ?? null;

  /* ── Load sections ── */
  useEffect(() => {
    supabase.from("note_sections").select("*").order("position").then(({ data }) => {
      if (data) setSections(data.map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, color: r.color as string, position: r.position as number,
      })));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Load notes when section changes + recover any localStorage drafts ── */
  useEffect(() => {
    if (!activeSectionId) return;
    supabase.from("notes").select("*").eq("section_id", activeSectionId).order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const loaded = data.map((r: Record<string, unknown>) => {
          const noteId   = r.id as string;
          const dbHtml   = r.html as string;
          const dbUpdated = new Date(r.updated_at as string);

          // If a localStorage draft exists and is newer → use it and re-save to Supabase
          try {
            const draft = localStorage.getItem(`${LS_PREFIX}${noteId}`);
            if (draft) {
              const parsed = JSON.parse(draft) as { html: string; ts: number };
              if (parsed.ts > dbUpdated.getTime()) {
                // Draft is newer — restore it silently
                supabase.from("notes")
                  .update({ html: parsed.html, updated_at: new Date(parsed.ts).toISOString() })
                  .eq("id", noteId);
                localStorage.removeItem(`${LS_PREFIX}${noteId}`);
                return { id: noteId, sectionId: r.section_id as string, title: r.title as string, html: parsed.html, updated: new Date(parsed.ts) };
              } else {
                localStorage.removeItem(`${LS_PREFIX}${noteId}`);
              }
            }
          } catch { /* ignore localStorage errors */ }

          return { id: noteId, sectionId: r.section_id as string, title: r.title as string, html: dbHtml, updated: dbUpdated };
        });
        setNotes((prev) => [...prev.filter((n) => n.sectionId !== activeSectionId), ...loaded]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingId]);

  /* ── Flush on tab hide / page unload ── */
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") pendingFlushRef.current?.();
    }
    function handleBeforeUnload() { pendingFlushRef.current?.(); }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  /* ── Sections CRUD ── */
  async function addSection() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const position = sections.length;
    const color    = SECTION_COLORS[position % SECTION_COLORS.length];
    const { data } = await supabase.from("note_sections")
      .insert({ user_id: user.id, name: "New section", color, position }).select().single();
    if (!data) return;
    const sec: Section = { id: data.id, name: data.name, color: data.color, position: data.position };
    setSections((prev) => [...prev, sec]);
    setActiveSection(sec.id); setActiveNote(null);
    setRenamingId(sec.id); setRenameValue("New section");
    if (collapsed) setCollapsed(false);
  }

  async function deleteSection(id: string) {
    if (!confirm("Delete this section and all its notes?")) return;
    await supabase.from("note_sections").delete().eq("id", id);
    setSections((prev) => prev.filter((s) => s.id !== id));
    setNotes((prev) => prev.filter((n) => n.sectionId !== id));
    if (activeSectionId === id) { setActiveSection(null); setActiveNote(null); }
  }

  async function commitRename() {
    if (!renamingId) return;
    const name = renameValue.trim() || "Untitled section";
    await supabase.from("note_sections").update({ name }).eq("id", renamingId);
    setSections((prev) => prev.map((s) => s.id === renamingId ? { ...s, name } : s));
    setRenamingId(null);
  }

  /* ── Notes CRUD ── */
  async function addNote() {
    if (!activeSectionId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("notes")
      .insert({ user_id: user.id, section_id: activeSectionId, title: "", html: "" }).select().single();
    if (!data) return;
    const note: Note = { id: data.id, sectionId: data.section_id, title: data.title, html: data.html, updated: new Date(data.updated_at) };
    setNotes((prev) => [note, ...prev]);
    setActiveNote(note.id);
  }

  async function updateNoteTitle(id: string, title: string) {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title, updated: new Date() } : n));
    await supabase.from("notes").update({ title, updated_at: new Date().toISOString() }).eq("id", id);
  }

  /* Debounced save — also stores a localStorage backup first */
  const scheduleNoteSave = useCallback((id: string, html: string) => {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, html, updated: new Date() } : n));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase.from("notes").update({ html, updated_at: new Date().toISOString() }).eq("id", id);
      // Draft successfully saved to Supabase — remove localStorage backup
      try { localStorage.removeItem(`${LS_PREFIX}${id}`); } catch { /* ok */ }
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Immediate save — cancels debounce, writes straight to Supabase */
  const flushNoteSave = useCallback(async (id: string, html: string) => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, html, updated: new Date() } : n));
    await supabase.from("notes").update({ html, updated_at: new Date().toISOString() }).eq("id", id);
    try { localStorage.removeItem(`${LS_PREFIX}${id}`); } catch { /* ok */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteNote(id: string) {
    try { localStorage.removeItem(`${LS_PREFIX}${id}`); } catch { /* ok */ }
    await supabase.from("notes").delete().eq("id", id);
    setNotes((prev) => {
      const rest = prev.filter((n) => n.id !== id);
      const next = rest.find((n) => n.sectionId === activeSectionId);
      setActiveNote(next?.id ?? null);
      return rest;
    });
  }

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Pane 1: Sections ── */}
      <div
        className="flex flex-col border-r border-line bg-bg overflow-hidden flex-shrink-0"
        style={{ width: collapsed ? 44 : 200, transition: "width 200ms ease" }}
      >
        {collapsed ? (
          <>
            <button onClick={() => setCollapsed(false)} title="Expand sections"
              className="flex items-center justify-center h-10 text-mute hover:text-ink border-b border-line flex-shrink-0">
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
            <div className="flex-1 overflow-y-auto scroll-thin py-2">
              {sections.map((sec) => (
                <button key={sec.id} title={sec.name}
                  onClick={() => { setActiveSection(sec.id); setActiveNote(null); }}
                  className={["w-full flex items-center justify-center py-2.5 transition-opacity",
                    activeSectionId === sec.id ? "opacity-100" : "opacity-50 hover:opacity-90"].join(" ")}
                >
                  <div className="w-2.5 h-2.5 rounded-sm" style={{
                    backgroundColor: sec.color,
                    boxShadow: activeSectionId === sec.id ? `0 0 0 2px ${sec.color}33` : undefined,
                  }} />
                </button>
              ))}
            </div>
            <div className="border-t border-line py-2 flex items-center justify-center flex-shrink-0">
              <button onClick={addSection} title="New section" className="p-1.5 text-mute hover:text-ink rounded">
                <Plus size={13} strokeWidth={1.5} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pt-6 pb-3 flex items-center justify-between flex-shrink-0">
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-mute">Sections</p>
              <button onClick={() => setCollapsed(true)} title="Collapse sections" className="text-mute hover:text-ink p-1 -mr-1 rounded">
                <ChevronLeft size={13} strokeWidth={1.5} />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto scroll-thin px-2">
              {sections.map((sec) => (
                <li key={sec.id} className="relative group mb-0.5">
                  {renamingId === sec.id ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface">
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: sec.color }} />
                      <input ref={renameInputRef} value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") { setRenameValue(sec.name); setRenamingId(null); }
                        }}
                        className="flex-1 min-w-0 text-[13px] font-medium bg-transparent outline-none text-ink"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => { setActiveSection(sec.id); setActiveNote(null); }}
                      onDoubleClick={() => { setRenamingId(sec.id); setRenameValue(sec.name); }}
                      className={["w-full flex items-center gap-2 px-3 py-2 rounded-md relative text-left",
                        activeSectionId === sec.id ? "bg-surface" : "hover:bg-surface/60"].join(" ")}
                    >
                      {activeSectionId === sec.id && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full" style={{ backgroundColor: sec.color }} />
                      )}
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: sec.color }} />
                      <span className={`flex-1 min-w-0 text-[13px] font-medium truncate ${activeSectionId === sec.id ? "text-ink" : "text-dim"}`}>{sec.name}</span>
                      <span className="text-[10.5px] tabular-nums text-mute">{notes.filter((n) => n.sectionId === sec.id).length}</span>
                    </button>
                  )}
                  <button onClick={() => deleteSection(sec.id)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-mute hover:text-ink opacity-0 group-hover:opacity-100 rounded">
                    <Trash2 size={11} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-3 py-3 flex-shrink-0">
              <button onClick={addSection}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] text-dim hover:text-ink hover:bg-surface">
                <Plus size={13} strokeWidth={1.5} />New section
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Pane 2: Notes list ── */}
      <div className="flex flex-col border-r border-line overflow-hidden flex-shrink-0" style={{ width: 280 }}>
        {activeSection ? (
          <>
            <div className="px-5 pt-6 pb-3 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1.5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: activeSection.color }} />
                <h2 className="text-[15px] font-semibold tracking-tight truncate">{activeSection.name}</h2>
              </div>
              <button onClick={addNote} className="text-mute hover:text-ink p-1 -mr-1 rounded flex-shrink-0">
                <Plus size={16} strokeWidth={1.5} />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto scroll-thin px-2 pb-4">
              {sectionNotes.length === 0 ? (
                <p className="text-center text-[12px] text-mute py-8">No notes yet. Hit + to start.</p>
              ) : sectionNotes.map((note) => (
                <li key={note.id} className="mb-0.5">
                  <button onClick={() => setActiveNote(note.id)}
                    className={["w-full text-left rounded-md px-3 py-3", activeNoteId === note.id ? "bg-surface" : "hover:bg-surface/60"].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-medium truncate">{note.title || "Untitled note"}</span>
                      <span className="text-[11px] tabular-nums text-mute flex-shrink-0">{fmtRelative(note.updated)}</span>
                    </div>
                    <p className="text-[12px] text-mute line-clamp-1 mt-1">
                      {note.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "—"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[12px] text-mute text-center px-4">Select a section<br />or create one.</p>
          </div>
        )}
      </div>

      {/* ── Pane 3: Editor ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeNote ? (
          <>
            <div className="border-b border-line px-10 pt-8 pb-5 flex items-start justify-between flex-shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: activeSection?.color }} />
                  <span className="text-[11px] uppercase tracking-[0.08em] text-mute">{activeSection?.name}</span>
                </div>
                <input
                  value={activeNote.title}
                  onChange={(e) => updateNoteTitle(activeNote.id, e.target.value)}
                  placeholder="Untitled note"
                  className="w-full text-[26px] font-semibold tracking-tight bg-transparent border-none outline-none placeholder:text-mute"
                />
              </div>
              <div className="flex items-center gap-3 pt-8 flex-shrink-0 pl-4">
                <span className="text-[11.5px] tabular-nums text-mute">{fmtEdited(activeNote.updated)}</span>
                <button onClick={() => deleteNote(activeNote.id)} className="text-mute hover:text-ink p-1 rounded">
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* key={activeNoteId} → clean remount on note switch */}
            <NotesEditor
              key={activeNoteId}
              noteId={activeNote.id}
              initialHtml={activeNote.html}
              onUpdate={(html) => scheduleNoteSave(activeNote.id, html)}
              onFlush={(html) => {
                // Update pendingFlushRef so visibilitychange can call this
                pendingFlushRef.current = () => flushNoteSave(activeNote.id, html);
                flushNoteSave(activeNote.id, html);
              }}
            />
          </>
        ) : (
          <EmptyState icon={FileText} line="Select a note — or hit + to start a new one." />
        )}
      </div>
    </div>
  );
}
