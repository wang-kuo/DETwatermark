"use client";

import { useState } from "react";
import { sha256 } from "@/lib/hash";
import ResultCard from "./ResultCard";
import type { DetectionResponse } from "@/lib/types";

// Keep uploads well under platform body-size limits (Vercel caps function
// request bodies at ~4.5MB) and keep the vision/Sightengine calls fast & cheap.
const MAX_DIM = 1600; // longest side, px — plenty for watermark/face/AI-gen
const TARGET_BYTES = 1_400_000; // re-encode down to roughly this size
const PASSTHROUGH_BYTES = 1_000_000; // small files upload untouched

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Prepare the picked image for upload.
 *   - HEIC: browsers can't decode it (the WASM decoders need eval, which a CSP
 *     may block), so we leave it untouched and let the SERVER convert it.
 *     `previewable: false` — there's nothing the browser can render.
 *   - Other formats: downscale large ones via canvas so the upload can't 413.
 */
async function prepare(file: File): Promise<{ file: File; previewable: boolean }> {
  if (isHeic(file)) return { file, previewable: false };
  if (file.size <= PASSTHROUGH_BYTES) return { file, previewable: true };
  try {
    return { file: await downscaleToJpeg(file), previewable: true };
  } catch {
    return { file, previewable: true }; // fall back to the original
  }
}

async function downscaleToJpeg(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.9;
    let blob = await canvasToJpeg(canvas, quality);
    while (blob && blob.size > TARGET_BYTES && quality > 0.4) {
      quality -= 0.15;
      blob = await canvasToJpeg(canvas, quality);
    }
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export default function ImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResponse | null>(null);

  async function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    if (!raw) return;

    setPreparing(true);
    try {
      const { file: f, previewable } = await prepare(raw);
      setFile(f);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return previewable ? URL.createObjectURL(f) : null;
      });
    } catch {
      setError("Couldn't read this image.");
      setFile(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setPreparing(false);
    }
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

      // Parse defensively — an error (413, gateway, etc.) may not be JSON.
      const text = await res.text();
      let data: (DetectionResponse & { error?: string }) | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        setError(
          data?.error ??
            (res.status === 413
              ? "Image is too large to upload. Try a smaller photo."
              : `Detection failed (HTTP ${res.status}).`),
        );
        return;
      }
      if (!data) {
        setError("Unexpected response from the server.");
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || preparing;
  const selectedNoPreview = !!file && !previewUrl;

  const overlay = busy && (
    <div className="absolute inset-0 bg-black/40">
      <div className="absolute left-0 right-0 h-px animate-scan bg-accent shadow-[0_0_14px_3px_var(--accent)]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full border border-accent/40 bg-black/60 px-3 py-1 font-mono text-xs tracking-widest text-accent">
          {preparing ? "PREPARING…" : "ANALYZING…"}
        </span>
      </div>
    </div>
  );

  const changeButton = (
    <label className="absolute right-2 top-2 cursor-pointer rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[11px] text-white/70 backdrop-blur transition-colors hover:text-white">
      <input type="file" accept="image/*,.heic,.heif" onChange={onSelect} className="hidden" />
      Change
    </label>
  );

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
          {overlay}
          {changeButton}
        </div>
      ) : selectedNoPreview ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-10 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-xs tracking-widest text-accent">
              HEIC
            </span>
            <span className="max-w-full truncate text-sm text-white/70">{file?.name}</span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-white/35">
              Converted on the server · no in-browser preview
            </span>
          </div>
          {overlay}
          {changeButton}
        </div>
      ) : (
        <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center transition-colors hover:border-accent/50">
          <input
            type="file"
            accept="image/*,.heic,.heif"
            onChange={onSelect}
            className="hidden"
          />
          {preparing ? (
            <>
              <span className="flex h-11 w-11 animate-pulse-glow items-center justify-center rounded-full border border-accent/50 text-accent">
                ◌
              </span>
              <span className="text-sm text-white/70">Preparing…</span>
            </>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/50 transition-colors group-hover:border-accent/50 group-hover:text-accent">
                ▲
              </span>
              <span className="text-sm text-white/70">
                Drop an image or click to select
              </span>
              <span className="font-mono text-[11px] uppercase tracking-widest text-white/30">
                jpg · png · webp · heic
              </span>
            </>
          )}
        </label>
      )}

      <button
        onClick={onDetect}
        disabled={!file || busy}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black transition-all hover:shadow-[0_0_24px_-4px_var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {preparing ? "Preparing…" : loading ? "Analyzing…" : "Run Analysis"}
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
