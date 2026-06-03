// POST /api/detect  (BLUEPRINT §6)
//   in : multipart/form-data { file: image, hash: sha256-from-client }
//   out: DetectionResponse
//
// Flow: auth → re-hash → dedup by hash → upload → parallel detect → insert.

import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { sha256 } from "@/lib/hash";
import { runSightengine } from "@/lib/sightengine";
import { detectWatermark } from "@/lib/watermark";
import type { DetectionResponse } from "@/lib/types";

export const runtime = "nodejs";

const STORAGE_BUCKET = "uploads";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase 未配置" }, { status: 500 });
  }

  // 1. Auth — require a valid session (anonymous or otherwise).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "未登录,请先用邀请码登录" },
      { status: 401 },
    );
  }

  // Parse the multipart body.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "请求必须是 multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const clientHash = form.get("hash");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少图片文件" }, { status: 400 });
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
      { error: "哈希校验失败,文件可能在传输中被篡改" },
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
    const cached: DetectionResponse = {
      cached: true,
      image_hash: existing.image_hash,
      genai_result: existing.genai_result,
      face_result: existing.face_result,
      watermark_result: existing.watermark_result,
    };
    return NextResponse.json(cached);
  }

  // 4. Upload to the private Storage bucket.
  const storagePath = `${user.id}/${serverHash}${extFromMime(file.type)}`;
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json(
      {
        error: `上传失败: ${uploadErr.message}(请确认已创建名为 "${STORAGE_BUCKET}" 的私有 Storage bucket)`,
      },
      { status: 500 },
    );
  }

  // 5. Run the detectors in parallel (BLUEPRINT §6.5).
  const [sight, watermark] = await Promise.all([
    runSightengine(bytes, file.type),
    detectWatermark(bytes, file.type),
  ]);

  // 6. Persist the detection. image_hash is UNIQUE; a concurrent duplicate
  //    insert will fail here, which is acceptable for the demo.
  const { error: insertErr } = await admin.from("detections").insert({
    user_id: user.id,
    image_hash: serverHash,
    storage_path: storagePath,
    mime_type: file.type,
    genai_result: sight.genai,
    face_result: sight.face,
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
    face_result: sight.face,
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
