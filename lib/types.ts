// Shared result types used across API routes, lib wrappers and UI components.
// Keeping them in one place guarantees the server (what gets stored in the
// `detections` jsonb columns) and the client (what `ResultCard` renders) stay
// in sync.

/** Sightengine `genai` model — likelihood the image was AI-generated. */
export interface GenaiResult {
  /** Probability (0–1) that the image is AI-generated, or null if unknown. */
  ai_generated: number | null;
  /** True when this is placeholder data (no Sightengine credentials set). */
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
  /** Raw Sightengine face attributes (gender, age, deepfake, …). */
  attributes: Record<string, unknown>;
  /** Deepfake / face-manipulation probability (0–1) for this face, if present. */
  deepfake: number | null;
}

/** Sightengine `face-attributes` + `deepfake` models, normalized. */
export interface FaceResult {
  faces: DetectedFace[];
  /** Highest deepfake probability across all detected faces, or null. */
  deepfake_score: number | null;
  mock: boolean;
}

/** Multimodal-LLM watermark VQA output (BLUEPRINT §3.3). */
export interface WatermarkResult {
  has_watermark: boolean;
  type: "visible" | "invisible" | "none";
  /** Human description of where the watermark is, or "none". */
  location: string;
  /** Model confidence 0–1. */
  confidence: number;
  notes: string;
  /** True when this is placeholder data (no LLM key set). */
  mock: boolean;
}

/** Shape returned by `POST /api/detect` and rendered by the dashboard. */
export interface DetectionResponse {
  /** True when the result came from the dedup cache (no API spend). */
  cached: boolean;
  image_hash: string;
  genai_result: GenaiResult;
  face_result: FaceResult;
  watermark_result: WatermarkResult;
}
