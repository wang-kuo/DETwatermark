// POST /api/detect
//   in : multipart/form-data { file: image, hash: sha256-from-client }
//   out: DetectionResponse
//
// Flow: auth → re-hash → dedup by hash → upload → multi-model detect → persist.
//
// Detection fans out: Sightengine (genai + faces + deepfake) and the vision
// LLMs (GPT-4o + Gemini) run in parallel; DeepSeek then judges the combined
// evidence (lib/analyze.ts).

import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { runSightengineSafe } from "@/lib/sightengine";
import { aggregate, runVisionVotes } from "@/lib/analyze";
import type { DetectionResponse } from "@/lib/types";
import convert from "heic-convert";

export const runtime = "nodejs";
export const maxDuration = 60; // detection calls several external APIs

const STORAGE_BUCKET = "uploads";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  // 1. Auth.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not signed in — enter an invite code first" },
      { status: 401 },
    );
  }

  // Parse the multipart body.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const clientHash = form.get("hash");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 2. Recompute the hash server-side; reject mismatched client hashes.
  const serverHash = await sha256(bytes);
  if (
    typeof clientHash === "string" &&
    clientHash.length > 0 &&
    clientHash !== serverHash
  ) {
    return NextResponse.json(
      { error: "Hash mismatch — the file may have been altered in transit" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // 3. Dedup: same image (any user) is never re-detected — saves API spend.
  const { data: existing, error: dedupErr } = await admin
    .from("detections")
    .select("image_hash, genai_result, face_result, watermark_result")
    .eq("image_hash", serverHash)
    .maybeSingle();
  if (dedupErr) {
    return NextResponse.json({ error: dedupErr.message }, { status: 500 });
  }
  if (existing) {
    const fullShape =
      existing.genai_result &&
      existing.face_result &&
      existing.watermark_result &&
      Array.isArray(existing.face_result.faces) &&
      Array.isArray(existing.face_result.attack_votes) &&
      // new shape marker — re-detect rows written before judge/attributes fields
      existing.face_result.judge_used !== undefined;
    if (fullShape) {
      const cached: DetectionResponse = {
        cached: true,
        image_hash: existing.image_hash,
        genai_result: existing.genai_result,
        face_result: existing.face_result,
        watermark_result: existing.watermark_result,
      };
      return NextResponse.json(cached);
    }
    // Stale / partial row (e.g. manually seeded or written by an older shape):
    // drop it and re-detect so the client never receives a malformed payload.
    await admin.from("detections").delete().eq("image_hash", serverHash);
  }

  // iPhone HEIC -> JPEG on the server. Browsers can't decode HEIC without an
  // eval-based WASM lib (which a CSP may block), so we do it here. Runs AFTER
  // hashing/dedup so image_hash matches exactly what the client uploaded.
  let imgBytes: Uint8Array;
  let imgMime: string;
  try {
    ({ bytes: imgBytes, mime: imgMime } = await ensureJpeg(bytes, file.type, file.name));
  } catch {
    return NextResponse.json(
      { error: "Couldn't read this HEIC image. Try exporting it as JPEG." },
      { status: 400 },
    );
  }

  // 4. Upload to the private Storage bucket.
  const storagePath = `${user.id}/${serverHash}${extFromMime(imgMime)}`;
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imgBytes, {
      contentType: imgMime || "application/octet-stream",
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json(
      {
        error: `Upload failed: ${uploadErr.message} (make sure a private Storage bucket named "${STORAGE_BUCKET}" exists)`,
      },
      { status: 500 },
    );
  }

  // 5. Detect: Sightengine + vision-model votes in parallel, then judge.
  const [sight, votes] = await Promise.all([
    runSightengineSafe(imgBytes, imgMime),
    runVisionVotes(imgBytes, imgMime),
  ]);
  const { watermark, face } = await aggregate(votes, {
    aiGenerated: sight.genai.ai_generated,
    deepfakeScore: sight.deepfake_score,
    sightFaces: sight.faces,
  });

  // 6. Persist (image_hash is UNIQUE; a concurrent duplicate insert will fail).
  const { error: insertErr } = await admin.from("detections").insert({
    user_id: user.id,
    image_hash: serverHash,
    storage_path: storagePath,
    mime_type: file.type,
    genai_result: sight.genai,
    face_result: face,
    watermark_result: watermark,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // 7. Respond.
  const response: DetectionResponse = {
    cached: false,
    image_hash: serverHash,
    genai_result: sight.genai,
    face_result: face,
    watermark_result: watermark,
  };
  return NextResponse.json(response);
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function isHeicBytes(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (String.fromCharCode(b[4], b[5], b[6], b[7]) !== "ftyp") return false;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
  return [
    "heic", "heix", "heim", "heis",
    "hevc", "hevx", "hevm", "hevs",
    "mif1", "msf1", "heif",
  ].includes(brand);
}

/** Convert iPhone HEIC/HEIF to JPEG on the server; pass other formats through. */
async function ensureJpeg(
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const heic =
    /image\/hei[cf]/i.test(mime) ||
    /\.(heic|heif)$/i.test(name) ||
    isHeicBytes(bytes);
  if (!heic) return { bytes, mime };
  const out = await convert({
    buffer: Buffer.from(bytes),
    format: "JPEG",
    quality: 0.9,
  });
  return { bytes: new Uint8Array(out), mime: "image/jpeg" };
}
