"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import { Extension } from "@tiptap/core";
import { useState, useRef, useEffect } from "react";
import {
  Bold, Italic, Underline as UIcon, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Table as TableIcon, Undo2, Redo2, Trash2,
  ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ArrowDownToLine,
  Columns2, Rows2,
} from "lucide-react";

/* ── Type augmentation for FontSize commands ── */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

/* ── FontSize extension ── */
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() { return { types: ["textStyle"] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parseHTML: (el: any) => el.style?.fontSize || null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderHTML: (attrs: any) => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark("textStyle", { fontSize: size }).run(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const FONT_FAMILIES = [
  { label: "Serif",      value: "var(--font-lora), Georgia, serif" },
  { label: "Sans-serif", value: "var(--font-inter), system-ui, sans-serif" },
  { label: "Monospace",  value: "var(--font-jetbrains), monospace" },
];

const FONT_SIZES = ["10", "11", "12", "14", "16", "17", "18", "20", "24", "28", "32"];

interface NotesEditorProps {
  noteId: string;           // used for localStorage backup key
  initialHtml: string;
  onUpdate: (html: string) => void;  // debounced save
  onFlush:  (html: string) => void;  // immediate save (blur / unmount)
}

export function NotesEditor({ noteId, initialHtml, onUpdate, onFlush }: NotesEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  const onFlushRef  = useRef(onFlush);
  onUpdateRef.current = onUpdate;
  onFlushRef.current  = onFlush;

  // Track latest HTML in a ref so the cleanup effect can flush it
  const latestHtml = useRef(initialHtml);

  // Guard: skip onUpdate events that fire before the editor is truly ready
  // (TipTap may emit a transaction when it sets the initial content)
  const editorReady = useRef(false);

  // Dropdowns — pure local state, never read back from the editor
  const [selectedFont, setSelectedFont] = useState(FONT_FAMILIES[1].value);
  const [selectedSize, setSelectedSize] = useState("11");
  const [inTable,      setInTable]      = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: { class: "note-body focus:outline-none" },
    },
    onCreate: () => {
      // Allow one event-loop tick so any init transactions settle before
      // we start treating onUpdate calls as real user edits
      setTimeout(() => { editorReady.current = true; }, 0);
    },
    onTransaction: ({ editor: ed }) => {
      const nowInTable = ed.isActive("table");
      setInTable((prev) => (prev !== nowInTable ? nowInTable : prev));
    },
    onUpdate: ({ editor: ed }) => {
      if (!editorReady.current) return;        // skip init events
      const html = ed.getHTML();
      latestHtml.current = html;
      // Write-ahead to localStorage so a hard refresh doesn't lose data
      try { localStorage.setItem(`note_draft_${noteId}`, html); } catch { /* quota */ }
      onUpdateRef.current(html);               // schedules debounced Supabase save
    },
    onBlur: ({ editor: ed }) => {
      if (!editorReady.current) return;
      const html = ed.getHTML();
      latestHtml.current = html;
      onFlushRef.current(html);               // immediate Supabase save on blur
    },
    immediatelyRender: false,
  });

  // On unmount (note switch / navigation): flush any unsaved content immediately
  useEffect(() => {
    return () => {
      const html = latestHtml.current;
      onFlushRef.current(html);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!editor) return null;

  /* ── Helpers ── */
  function Btn({
    active = false, disabled = false, title, onClick, children,
  }: {
    active?: boolean; disabled?: boolean; title?: string; onClick: () => void; children: React.ReactNode;
  }) {
    return (
      <button
        title={title}
        disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
        className={[
          "w-7 h-7 flex items-center justify-center rounded flex-shrink-0 transition-none",
          disabled ? "opacity-30 cursor-not-allowed text-mute"
            : active ? "bg-accent text-white"
            : "text-dim hover:text-ink hover:bg-surface2",
        ].join(" ")}
      >
        {children}
      </button>
    );
  }

  function TblBtn({
    title, onClick, active = false, disabled = false, danger = false, children,
  }: {
    title: string; onClick: () => void; active?: boolean; disabled?: boolean;
    danger?: boolean; children: React.ReactNode;
  }) {
    return (
      <button
        title={title}
        disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
        style={danger && !disabled ? { color: "#E04E58" } : undefined}
        className={[
          "inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] font-medium flex-shrink-0 transition-none",
          disabled ? "opacity-30 cursor-not-allowed text-mute"
            : active ? "bg-accent text-white"
            : "text-dim hover:text-ink hover:bg-surface2",
        ].join(" ")}
      >
        {children}
      </button>
    );
  }

  function Sep()    { return <div className="w-px h-4 bg-line2 mx-0.5 flex-shrink-0" />; }
  function TblSep() { return <div className="w-px h-3.5 bg-line2 mx-1 flex-shrink-0" />; }

  const currentFont = selectedFont;
  const currentSize = selectedSize;
  const canMerge = editor.can().mergeCells();
  const canSplit = editor.can().splitCell();

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Main toolbar ── */}
      <div className="flex flex-wrap items-center gap-0.5 px-5 py-2 border-b border-line bg-surface flex-shrink-0">

        <select
          value={currentFont}
          onChange={(e) => { setSelectedFont(e.target.value); editor.chain().focus().setFontFamily(e.target.value).run(); }}
          className="h-7 px-2 text-[12px] text-dim bg-surface border border-line rounded hover:border-line2 focus:outline-none cursor-pointer"
          style={{ maxWidth: 110 }}
        >
          {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <select
          value={currentSize}
          onChange={(e) => { setSelectedSize(e.target.value); editor.chain().focus().setFontSize(`${e.target.value}px`).run(); }}
          className="h-7 px-2 text-[12px] text-dim bg-surface border border-line rounded hover:border-line2 focus:outline-none cursor-pointer ml-1"
          style={{ width: 62 }}
        >
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <Sep />

        <Btn active={editor.isActive("bold")}      title="Bold (Ctrl+B)"      onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13} strokeWidth={2} /></Btn>
        <Btn active={editor.isActive("italic")}    title="Italic (Ctrl+I)"    onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13} strokeWidth={1.5} /></Btn>
        <Btn active={editor.isActive("underline")} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><UIcon size={13} strokeWidth={1.5} /></Btn>
        <Btn active={editor.isActive("strike")}    title="Strikethrough"      onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={13} strokeWidth={1.5} /></Btn>

        <Sep />

        {([1, 2, 3] as const).map((level) => (
          <Btn key={level} active={editor.isActive("heading", { level })} title={`Heading ${level}`}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}>
            <span className="text-[11px] font-bold leading-none">H{level}</span>
          </Btn>
        ))}

        <Sep />

        <Btn active={editor.isActive("bulletList")}  title="Bullet list (* space)" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13} strokeWidth={1.5} /></Btn>
        <Btn active={editor.isActive("orderedList")} title="Numbered list (1. )"   onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13} strokeWidth={1.5} /></Btn>

        <Sep />

        <Btn active={editor.isActive({ textAlign: "left" })}   title="Align left"  onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={13} strokeWidth={1.5} /></Btn>
        <Btn active={editor.isActive({ textAlign: "center" })} title="Center"      onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={13} strokeWidth={1.5} /></Btn>
        <Btn active={editor.isActive({ textAlign: "right" })}  title="Align right" onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={13} strokeWidth={1.5} /></Btn>

        <Sep />

        <Btn active={inTable} title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon size={13} strokeWidth={1.5} />
        </Btn>

        <Sep />

        <Btn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={13} strokeWidth={1.5} /></Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={13} strokeWidth={1.5} /></Btn>
      </div>

      {/* ── Table toolbar ── */}
      {inTable && (
        <div className="flex flex-wrap items-center gap-0.5 px-5 py-1.5 border-b border-line flex-shrink-0" style={{ background: "var(--c-accent-soft)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] mr-2 flex-shrink-0" style={{ color: "var(--c-accent)" }}>Table</span>

          <span className="text-[10px] text-mute uppercase tracking-wide mr-0.5">Columns</span>
          <TblBtn title="Insert column to the left"  onClick={() => editor.chain().focus().addColumnBefore().run()}><ArrowLeftToLine size={11} strokeWidth={1.5} />Before</TblBtn>
          <TblBtn title="Insert column to the right" onClick={() => editor.chain().focus().addColumnAfter().run()}>After<ArrowRightToLine size={11} strokeWidth={1.5} /></TblBtn>
          <TblBtn title="Delete this column" onClick={() => editor.chain().focus().deleteColumn().run()} danger><Columns2 size={11} strokeWidth={1.5} />Del</TblBtn>

          <TblSep />

          <span className="text-[10px] text-mute uppercase tracking-wide mr-0.5">Rows</span>
          <TblBtn title="Insert row above" onClick={() => editor.chain().focus().addRowBefore().run()}><ArrowUpToLine size={11} strokeWidth={1.5} />Before</TblBtn>
          <TblBtn title="Insert row below" onClick={() => editor.chain().focus().addRowAfter().run()}>After<ArrowDownToLine size={11} strokeWidth={1.5} /></TblBtn>
          <TblBtn title="Delete this row" onClick={() => editor.chain().focus().deleteRow().run()} danger><Rows2 size={11} strokeWidth={1.5} />Del</TblBtn>

          <TblSep />

          <span className="text-[10px] text-mute uppercase tracking-wide mr-0.5">Cells</span>
          <TblBtn title="Merge selected cells" onClick={() => editor.chain().focus().mergeCells().run()} disabled={!canMerge}>Merge</TblBtn>
          <TblBtn title="Split merged cell"    onClick={() => editor.chain().focus().splitCell().run()} disabled={!canSplit}>Split</TblBtn>

          <TblSep />

          <TblBtn title="Toggle header row"    active={editor.isActive("tableHeader")} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Hdr Row</TblBtn>
          <TblBtn title="Toggle header column" onClick={() => editor.chain().focus().toggleHeaderColumn().run()}>Hdr Col</TblBtn>

          <TblSep />

          <TblBtn title="Delete the entire table" onClick={() => editor.chain().focus().deleteTable().run()} danger>
            <Trash2 size={11} strokeWidth={1.5} />Delete table
          </TblBtn>
        </div>
      )}

      {/* ── Editor area ── */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="px-12 py-8" style={{ maxWidth: 760 }}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
