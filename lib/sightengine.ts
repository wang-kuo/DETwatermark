// Sightengine wrapper (SERVER ONLY — reads SIGHTENGINE_SECRET).
//
// One call to /1.0/check.json combines three models:
//   genai            — is the image AI-generated
//   face-attributes  — faces + attributes (+ bounding boxes)
//   deepfake         — digital face manipulation score
//
// Returns the numeric/structural signals the analysis layer (lib/analyze.ts)
// fuses with the vision-LLM votes. Falls back to a labelled mock without keys.

import type { DetectedFace, GenaiResult } from "./types";

const SIGHTENGINE_ENDPOINT = "https://api.sightengine.com/1.0/check.json";

export interface SightengineResult {
  genai: GenaiResult;
  faces: DetectedFace[];
  /** Highest deepfake probability across detected faces, or null. */
  deepfake_score: number | null;
  raw: unknown;
  mock: boolean;
}

export async function runSightengine(
  bytes: Uint8Array,
  mimeType: string,
): Promise<SightengineResult> {
  const apiUser = process.env.SIGHTENGINE_USER;
  const apiSecret = process.env.SIGHTENGINE_SECRET;

  if (!apiUser || !apiSecret) {
    return mockResult();
  }

  const form = new FormData();
  form.append("media", new Blob([bytes as BlobPart], { type: mimeType }), "upload");
  form.append("models", "genai,face-attributes,deepfake");
  form.append("api_user", apiUser);
  form.append("api_secret", apiSecret);

  const res = await fetch(SIGHTENGINE_ENDPOINT, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Sightengine request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as SightengineApiResponse;
  if (data.status === "failure") {
    throw new Error(`Sightengine error: ${data.error?.message ?? "unknown error"}`);
  }
  return normalize(data);
}

// --- Internal --------------------------------------------------------------

interface SightengineApiResponse {
  status: "success" | "failure";
  error?: { message?: string };
  type?: { ai_generated?: number };
  faces?: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    attributes?: Record<string, number>;
  }>;
}

function normalize(data: SightengineApiResponse): SightengineResult {
  const faces: DetectedFace[] = (data.faces ?? []).map((f) => {
    const deepfake =
      typeof f.attributes?.deepfake === "number" ? f.attributes.deepfake : null;
    return {
      box: { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 },
      attributes: f.attributes ?? {},
      deepfake,
    };
  });

  const deepfakeScores = faces
    .map((f) => f.deepfake)
    .filter((s): s is number => typeof s === "number");

  return {
    genai: {
      ai_generated:
        typeof data.type?.ai_generated === "number" ? data.type.ai_generated : null,
      mock: false,
    },
    faces,
    deepfake_score: deepfakeScores.length ? Math.max(...deepfakeScores) : null,
    raw: data,
    mock: false,
  };
}

function mockResult(): SightengineResult {
  return {
    genai: { ai_generated: null, mock: true },
    faces: [],
    deepfake_score: null,
    raw: null,
    mock: true,
  };
}
