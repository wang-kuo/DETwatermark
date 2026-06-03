// Shared result types across API routes, lib analysis, and UI.

export interface GenaiResult {
  /** Probability (0–1) the image is AI-generated, or null if unknown. */
  ai_generated: number | null;
  mock: boolean;
}

export interface FaceBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedFace {
  box: FaceBox;
  /** Raw Sightengine face attributes. */
  attributes: Record<string, unknown>;
  /** Deepfake / face-manipulation probability (0–1) for this face, if available. */
  deepfake: number | null;
}

// --- Watermark -------------------------------------------------------------

// Presence-only: whether a VISIBLE watermark/logo/badge is present. Vendor
// attribution was removed — LLMs can't reliably tell which company a watermark
// belongs to, and can't see invisible watermarks (e.g. SynthID) at all.
export interface WatermarkResult {
  has_watermark: boolean;
  type: "visible" | "invisible" | "none";
  location: string;
  confidence: number;
  notes: string;
  mock: boolean;
}

// --- Face / liveness -------------------------------------------------------

export type AttackType = "paper" | "replay" | "3d_mask" | "none" | "unknown";
export type Spectrum = "visible" | "nir" | "unknown";

/** One source's vote on whether the face is a presentation attack. */
export interface AttackVote {
  source: string; // "gpt-4o" | "gemini-2.5-flash" | "sightengine"
  is_attack: boolean;
  attack_type: AttackType;
  reasoning: string;
}

/** Structured face attributes (shown when the image is not AI-generated). */
export interface FaceAttributes {
  age_range: string | null;
  gender: string | null;
  expression: string | null;
  glasses: boolean | null;
  headwear: boolean | null;
  facial_hair: boolean | null;
}

export interface FaceResult {
  face_present: boolean;
  face_count: number;
  /** Face boxes + per-face attributes/deepfake from Sightengine. */
  faces: DetectedFace[];
  /** Visible-light vs near-infrared capture. */
  spectrum: Spectrum;
  /** Structured attributes, or null (e.g. when the image is AI-generated). */
  attributes: FaceAttributes | null;
  is_attack: boolean;
  attack_type: AttackType;
  /** Votes from every source that contributed to the attack decision. */
  attack_votes: AttackVote[];
  /** FINAL verdict: is this a genuine, live human face? */
  is_real_face: boolean;
  real_face_confidence: number;
  /** True when the verdict was forced to fake because the image is AI-generated. */
  ai_generated_override: boolean;
  reasoning: string;
  /** DeepSeek judge transparency. */
  judge_model: string | null;
  judge_used: boolean;
  judge_error: string | null;
  mock: boolean;
}

// --- Provenance (local, no-API: C2PA byte-sniff + EXIF/XMP/IPTC + AI markers).
// Ported from MIT github.com/863401402/image-provenance. Reads what a file
// *declares* — not a real invisible-watermark/SynthID decoder, and strippable.

export type ProvenanceConfidence = "strong" | "medium" | "weak" | "info";

export interface ProvenanceMarker {
  id: string;
  title: string;
  category: "c2pa" | "metadata" | "ai" | "edit";
  hit: boolean;
  confidence: ProvenanceConfidence | null;
  detail: string;
}

export interface ProvenanceResult {
  /** False if the read failed. */
  available: boolean;
  c2pa_present: boolean;
  /** C2PA DigitalSourceType is an AI/algorithmic type. */
  c2pa_ai_declared: boolean;
  digital_source_type: string | null;
  metadata_ai_hit: boolean;
  ai_markers: string[];
  markers: ProvenanceMarker[];
  generation_hints: { label: string; value: string }[];
  verdict: "ai-declared" | "ai-signals" | "edited" | "clean" | "no-metadata";
  note: string;
}

export interface DetectionResponse {
  cached: boolean;
  image_hash: string;
  genai_result: GenaiResult;
  face_result: FaceResult;
  watermark_result: WatermarkResult;
  /** Local metadata/C2PA provenance — recomputed each request, not persisted. */
  provenance: ProvenanceResult;
}
