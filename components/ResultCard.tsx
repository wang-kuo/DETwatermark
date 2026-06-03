"use client";

import { useEffect, useRef } from "react";
import type {
  AttackType,
  DetectedFace,
  DetectionResponse,
  FaceAttributes,
  FaceBox,
  FaceResult,
  Spectrum,
  WatermarkResult,
} from "@/lib/types";

export default function ResultCard({
  result,
  imageUrl,
}: {
  result: DetectionResponse;
  imageUrl?: string | null;
}) {
  const { genai_result, face_result, watermark_result, cached } = result;
  const aiGen = genai_result?.ai_generated ?? null;

  return (
    <section className="space-y-4">
      {cached && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
          Cached result — no API spend (this exact image was analyzed before).
        </div>
      )}

      {/* HERO VERDICTS */}
      <div className="grid gap-4 sm:grid-cols-2">
        <WatermarkHero w={watermark_result} />
        <FaceHero f={face_result} />
      </div>

      {/* STAT STRIP */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="AI-Generated"
          value={pct(aiGen)}
          tone={aiGen !== null && aiGen >= 0.5 ? "danger" : "ok"}
          mock={genai_result?.mock ?? false}
        />
        <Stat label="Faces" value={String(face_result.face_count)} />
        <Stat label="Spectrum" value={spectrumLabel(face_result.spectrum)} />
        <Stat label="Deepfake" value={deepfakeLabel(face_result)} />
      </div>

      <Details w={watermark_result} f={face_result} imageUrl={imageUrl} />
    </section>
  );
}

// --- Hero cards ------------------------------------------------------------

function WatermarkHero({ w }: { w: WatermarkResult }) {
  const detected = w.has_watermark;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 ${
        detected
          ? "border-amber-400/40 bg-amber-400/[0.06] shadow-[0_0_55px_-22px_rgba(251,191,36,0.7)]"
          : "border-emerald-400/30 bg-emerald-400/[0.05]"
      }`}
    >
      <Label>Watermark</Label>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`text-2xl font-bold tracking-tight ${
            detected ? "text-amber-200" : "text-emerald-200"
          }`}
        >
          {detected ? "DETECTED" : "NONE"}
        </span>
        {w.mock && <MockTag />}
      </div>

      {detected ? (
        <>
          <div className="mt-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-white/40">
              Source
            </div>
            <div className="mt-1 inline-flex items-center rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-sm font-semibold text-accent shadow-[0_0_20px_-6px_var(--accent)]">
              {w.vendor ?? "Unknown"}
            </div>
          </div>
          <div className="mt-3 text-xs text-white/55">
            Type: {w.type}
            {w.location !== "none" ? ` · ${w.location}` : ""}
          </div>
          <ConfBar label="Confidence" value={w.confidence} tone="amber" />
        </>
      ) : (
        <p className="mt-3 text-xs text-white/45">
          No visible watermark, logo, or platform badge found.
        </p>
      )}
    </div>
  );
}

function FaceHero({ f }: { f: FaceResult }) {
  if (!f.face_present) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <Label>Face Authenticity</Label>
        <div className="mt-2 text-2xl font-bold tracking-tight text-white/55">
          NO FACE
        </div>
        <p className="mt-3 text-xs text-white/45">
          No face detected in this image.
        </p>
      </div>
    );
  }

  const real = f.is_real_face;
  const reason = f.ai_generated_override
    ? "AI-generated image → synthetic face"
    : f.is_attack
      ? `${attackLabel(f.attack_type)} attack`
      : "Genuine live capture";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 ${
        real
          ? "border-emerald-400/40 bg-emerald-400/[0.06] shadow-[0_0_55px_-22px_rgba(52,211,153,0.7)]"
          : "border-red-500/40 bg-red-500/[0.07] shadow-[0_0_55px_-22px_rgba(239,68,68,0.7)]"
      }`}
    >
      <Label>Face Authenticity</Label>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`text-2xl font-bold tracking-tight ${
            real ? "text-emerald-200" : "text-red-300"
          }`}
        >
          {real ? "REAL FACE" : "FAKE FACE"}
        </span>
        {f.mock && <MockTag />}
      </div>
      <p
        className={`mt-2 text-xs ${real ? "text-emerald-200/70" : "text-red-200/80"}`}
      >
        {reason}
      </p>
      <ConfBar
        label="Verdict confidence"
        value={f.real_face_confidence}
        tone={real ? "emerald" : "red"}
      />
    </div>
  );
}

// --- Details ---------------------------------------------------------------

function Details({
  w,
  f,
  imageUrl,
}: {
  w: WatermarkResult;
  f: FaceResult;
  imageUrl?: string | null;
}) {
  const showVendorVotes = w.has_watermark && (w.vendor_votes ?? []).length > 0;
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      {f.attributes && !f.ai_generated_override && (
        <FaceAttributesPanel a={f.attributes} />
      )}

      <DetectedFaces faces={f.faces ?? []} imageUrl={imageUrl} />

      {showVendorVotes && (
        <Block title="Watermark vendor — model votes">
          <ul className="space-y-1.5">
            {(w.vendor_votes ?? []).map((v, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="font-mono text-white/45">{v.model}</span>
                <span className="flex-1 text-right text-white/70">
                  <span className="font-semibold text-accent">{v.vendor ?? "—"}</span>
                  {v.reasoning ? (
                    <span className="block text-white/40">{v.reasoning}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {f.face_present && (f.attack_votes ?? []).length > 0 && (
        <Block title="Attack detection — source votes">
          <ul className="space-y-1.5">
            {(f.attack_votes ?? []).map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-white/45">{v.source}</span>
                <span className={v.is_attack ? "text-red-300" : "text-emerald-300"}>
                  {v.is_attack ? attackLabel(v.attack_type) : "clean"}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <DeepSeekJudge f={f} />
    </div>
  );
}

function FaceAttributesPanel({ a }: { a: FaceAttributes }) {
  const items: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (a.age_range) items.push({ icon: <IconAge />, label: "Age", value: a.age_range });
  if (a.gender) items.push({ icon: <IconGender />, label: "Gender", value: cap(a.gender) });
  if (a.expression)
    items.push({ icon: <IconExpression />, label: "Expression", value: cap(a.expression) });
  if (a.glasses !== null)
    items.push({ icon: <IconGlasses />, label: "Glasses", value: a.glasses ? "Yes" : "No" });
  if (a.headwear !== null)
    items.push({ icon: <IconHeadwear />, label: "Headwear", value: a.headwear ? "Yes" : "No" });
  if (a.facial_hair !== null)
    items.push({ icon: <IconBeard />, label: "Facial hair", value: a.facial_hair ? "Yes" : "No" });

  if (items.length === 0) return null;
  return (
    <Block title="Face attributes">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <span className="text-accent">{it.icon}</span>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">
                {it.label}
              </div>
              <div className="truncate text-xs font-medium text-white/85">{it.value}</div>
            </div>
          </div>
        ))}
      </div>
    </Block>
  );
}

function DetectedFaces({
  faces,
  imageUrl,
}: {
  faces: DetectedFace[];
  imageUrl?: string | null;
}) {
  if (!faces.length) return null;
  return (
    <Block title={`Detected faces · ${faces.length}`}>
      <div className="flex flex-wrap gap-3">
        {faces.map((face, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-white/15 bg-black/40 shadow-[0_0_24px_-12px_var(--accent)]">
              {imageUrl ? (
                <FaceThumb imageUrl={imageUrl} box={face.box} />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-white/25">
                  <IconFace />
                </span>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white/70">
                #{i + 1}
              </span>
            </div>
            {face.deepfake !== null && (
              <span
                className={`font-mono text-[10px] ${
                  face.deepfake >= 0.5 ? "text-red-300" : "text-emerald-300"
                }`}
              >
                deepfake {Math.round(face.deepfake * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </Block>
  );
}

/** Canvas-crops a face box out of the uploaded image into a square thumbnail. */
function FaceThumb({ imageUrl, box }: { imageUrl: string; box: FaceBox }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new window.Image();
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      // Sightengine boxes are usually fractions (0..1); fall back to pixels.
      const frac = Math.max(box.x1, box.y1, box.x2, box.y2) <= 1.5;
      const x1 = frac ? box.x1 * W : box.x1;
      const y1 = frac ? box.y1 * H : box.y1;
      const x2 = frac ? box.x2 * W : box.x2;
      const y2 = frac ? box.y2 * H : box.y2;
      const bw = Math.max(1, x2 - x1);
      const bh = Math.max(1, y2 - y1);
      // square crop centered on the box, padded a little
      const side = Math.min(Math.max(bw, bh) * 1.35, W, H);
      const cx = x1 + bw / 2;
      const cy = y1 + bh / 2;
      const sx = Math.max(0, Math.min(W - side, cx - side / 2));
      const sy = Math.max(0, Math.min(H - side, cy - side / 2));
      const out = 192;
      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    };
    img.src = imageUrl;
  }, [imageUrl, box]);
  return <canvas ref={ref} className="h-full w-full object-cover" />;
}

function DeepSeekJudge({ f }: { f: FaceResult }) {
  const title = `DeepSeek judge${f.judge_model ? ` · ${f.judge_model}` : ""}`;
  return (
    <Block title={title}>
      {f.judge_used ? (
        <p className="text-xs text-white/60">
          {f.reasoning || "DeepSeek aggregated the model votes."}
        </p>
      ) : f.judge_model ? (
        <p className="text-xs text-amber-300/80">
          {f.judge_error
            ? `DeepSeek unavailable: ${f.judge_error}`
            : "DeepSeek not used — deterministic aggregation applied."}
        </p>
      ) : (
        <p className="text-xs text-white/40">
          DeepSeek not configured (set DEEPSEEK_API_KEY).
        </p>
      )}
    </Block>
  );
}

// --- Primitives ------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
      {children}
    </div>
  );
}

function MockTag() {
  return (
    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-normal text-white/50">
      mock
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  mock = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
  mock?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-300"
      : tone === "ok"
        ? "text-emerald-200"
        : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-white/35">
        {label}
        {mock && <span className="text-white/25">·mock</span>}
      </div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function ConfBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "emerald" | "red" | "cyan";
}) {
  const fill =
    tone === "amber"
      ? "bg-amber-300"
      : tone === "emerald"
        ? "bg-emerald-400"
        : tone === "red"
          ? "bg-red-400"
          : "bg-accent";
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/35">
        <span>{label}</span>
        <span>{pct(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.round(clamp01(value) * 100)}%` }}
        />
      </div>
    </div>
  );
}

// --- Icons (simple stroke SVGs) --------------------------------------------

const sIcon = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconAge() {
  return (
    <svg {...sIcon}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconGender() {
  return (
    <svg {...sIcon}>
      <circle cx="10" cy="14" r="5" />
      <path d="M14.5 9.5 20 4m0 0h-4.5M20 4v4.5" />
    </svg>
  );
}
function IconExpression() {
  return (
    <svg {...sIcon}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.4 2 4 2 4-2 4-2" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}
function IconGlasses() {
  return (
    <svg {...sIcon}>
      <circle cx="6" cy="14" r="3" />
      <circle cx="18" cy="14" r="3" />
      <path d="M9 13c1-1.5 5-1.5 6 0M3 12l2-2m16 2-2-2" />
    </svg>
  );
}
function IconHeadwear() {
  return (
    <svg {...sIcon}>
      <path d="M3 18h18" />
      <path d="M5.5 18c0-4.5 2.5-8 6.5-8s6.5 3.5 6.5 8" />
      <path d="M9 10c0-2 1-3.5 3-3.5s3 1.5 3 3.5" />
    </svg>
  );
}
function IconBeard() {
  return (
    <svg {...sIcon}>
      <path d="M6 6c0 7 2 12 6 12s6-5 6-12" />
      <path d="M6 7c2.5 1.2 9.5 1.2 12 0" />
      <path d="M10 14c.7.6 1.3.6 2 0" />
    </svg>
  );
}
function IconFace() {
  return (
    <svg {...sIcon} width={22} height={22}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h.01M15.5 10h.01M9 15s1 1.4 3 1.4 3-1.4 3-1.4" />
    </svg>
  );
}

// --- Formatters ------------------------------------------------------------

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${Math.round(clamp01(n) * 100)}%`;
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function spectrumLabel(s: Spectrum): string {
  return s === "visible" ? "Visible" : s === "nir" ? "Near-IR" : "—";
}

function deepfakeLabel(f: FaceResult): string {
  const sight = (f.attack_votes ?? []).find((v) => v.source === "sightengine");
  const m = sight?.reasoning.match(/([0-9]*\.?[0-9]+)/);
  if (m) return `${Math.round(parseFloat(m[1]) * 100)}%`;
  return "—";
}

function attackLabel(t: AttackType): string {
  switch (t) {
    case "paper":
      return "Paper";
    case "replay":
      return "Replay";
    case "3d_mask":
      return "3D Mask";
    case "none":
      return "None";
    default:
      return "Unknown";
  }
}
