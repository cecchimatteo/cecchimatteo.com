"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { useRef } from "react";
import {
  Bold, Italic, Underline as UIcon, Strikethrough,
  List, ListOrdered,
} from "lucide-react";

/**
 * Compact rich-text editor — same styling family as NotesEditor but trimmed
 * to the essentials (B/I/U/S, H2/H3, bullet + numbered list). Designed for
 * embedding inside modals/forms where the full Notes toolbar is overkill.
 *
 * Stores HTML so it interoperates with the existing `note-body` CSS.
 */
interface RichEditorProps {
  value:        string;
  onChange:     (html: string) => void;
  placeholder?: string;
  minHeight?:   number;
  autoFocus?:   boolean;
}

export function RichEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  autoFocus = false,
}: RichEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class: "note-body focus:outline-none",
        style: `min-height: ${minHeight}px; font-size: 13px;`,
      },
    },
    // Keep useful node-level markdown shortcuts (typing "- " makes a bullet,
    // "1. " a numbered list, "# " a heading, etc.) but turn OFF the mark-level
    // ones (**bold**, *italic*, ~~strike~~, `code`). The mark rules were the
    // root cause of "the bold button keeps turning on while I type" — innocent
    // sequences like two asterisks were silently activating bold.
    enableInputRules: [
      "bulletList", "orderedList", "heading",
      "blockquote", "codeBlock", "horizontalRule",
    ],
    // Disable all paste rules entirely. We still get pasted HTML formatting
    // from rich sources (e.g. Word, websites) because that goes through the
    // DOM parser — paste rules only govern markdown-pattern detection inside
    // plain text, which is rarely what you want in a notes field.
    enablePasteRules: false,
    onUpdate: ({ editor: ed }) => onChangeRef.current(ed.getHTML()),
    immediatelyRender: false,
    autofocus: autoFocus,
  });

  // NOTE: we intentionally do NOT sync `value` back into the editor via an
  // effect. The editor is the source of truth while mounted — the parent
  // form just observes via onChange. A controlled-value sync caused paste
  // events to race with the resulting setSummary() and clobber the pasted
  // content. If we ever need to load existing content (e.g. an edit mode),
  // pass a fresh `key` prop so the editor remounts cleanly.

  if (!editor) {
    return (
      <div
        className="border border-line rounded-md bg-bg"
        style={{ minHeight: minHeight + 40 }}
      />
    );
  }

  return (
    <div className="border border-line rounded-md bg-bg overflow-hidden focus-within:border-line2 transition-colors">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-line bg-surface">
        <ToolBtn active={editor.isActive("bold")}      title="Bold (Ctrl+B)"      onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13} strokeWidth={2} /></ToolBtn>
        <ToolBtn active={editor.isActive("italic")}    title="Italic (Ctrl+I)"    onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13} strokeWidth={1.5} /></ToolBtn>
        <ToolBtn active={editor.isActive("underline")} title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}><UIcon size={13} strokeWidth={1.5} /></ToolBtn>
        <ToolBtn active={editor.isActive("strike")}    title="Strikethrough"      onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={13} strokeWidth={1.5} /></ToolBtn>

        <Sep />

        {([2, 3] as const).map((level) => (
          <ToolBtn
            key={level}
            active={editor.isActive("heading", { level })}
            title={`Heading ${level}`}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <span className="text-[11px] font-bold leading-none">H{level}</span>
          </ToolBtn>
        ))}

        <Sep />

        <ToolBtn active={editor.isActive("bulletList")}  title="Bullet list"   onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13} strokeWidth={1.5} /></ToolBtn>
        <ToolBtn active={editor.isActive("orderedList")} title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13} strokeWidth={1.5} /></ToolBtn>
      </div>

      {/* Editor body — click anywhere in this area focuses the editor so a
          stray click in the padding zone doesn't silently swallow keyboard
          focus (which manifested as "Ctrl+V does nothing"). */}
      <div
        className="px-3 py-2 relative cursor-text"
        onMouseDown={(e) => {
          // Only re-focus if the click landed on the wrapper itself, not on
          // a child (otherwise Tiptap's own selection logic fights us).
          if (e.target === e.currentTarget) editor.commands.focus();
        }}
      >
        <EditorContent editor={editor} />
        {placeholder && editor.isEmpty && (
          <span
            className="absolute pointer-events-none text-mute"
            style={{ top: 8, left: 12, fontSize: 13 }}
          >
            {placeholder}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Toolbar button ── */
function ToolBtn({
  active = false,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={[
        "w-7 h-7 flex items-center justify-center rounded flex-shrink-0",
        active
          ? "bg-accent text-white"
          : "text-dim hover:text-ink hover:bg-surface2",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-line2 mx-0.5 flex-shrink-0" />;
}
