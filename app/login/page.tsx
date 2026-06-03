"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/verify-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-[0_0_60px_-15px_rgba(34,211,238,0.35)] backdrop-blur">
        <div className="mb-6 flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse-glow rounded-full bg-accent shadow-[0_0_12px_2px_var(--accent)]" />
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-white/50">
            Forensic Analyzer
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Access</h1>
        <p className="mt-2 text-sm text-white/50">
          Enter your invite code to continue.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="INVITE CODE"
            autoComplete="off"
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 font-mono text-sm tracking-wider outline-none transition-colors placeholder:text-white/30 focus:border-accent focus:shadow-[0_0_0_1px_var(--accent)]"
          />
          <button
            type="submit"
            disabled={loading || code.trim() === ""}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black transition-all hover:shadow-[0_0_24px_-4px_var(--accent)] disabled:opacity-40 disabled:shadow-none"
          >
            {loading ? "Verifying…" : "Enter"}
          </button>
          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
