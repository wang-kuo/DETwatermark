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

export interface DetectionResponse {
  cached: boolean;
  image_hash: string;
  genai_result: GenaiResult;
  face_result: FaceResult;
  watermark_result: WatermarkResult;
}
