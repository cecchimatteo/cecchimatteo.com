"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clock, BookOpen, Bookmark, FileText, TrendingUp, Home, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

const NAV_ITEMS = [
  { href: "/feed",    label: "Feed",         Icon: Home },
  { href: "/diary",   label: "Hourly Diary", Icon: Clock },
  { href: "/vocab",   label: "Vocabulary",   Icon: BookOpen },
  { href: "/reading", label: "Reading Log",  Icon: Bookmark },
  { href: "/notes",   label: "Notes",        Icon: FileText },
  { href: "/markets", label: "Markets",      Icon: TrendingUp },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

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

  const initials = user?.email?.[0]?.toUpperCase() ?? "?";
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? "—";

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r border-line bg-bg"
      style={{ width: 240 }}
    >
      {/* Logo */}
      <div className="px-6 pt-6 pb-8">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md border border-line2 bg-surface2 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-[1px] bg-accent" />
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Daybook</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={[
                    "group w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-md",
                    "text-[13.5px] font-medium relative",
                    active ? "text-ink bg-surface" : "text-dim hover:text-ink hover:bg-surface/60",
                  ].join(" ")}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
                  )}
                  <Icon size={16} strokeWidth={1.5} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 mb-2 px-4 text-[10px] uppercase tracking-[0.08em] text-mute font-medium">Today</p>
        <div className="px-4 space-y-2 text-[12px]">
          {[["Diary entries", "—"], ["Words learned", "—"], ["Reading", "—"]].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-mute">{label}</span>
              <span className="text-dim tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </nav>

      {/* User card */}
      <div className="px-3 pb-4 pt-3 border-t border-line">
        <div className="flex items-center gap-3 px-2 py-2 rounded-md">
          <div className="w-7 h-7 rounded-full bg-surface2 border border-line flex items-center justify-center text-[11px] font-semibold text-dim flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0 text-left flex-1">
            <p className="text-[12.5px] font-medium leading-tight truncate">{displayName}</p>
            {user?.user_metadata?.full_name && (
              <p className="text-[11px] text-mute leading-tight truncate">{user.email}</p>
            )}
          </div>
          <button onClick={signOut} title="Sign out" className="text-mute hover:text-ink p-1 rounded flex-shrink-0">
            <LogOut size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
