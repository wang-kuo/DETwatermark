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
      // Compute the hash client-side (BLUEPRINT §2): the server recomputes it
      // to verify and to dedup.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256(bytes);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("hash", hash);

      const res = await fetch("/api/detect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "检测失败");
        return;
      }
      setResult(data as DetectionResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/20 p-8 text-center text-sm text-zinc-500 hover:border-black/40 dark:border-white/20 dark:hover:border-white/40">
        <input
          type="file"
          accept="image/*"
          onChange={onSelect}
          className="hidden"
        />
        {file ? <span>{file.name}</span> : <span>点击选择图片</span>}
      </label>

      {previewUrl && (
        // Blob preview — next/image is unnecessary for an object URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="预览"
          className="max-h-64 w-full rounded-xl object-contain"
        />
      )}

      <button
        onClick={onDetect}
        disabled={!file || loading}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
      >
        {loading ? "检测中…" : "开始检测"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && <ResultCard result={result} />}
    </div>
  );
}
