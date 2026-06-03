// Local, no-API provenance / Content-Credentials check.
//
// Isomorphic: pure JS + exifr (no Node-only APIs, no eval), so it runs on the
// server AND in the browser. The client reads the ORIGINAL file with it (before
// downscaling strips metadata); the server falls back to it for the received bytes.
//
// Ported from the MIT-licensed open-source project "image-provenance":
//   https://github.com/863401402/image-provenance  (MIT, Copyright (c) 2026)
// We adapt only its read-only provenance detectors — the JUMBF/C2PA byte
// sniffer, EXIF/XMP/IPTC parsing (exifr), and the curated AI-tool keyword
// markers — and deliberately leave out its byte-stat "invisible watermark"
// heuristic, the Canvas/FFT visualization, and the offensive disruption tool.
//
// IMPORTANT: this reads what a file *declares*. It is NOT a real watermark
// decoder — it cannot see Google SynthID or other invisible watermarks, the
// C2PA check is presence-only (not cryptographic verification), and metadata is
// trivially stripped (screenshots / re-saves / social uploads remove it). Treat
// results as weak provenance signals, not ground truth.

import exifr from "exifr";
import type { ProvenanceMarker, ProvenanceResult } from "./types";

// --- Marker signatures (ported verbatim; titles localized to English) -------

interface MarkerDef {
  id: string;
  title: string;
  category: "ai" | "edit";
  keywords: string[];
  hitThreshold?: number;
}

const C2PA_KEYWORDS = [
  "C2PA", "JUMBF", "caBX", "c2pa.manifest", "contentcredentials",
  "urn:uuid:", "jumbf", "activeManifest", "claim.v2", "c2pa_rs", "c2pa.hash",
];

const MARKERS: MarkerDef[] = [
  {
    id: "openai",
    title: "OpenAI / DALL·E / GPT",
    category: "ai",
    keywords: ["OpenAI", "openai", "DALL-E", "dall-e", "DALLE", "dalle", "gpt-image", "GPT-image", "chatgpt", "ChatGPT", "openai.com"],
  },
  {
    id: "google",
    title: "Google / SynthID / Gemini",
    category: "ai",
    keywords: ["Google", "SynthID", "Gemini", "Imagen", "Nano Banana", "nanobanana", "DeepMind", "google.com", "gemini"],
  },
  {
    id: "midjourney",
    title: "Midjourney",
    category: "ai",
    keywords: ["Midjourney", "midjourney", "MIDJOURNEY", "mj-api", "midj"],
  },
  {
    id: "sd",
    title: "Stable Diffusion / ComfyUI / Flux",
    category: "ai",
    keywords: ["StableDiffusion", "stable-diffusion", "ComfyUI", "comfyui", "Flux", "FLUX", "Automatic1111", "A1111", "InvokeAI", "Fooocus", "stable_diffusion", "diffusion_model"],
  },
  {
    id: "adobe",
    title: "Adobe Firefly (AI)",
    category: "ai",
    // Only Firefly-specific markers — plain "Adobe"/"Photoshop" appears in
    // normal edits and even ICC color profiles, so it must NOT count as AI.
    keywords: ["Firefly", "adobe_firefly", "AdobeFirefly", "adobefirefly"],
  },
  {
    id: "photoshop",
    title: "Photoshop / editor (non-AI)",
    category: "edit",
    hitThreshold: 1,
    keywords: ["Adobe Photoshop", "photoshop:", "Photoshop CC", "Photoshop CS", "Adobe ImageReady", "Lightroom Classic", "Adobe Lightroom"],
  },
  {
    id: "pngtext",
    title: "PNG text chunk / generation params",
    category: "ai",
    hitThreshold: 2,
    keywords: ["tEXt", "iTXt", "zTXt", "parameters", "prompt", "negative_prompt", "Steps:", "Sampler:", "CFG scale", "Seed:", "workflow"],
  },
];

// --- JUMBF / C2PA sniffer (ported) -----------------------------------------

const JMAGIC = [0x6a, 0x75, 0x6d, 0x62]; // "jumb"
const C2PA_LABELS = ["c2pa", "c2pa.claim", "c2pa.assertions", "c2pa.signature", "c2pa.hash"];
const AI_SOURCE_TYPES = [
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "algorithmicMedia",
  "dataDrivenMedia",
];
const NON_AI_SOURCE_TYPES = ["digitalCapture", "digitalCreation", "composite"];

interface JumbfResult {
  present: boolean;
  digitalSourceType: string | null;
  labels: string[];
  indices: number[];
}

function sniffJumbf(uint8: Uint8Array): JumbfResult {
  const out: JumbfResult = { present: false, digitalSourceType: null, labels: [], indices: [] };
  for (let i = 4; i < uint8.length - 4; i++) {
    if (
      uint8[i] === JMAGIC[0] && uint8[i + 1] === JMAGIC[1] &&
      uint8[i + 2] === JMAGIC[2] && uint8[i + 3] === JMAGIC[3]
    ) {
      out.present = true;
      out.indices.push(i);
      if (out.indices.length >= 16) break;
    }
  }
  if (!out.present) return out;

  const s = Math.max(0, out.indices[0] - 32);
  const e = Math.min(uint8.length, out.indices[out.indices.length - 1] + 65536);
  let txt = "";
  for (let i = s; i < e; i += 65536) {
    txt += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, Math.min(e, i + 65536))));
  }
  for (const lbl of C2PA_LABELS) if (txt.indexOf(lbl) !== -1) out.labels.push(lbl);
  for (const v of AI_SOURCE_TYPES) if (txt.indexOf(v) !== -1) { out.digitalSourceType = v; break; }
  if (!out.digitalSourceType) {
    for (const v of NON_AI_SOURCE_TYPES) if (txt.indexOf(v) !== -1) { out.digitalSourceType = v; break; }
  }
  return out;
}

// --- Metadata (exifr) + keyword search (ported) ----------------------------

function bytesToString(uint8: Uint8Array): string {
  let str = "";
  for (let i = 0; i < uint8.length; i += 65536) {
    str += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + 65536)));
  }
  return str;
}

async function parseMetadata(uint8: Uint8Array): Promise<Record<string, unknown>> {
  try {
    // exifr's runtime accepts boolean segment options, but its TS Options type
    // is stricter — cast to satisfy the compiler.
    const options = {
      tiff: true, exif: true, gps: true, ifd0: true, ifd1: false,
      xmp: true, iptc: true, icc: true, jfif: false,
      mergeOutput: true, reviveValues: true,
      translateKeys: true, translateValues: true,
    } as unknown as Parameters<typeof exifr.parse>[1];
    const parsed = await exifr.parse(uint8, options);
    return (parsed as Record<string, unknown>) || {};
  } catch (err) {
    return { _error: err instanceof Error ? err.message : String(err) };
  }
}

function getGenerationHints(meta: Record<string, unknown>): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const keys = [
    "Software", "XMPToolkit", "CreatorTool", "Creator", "Make", "Model",
    "Credit", "Source", "Caption", "Description", "UserComment", "ImageDescription",
    "DigitalSourceType", "digitalSourceType", "Lens", "LensModel", "DateTimeOriginal",
  ];
  for (const k of keys) {
    const val = meta[k];
    if (val == null || val === "") continue;
    let s = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (s.length > 200) s = s.slice(0, 200) + "…";
    fields.push({ label: k, value: s });
  }
  return fields;
}

function findKeywords(str: string, keywords: string[]): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const kw of keywords) {
    const lk = kw.toLowerCase();
    if (seen.has(lk)) continue;
    if (str.indexOf(kw) !== -1) {
      seen.add(lk);
      hits.push(kw);
    }
  }
  return hits;
}

const AI_META_RE = /Gemini|Imagen|SynthID|Midjourney|Stable\s*Diffusion|ComfyUI|DALL|OpenAI|Firefly|trainedAlgorithmicMedia/i;

// --- Public entry point ----------------------------------------------------

/** Read provenance signals from the ORIGINAL image bytes (local, no API). */
export async function runProvenance(uint8: Uint8Array): Promise<ProvenanceResult> {
  try {
    const str = bytesToString(uint8);
    const [meta, jumbf] = await Promise.all([
      parseMetadata(uint8),
      Promise.resolve(sniffJumbf(uint8)),
    ]);

    // C2PA
    const c2paBytes = findKeywords(str, C2PA_KEYWORDS);
    const c2paPresent = jumbf.present || c2paBytes.length > 0;
    const c2paAiDeclared =
      !!jumbf.digitalSourceType && AI_SOURCE_TYPES.includes(jumbf.digitalSourceType);

    // Structured metadata
    const hints = getGenerationHints(meta);
    const metadataAiHit = hints.some((h) => AI_META_RE.test(h.value));

    // Per-vendor keyword markers
    const markers: ProvenanceMarker[] = [];
    for (const m of MARKERS) {
      const found = findKeywords(str, m.keywords);
      const hit = found.length >= (m.hitThreshold ?? 1);
      markers.push({
        id: m.id,
        title: m.title,
        category: m.category,
        hit,
        confidence: hit ? (m.category === "edit" ? "info" : "medium") : null,
        detail: hit ? found.join(", ") : "",
      });
    }
    // C2PA marker (front of the list)
    markers.unshift({
      id: "c2pa",
      title: "C2PA / Content Credentials",
      category: "c2pa",
      hit: c2paPresent,
      confidence: c2paPresent ? (c2paAiDeclared ? "strong" : "weak") : null,
      detail: c2paPresent
        ? [
            jumbf.present ? `JUMBF boxes: ${jumbf.indices.length}` : "",
            jumbf.labels.length ? `labels: ${jumbf.labels.join(", ")}` : "",
            jumbf.digitalSourceType ? `DigitalSourceType: ${jumbf.digitalSourceType}` : "",
            !jumbf.present && c2paBytes.length ? `byte strings: ${c2paBytes.join(", ")}` : "",
          ].filter(Boolean).join("  ·  ")
        : "",
    });

    const aiMarkers = markers
      .filter((m) => m.hit && m.category === "ai")
      .map((m) => m.title);

    // Verdict
    let verdict: ProvenanceResult["verdict"];
    let note: string;
    if (c2paAiDeclared || metadataAiHit) {
      verdict = "ai-declared";
      note = c2paAiDeclared
        ? `C2PA declares AI-generated (${jumbf.digitalSourceType}).`
        : "Metadata names an AI generation tool.";
    } else if (aiMarkers.length > 0) {
      verdict = "ai-signals";
      note = `AI-tool signatures found: ${aiMarkers.join(", ")}.`;
    } else if (markers.some((m) => m.hit && m.category === "edit")) {
      verdict = "edited";
      note = "Editor metadata present (e.g. Photoshop/Lightroom); no AI markers.";
    } else if (hints.length === 0 && !c2paPresent) {
      verdict = "no-metadata";
      note = "No readable provenance metadata (none embedded, or stripped).";
    } else {
      verdict = "clean";
      note = "Metadata present, but no AI or Content-Credentials markers.";
    }

    return {
      available: true,
      c2pa_present: c2paPresent,
      c2pa_ai_declared: c2paAiDeclared,
      digital_source_type: jumbf.digitalSourceType,
      metadata_ai_hit: metadataAiHit,
      ai_markers: aiMarkers,
      markers,
      generation_hints: hints,
      verdict,
      note,
    };
  } catch {
    return {
      available: false,
      c2pa_present: false,
      c2pa_ai_declared: false,
      digital_source_type: null,
      metadata_ai_hit: false,
      ai_markers: [],
      markers: [],
      generation_hints: [],
      verdict: "no-metadata",
      note: "Provenance check failed.",
    };
  }
}
