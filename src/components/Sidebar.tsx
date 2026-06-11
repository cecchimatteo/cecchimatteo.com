"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Clock, BookOpen, Bookmark, FileText, TrendingUp, Home, Newspaper,
  ChevronRight, LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const NAV_ITEMS = [
  { href: "/home",    label: "Home",         Icon: Home },
  { href: "/feed",    label: "Feed",         Icon: Newspaper },
  { href: "/diary",   label: "Hourly Diary", Icon: Clock },
  { href: "/vocab",   label: "Vocabulary",   Icon: BookOpen },
  { href: "/reading", label: "Reading Log",  Icon: Bookmark },
  { href: "/notes",   label: "Notes",        Icon: FileText },
  { href: "/markets", label: "Markets",      Icon: TrendingUp },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
  }

  const initial = (user?.user_metadata?.full_name as string | undefined)?.[0]?.toUpperCase()
    ?? user?.email?.[0]?.toUpperCase()
    ?? "?";
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "—";
  const subline = user?.user_metadata?.full_name ? user?.email : "Signed in";

  return (
    <aside
      className="bg-bg border-r border-line flex flex-col flex-shrink-0"
      style={{ width: 240 }}
    >
      {/* Logo */}
      <div className="px-6 pt-7 pb-9">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-[9px] flex items-center justify-center bg-accent"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="w-2.5 h-2.5 rounded-[3px] bg-white/90" />
          </div>
          <div
            className="text-[16px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Daybook
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={[
                    "group w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg relative",
                    "text-[13.5px]",
                    active
                      ? "text-ink bg-surface"
                      : "text-dim hover:text-ink hover:bg-surface/60",
                  ].join(" ")}
                  style={active ? { boxShadow: "var(--shadow-card)" } : undefined}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />
                  )}
                  <span className={active ? "text-accent" : "text-mute group-hover:text-dim"}>
                    <Icon size={16} strokeWidth={1.6} />
                  </span>
                  <span className="font-medium tracking-[-0.01em] whitespace-nowrap">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Today stats card */}
        <div
          className="mt-9 mb-2.5 px-4 text-[10px] uppercase tracking-[0.12em] text-mute font-semibold"
        >
          Today
        </div>
        <div
          className="mx-2 rounded-xl bg-surface border border-line px-3.5 py-3 space-y-2.5 text-[12px]"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <StatRow label="Diary entries" value="—" />
          <div className="h-px bg-line" />
          <StatRow label="Words learned" value="—" accent />
          <div className="h-px bg-line" />
          <StatRow label="Reading"       value="—" />
        </div>
      </nav>

      {/* User card */}
      <div className="px-3 pb-4 pt-3 border-t border-line">
        <button
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={signOut}
          title="Sign out"
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface/60"
        >
          <div
            className="w-7 h-7 rounded-full flex-shrink-0 text-[11px] font-semibold flex items-center justify-center bg-accent-soft text-accent"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {initial}
          </div>
          <div className="min-w-0 text-left flex-1">
            <div className="text-[12.5px] font-medium leading-tight truncate">{displayName}</div>
            <div className="text-[11px] text-mute leading-tight truncate">{subline}</div>
          </div>
          {hovered ? (
            <LogOut size={14} strokeWidth={1.6} className="text-mute" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.6} className="text-mute" />
          )}
        </button>
      </div>
    </aside>
  );
}

function StatRow({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mute">{label}</span>
      <span
        className={`font-medium tabular-nums ${accent ? "text-accent" : "text-dim"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </span>
    </div>
  );
}
