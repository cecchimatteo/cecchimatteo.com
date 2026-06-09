"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      setDone(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      router.push("/diary");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div
        className="w-full bg-surface border border-line rounded-lg p-8"
        style={{ maxWidth: 380, boxShadow: "var(--shadow-card)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-6 h-6 rounded-md border border-line2 bg-surface2 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-[1px] bg-accent" />
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Daybook</span>
        </div>

        {done ? (
          <div className="text-center py-4">
            <p className="text-[15px] font-medium mb-2">Check your email</p>
            <p className="text-[13px] text-mute">We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then sign in.</p>
            <button onClick={() => { setDone(false); setMode("signin"); }} className="mt-6 text-[13px] text-accent hover:underline">
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-[20px] font-semibold tracking-tight mb-1">
              {mode === "signin" ? "Sign in" : "Create account"}
            </h1>
            <p className="text-[13px] text-mute mb-6">
              {mode === "signin" ? "Welcome back." : "Your personal journaling workspace."}
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Email</span>
                <input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
                />
              </label>

              {error && <p className="text-[12px] text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 bg-accent text-white text-[13px] font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-center text-[12px] text-mute">
              {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
              <button
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
                className="text-accent hover:underline"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
