"use client";

import { useState, useEffect } from "react";
import { Trash2, BookOpen, Search } from "lucide-react";
import { PageHeader, Drawer, TextField, TextArea, PrimaryButton, GhostButton, Pill, EmptyState, FAB } from "@/components/ui";
import { createClient } from "@/lib/supabase";

interface VocabWord { id: string; word: string; definition: string; tags: string[]; createdAt: string; }

export default function VocabPage() {
  const [words, setWords]       = useState<VocabWord[]>([]);
  const [search, setSearch]     = useState("");
  const [drawerOpen, setDrawer] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.from("vocab_words").select("*").order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setWords(data.map((r: Record<string, unknown>) => ({
          id: r.id as string, word: r.word as string, definition: r.definition as string,
          tags: r.tags as string[], createdAt: r.created_at as string,
        })));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = words.filter((w) => {
    const q = search.toLowerCase();
    return w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q) || w.tags.some((t) => t.toLowerCase().includes(q));
  });

  async function addWord(word: string, definition: string, tags: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("vocab_words")
      .insert({ user_id: user.id, word, definition, tags })
      .select().single();
    if (data) setWords((prev) => [{ id: data.id, word: data.word, definition: data.definition, tags: data.tags, createdAt: data.created_at }, ...prev]);
  }

  async function deleteWord(id: string) {
    await supabase.from("vocab_words").delete().eq("id", id);
    setWords((prev) => prev.filter((w) => w.id !== id));
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="px-12 py-10" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <PageHeader
          title="Vocabulary"
          subtitle={`${words.length} word${words.length !== 1 ? "s" : ""} collected`}
          right={
            <div className="relative">
              <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search words…"
                className="w-64 pl-9 pr-3 py-1.5 bg-surface border border-line rounded-md text-[13.5px] text-ink placeholder:text-mute focus:outline-none focus:border-line2" />
            </div>
          }
        />

        {filtered.length === 0 && words.length > 0 ? (
          <EmptyState icon={BookOpen} line="No words match your search." />
        ) : words.length === 0 ? (
          <EmptyState icon={BookOpen} line="No words yet. Add your first one!" />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map((w) => <VocabCard key={w.id} word={w} onDelete={() => deleteWord(w.id)} />)}
          </div>
        )}
      </div>

      <FAB onClick={() => setDrawer(true)} label="Add word" />
      <AddWordDrawer open={drawerOpen} onClose={() => setDrawer(false)} onSave={addWord} />
    </div>
  );
}

function VocabCard({ word, onDelete }: { word: VocabWord; onDelete: () => void }) {
  const addedDate = new Date(word.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="group bg-surface border border-line rounded-lg p-5 flex flex-col hover:border-line2" style={{ minHeight: 180, boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-[20px] font-medium tracking-tight">{word.word}</h3>
        <button onClick={onDelete} className="text-mute hover:text-ink opacity-0 group-hover:opacity-100 p-1 -mr-1 rounded" aria-label="Delete">
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>
      <p className="text-[13.5px] italic text-dim leading-relaxed flex-1">{word.definition}</p>
      <div className="mt-3 flex items-end justify-between gap-2">
        {word.tags.length > 0
          ? <div className="flex flex-wrap gap-1">{word.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>
          : <span />}
        <span className="text-[11px] text-mute tabular-nums flex-shrink-0">{addedDate}</span>
      </div>
    </div>
  );
}

function AddWordDrawer({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (w: string, d: string, t: string[]) => void;
}) {
  const [word, setWord]       = useState("");
  const [def, setDef]         = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  function handleSave() {
    onSave(word.trim(), def.trim(), tagsRaw.split(",").map((t) => t.trim()).filter(Boolean));
    setWord(""); setDef(""); setTagsRaw(""); onClose();
  }
  function handleClose() { setWord(""); setDef(""); setTagsRaw(""); onClose(); }

  return (
    <Drawer open={open} onClose={handleClose} title="Add word">
      <div className="flex flex-col gap-5">
        <TextField label="Word" value={word} onChange={setWord} placeholder="e.g. eudaimonia" autoFocus />
        <TextArea label="Definition" value={def} onChange={setDef} placeholder="A short definition or your own gloss…" rows={4} />
        <TextField label="Tags" value={tagsRaw} onChange={setTagsRaw} placeholder="comma, separated" />
      </div>
      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-line">
        <GhostButton onClick={handleClose}>Cancel</GhostButton>
        <PrimaryButton onClick={handleSave} disabled={!word.trim()}>Save word</PrimaryButton>
      </div>
    </Drawer>
  );
}
