// Sightengine wrapper (SERVER ONLY — reads SIGHTENGINE_SECRET).
//
// One call to /1.0/check.json combines three models (BLUEPRINT §3.1):
//   genai            — is the image AI-generated
//   face-attributes  — faces + attributes
//   deepfake         — digital face-swap / manipulation (NOT physical PAD)
//
// Until credentials are configured the wrapper returns a clearly-labelled mock
// (mock: true) so the whole app compiles and runs without keys.

import type { FaceResult, GenaiResult } from "./types";

const SIGHTENGINE_ENDPOINT = "https://api.sightengine.com/1.0/check.json";

export interface SightengineResult {
  genai: GenaiResult;
  face: FaceResult;
  /** Raw API JSON, kept for debugging / future fields. */
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
    // TODO: remove the mock branch once SIGHTENGINE_USER / SIGHTENGINE_SECRET
    // are set in .env.local.
    return mockSightengineResult();
  }

  // TODO: confirm the exact response field paths against the Sightengine docs
  // for each model — https://sightengine.com/docs/  (genai / face-attributes /
  // deepfake). The normalizer below is a best-effort first pass.
  const form = new FormData();
  form.append("media", new Blob([bytes as BlobPart], { type: mimeType }), "upload");
  form.append("models", "genai,face-attributes,deepfake");
  form.append("api_user", apiUser);
  form.append("api_secret", apiSecret);

  const res = await fetch(SIGHTENGINE_ENDPOINT, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(
      `Sightengine request failed: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as SightengineApiResponse;
  if (data.status === "failure") {
    throw new Error(
      `Sightengine error: ${data.error?.message ?? "unknown error"}`,
    );
  }
  return normalize(data);
}

// --- Internal --------------------------------------------------------------

interface SightengineApiResponse {
  status: "success" | "failure";
  error?: { message?: string };
  // genai model
  type?: { ai_generated?: number };
  // face-attributes + deepfake models
  faces?: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    attributes?: Record<string, number>;
  }>;
}

function normalize(data: SightengineApiResponse): SightengineResult {
  const faces = (data.faces ?? []).map((f) => {
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
        typeof data.type?.ai_generated === "number"
          ? data.type.ai_generated
          : null,
      mock: false,
    },
    face: {
      faces,
      deepfake_score: deepfakeScores.length ? Math.max(...deepfakeScores) : null,
      mock: false,
    },
    raw: data,
    mock: false,
  };
}

function mockSightengineResult(): SightengineResult {
  return {
    genai: { ai_generated: null, mock: true },
    face: { faces: [], deepfake_score: null, mock: true },
    raw: null,
    mock: true,
  };
}
