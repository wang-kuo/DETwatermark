"use client";

import { useState } from "react";
import { sha256 } from "@/lib/hash";
import ResultCard from "./ResultCard";
import type { DetectionResponse } from "@/lib/types";

export default function ImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResponse | null>(null);

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function onDetect() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256(bytes);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("hash", hash);

      const res = await fetch("/api/detect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Detection failed");
        return;
      }
      setResult(data as DetectionResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="preview"
            className="mx-auto max-h-80 w-full object-contain"
          />
          {loading && (
            <div className="absolute inset-0 bg-black/40">
              <div className="absolute left-0 right-0 h-px animate-scan bg-accent shadow-[0_0_14px_3px_var(--accent)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full border border-accent/40 bg-black/60 px-3 py-1 font-mono text-xs tracking-widest text-accent">
                  ANALYZING…
                </span>
              </div>
            </div>
          )}
          <label className="absolute right-2 top-2 cursor-pointer rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[11px] text-white/70 backdrop-blur transition-colors hover:text-white">
            <input type="file" accept="image/*" onChange={onSelect} className="hidden" />
            Change
          </label>
        </div>
      ) : (
        <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center transition-colors hover:border-accent/50">
          <input type="file" accept="image/*" onChange={onSelect} className="hidden" />
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/50 transition-colors group-hover:border-accent/50 group-hover:text-accent">
            ▲
          </span>
          <span className="text-sm text-white/70">Drop an image or click to select</span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-white/30">
            jpg · png · webp
          </span>
        </label>
      )}

      <button
        onClick={onDetect}
        disabled={!file || loading}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black transition-all hover:shadow-[0_0_24px_-4px_var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {loading ? "Analyzing…" : "Run Analysis"}
      </button>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {result && <ResultCard result={result} imageUrl={previewUrl} />}
    </div>
  );
}
