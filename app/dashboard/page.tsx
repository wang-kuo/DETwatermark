"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import ImageUploader from "@/components/ImageUploader";

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
  }, [router]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm tracking-widest text-white/40">
          INITIALIZING…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 animate-pulse-glow rounded-full bg-accent shadow-[0_0_12px_2px_var(--accent)]" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Forensic Image Analyzer
            </h1>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
              watermark · ai-gen · face authenticity
            </p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-white/25 hover:text-white"
        >
          Sign out
        </button>
      </header>

      <div className="mt-8">
        <ImageUploader />
      </div>
    </main>
  );
}
