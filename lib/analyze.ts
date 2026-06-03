// Multi-model image analysis (SERVER ONLY).
//
// 1. runVisionVotes(): asks every available VISION model (GPT-4o, Gemini) one
//    combined forensic question and collects each model's structured answer.
// 2. aggregate(): fuses those votes with Sightengine's numeric signals, then
//    uses DeepSeek (text-only) as a forensic JUDGE to decide the final
//    watermark vendor and real/fake-face verdict. Falls back to deterministic
//    majority voting if DeepSeek is unavailable. DeepSeek's opinion is also
//    surfaced as an explicit vote + judge block for transparency.
//
// Hard rule (enforced in code, not left to a model): if the image is
// AI-generated, any face is fake.
//
// DEEPSEEK_MODEL selects the judge model (default deepseek-chat; set to
// deepseek-reasoner for the "pro" reasoning model).

import {
  callDeepSeekText,
  callGeminiVision,
  callOpenAIVision,
  hasDeepSeek,
  parseJsonLoose,
} from "./llm";
import type {
  AttackType,
  AttackVote,
  DetectedFace,
  FaceAttributes,
  FaceResult,
  Spectrum,
  VendorVote,
  WatermarkResult,
} from "./types";

const AI_GEN_THRESHOLD = 0.5;
const DEEPFAKE_THRESHOLD = 0.5;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const VISION_PROMPT = `You are a forensic image analyst. Inspect the image and reply with ONLY a JSON object (no prose, no markdown):
{
  "watermark": {
    "has_watermark": boolean,            // any visible watermark, semi-transparent logo, platform badge, or overlaid text
    "type": "visible" | "invisible" | "none",
    "location": "short description, or none",
    "vendor": "the company/platform/tool the watermark belongs to if identifiable (e.g. OpenAI, Google, Midjourney, Stable Diffusion, Adobe Firefly, Meta, TikTok, Getty, Shutterstock), otherwise unknown or none",
    "vendor_reason": "brief visual evidence for the vendor",
    "confidence": 0.0
  },
  "face": {
    "face_present": boolean,
    "spectrum": "visible" | "nir" | "unknown",                 // visible-light vs near-infrared capture
    "is_attack": boolean,                                       // presentation/spoof attack
    "attack_type": "paper" | "replay" | "3d_mask" | "none" | "unknown",  // printed paper, screen/video replay, 3D mask
    "attack_reason": "brief visual evidence",
    "attributes": {
      "age_range": "approx age range e.g. 25-35, or unknown",
      "gender": "male | female | unknown",
      "expression": "e.g. neutral, smiling, surprised, or unknown",
      "glasses": true,
      "headwear": true,
      "facial_hair": true
    },
    "confidence": 0.0
  }
}`;

interface VisionFaceAttrs {
  age_range?: string;
  gender?: string;
  expression?: string;
  glasses?: boolean;
  headwear?: boolean;
  facial_hair?: boolean;
}

export interface VisionVote {
  model: string;
  watermark?: {
    has_watermark?: boolean;
    type?: string;
    location?: string;
    vendor?: string;
    vendor_reason?: string;
    confidence?: number;
  };
  face?: {
    face_present?: boolean;
    spectrum?: string;
    is_attack?: boolean;
    attack_type?: string;
    attack_reason?: string;
    attributes?: VisionFaceAttrs;
    confidence?: number;
  };
}

/** Run every available vision model with the combined forensic prompt. */
export async function runVisionVotes(
  bytes: Uint8Array,
  mime: string,
): Promise<VisionVote[]> {
  const base64 = Buffer.from(bytes).toString("base64");
  const votes: VisionVote[] = [];

  const collect = async (
    model: string,
    call: () => Promise<string | null>,
  ): Promise<void> => {
    try {
      const parsed = parseJsonLoose<Omit<VisionVote, "model">>(await call());
      if (parsed) votes.push({ model, ...parsed });
    } catch {
      // Drop this provider's vote on any error (bad key, rate limit, etc.).
    }
  };

  await Promise.all([
    collect("gpt-4o", () => callOpenAIVision(VISION_PROMPT, base64, mime)),
    collect("gemini-2.5-flash", () => callGeminiVision(VISION_PROMPT, base64, mime)),
  ]);

  return votes;
}

export interface AggregateSignals {
  aiGenerated: number | null;
  deepfakeScore: number | null;
  sightFaces: DetectedFace[];
}

export interface AggregateOutput {
  watermark: WatermarkResult;
  face: FaceResult;
}

/** Fuse vision votes + Sightengine signals into final verdicts. */
export async function aggregate(
  votes: VisionVote[],
  signals: AggregateSignals,
): Promise<AggregateOutput> {
  const anyModel = votes.length > 0;

  // --- Watermark votes (vision) ---
  const vendorVotes: VendorVote[] = votes.map((v) => ({
    model: v.model,
    vendor: normVendor(v.watermark?.vendor),
    reasoning: v.watermark?.vendor_reason ?? "",
  }));
  const wmFlags = votes.map((v) => Boolean(v.watermark?.has_watermark));
  const hasWatermark =
    wmFlags.length > 0 &&
    wmFlags.filter(Boolean).length * 2 >= wmFlags.length &&
    wmFlags.some(Boolean);
  const wmPos = votes.find((v) => v.watermark?.has_watermark);
  const wmType = normWmType(wmPos?.watermark?.type);
  const wmLocation = wmPos?.watermark?.location?.trim() || "none";
  const wmConfidence = avg(votes.map((v) => clamp01(v.watermark?.confidence)));

  // --- Face votes (vision + Sightengine) ---
  const attackVotes: AttackVote[] = votes.map((v) => ({
    source: v.model,
    is_attack: Boolean(v.face?.is_attack),
    attack_type: normAttack(v.face?.attack_type),
    reasoning: v.face?.attack_reason ?? "",
  }));
  if (signals.deepfakeScore !== null) {
    const sus = signals.deepfakeScore >= DEEPFAKE_THRESHOLD;
    attackVotes.push({
      source: "sightengine",
      is_attack: sus,
      attack_type: sus ? "replay" : "none",
      reasoning: `deepfake score ${signals.deepfakeScore.toFixed(2)}`,
    });
  }

  const facePresent =
    votes.some((v) => v.face?.face_present) || signals.sightFaces.length > 0;
  const spectrum = majoritySpectrum(votes.map((v) => normSpectrum(v.face?.spectrum)));
  const attrVote = votes.find((v) => v.face?.face_present && v.face?.attributes);

  // Deterministic baseline (used when the judge is unavailable).
  const detAttack =
    attackVotes.length > 0 &&
    attackVotes.filter((a) => a.is_attack).length * 2 > attackVotes.length;
  const detAttackType = pickAttackType(attackVotes);

  // --- DeepSeek judge ---
  const { verdict: judged, error: judgeError } =
    anyModel && hasDeepSeek()
      ? await deepseekJudge(votes, signals)
      : { verdict: null, error: null };

  // Surface DeepSeek's own opinion as explicit votes (transparency).
  if (judged) {
    const dsVendor = normVendor(judged.watermark_vendor);
    if (dsVendor && dsVendor !== "Unknown") {
      vendorVotes.push({
        model: "deepseek",
        vendor: dsVendor,
        reasoning: judged.reasoning ?? "",
      });
    }
    if (facePresent && typeof judged.is_attack === "boolean") {
      attackVotes.push({
        source: "deepseek",
        is_attack: judged.is_attack,
        attack_type: normAttack(judged.attack_type),
        reasoning: judged.reasoning ?? "",
      });
    }
  }

  let isAttack = judged?.is_attack ?? detAttack;
  let attackType = normAttack(judged?.attack_type ?? detAttackType);
  // Reconcile: a real face cannot simultaneously be an attack. If anything flags
  // an attack, the face is not real; otherwise honor the judge's real-face call.
  let isRealFace = facePresent
    ? !isAttack && (judged?.is_real_face ?? !detAttack)
    : false;
  if (isAttack && attackType === "none") attackType = "unknown";
  let realConf = clamp01(judged?.verdict_confidence) || (facePresent ? 0.6 : 0);

  // HARD RULE: AI-generated image => any face is fake.
  const aiOverride =
    signals.aiGenerated !== null &&
    signals.aiGenerated >= AI_GEN_THRESHOLD &&
    facePresent;
  if (aiOverride) {
    isRealFace = false;
    isAttack = true;
    if (attackType === "none") attackType = "unknown";
    realConf = clamp01(signals.aiGenerated) || 0.9;
    attackVotes.push({
      source: "rule:ai-generated",
      is_attack: true,
      attack_type: attackType,
      reasoning: `AI-generated probability ${(signals.aiGenerated ?? 0).toFixed(2)} ≥ ${AI_GEN_THRESHOLD}`,
    });
  }

  // A text-only judge's "Unknown" must not override a concrete vendor the vision
  // models actually saw — only let the judge win when it names a real vendor.
  const judgeVendor = normVendor(judged?.watermark_vendor);
  const vendorFinal = hasWatermark
    ? judgeVendor && judgeVendor !== "Unknown"
      ? judgeVendor
      : majorityVendor(vendorVotes)
    : null;
  const vendorConf = hasWatermark
    ? clamp01(judged?.watermark_vendor_confidence) || 0.5
    : 0;

  // Attributes only when we have a face and it's not synthetic.
  const attributes =
    facePresent && !aiOverride
      ? normFaceAttributes(attrVote?.face?.attributes)
      : null;

  const watermark: WatermarkResult = {
    has_watermark: hasWatermark,
    type: hasWatermark ? wmType : "none",
    location: hasWatermark ? wmLocation : "none",
    confidence: wmConfidence,
    vendor: vendorFinal,
    vendor_confidence: vendorConf,
    vendor_votes: vendorVotes,
    notes: anyModel ? (judged?.reasoning ?? "") : "no vision model responded",
    mock: !anyModel,
  };

  const face: FaceResult = {
    face_present: facePresent,
    face_count: signals.sightFaces.length,
    faces: signals.sightFaces,
    spectrum,
    attributes,
    is_attack: facePresent ? isAttack : false,
    attack_type: facePresent ? attackType : "none",
    attack_votes: attackVotes,
    is_real_face: isRealFace,
    real_face_confidence: realConf,
    ai_generated_override: aiOverride,
    reasoning:
      judged?.reasoning ??
      (anyModel ? "Aggregated from model votes." : "no vision model responded"),
    judge_model: hasDeepSeek() ? DEEPSEEK_MODEL : null,
    judge_used: judged !== null,
    judge_error: judgeError,
    mock: !anyModel && signals.sightFaces.length === 0,
  };

  return { watermark, face };
}

// --- DeepSeek judge --------------------------------------------------------

interface JudgeVerdict {
  watermark_present?: boolean;
  watermark_vendor?: string;
  watermark_vendor_confidence?: number;
  spectrum?: string;
  is_attack?: boolean;
  attack_type?: string;
  is_real_face?: boolean;
  verdict_confidence?: number;
  reasoning?: string;
}

async function deepseekJudge(
  votes: VisionVote[],
  signals: AggregateSignals,
): Promise<{ verdict: JudgeVerdict | null; error: string | null }> {
  const evidence = {
    sightengine: {
      ai_generated: signals.aiGenerated,
      deepfake_score: signals.deepfakeScore,
      face_count: signals.sightFaces.length,
    },
    vision_models: votes,
  };
  const system =
    "You are a strict forensic judge. Aggregate evidence from multiple detectors and reply with ONLY a JSON object.";
  const user = `Evidence (JSON):
${JSON.stringify(evidence)}

Decide the final verdicts. Rules:
- If sightengine.ai_generated >= ${AI_GEN_THRESHOLD} and a face is present, the face is FAKE (is_real_face=false).
- Identify the watermark vendor by weighing the vision models' vendor guesses; use "Unknown" if a watermark exists but the source is unclear.
- Decide any presentation attack (paper / replay / 3d_mask) by weighing the votes.
Reply with ONLY this JSON ("verdict_confidence" = how confident you are in the is_real_face decision, 0..1):
{ "watermark_present": boolean, "watermark_vendor": "string or none", "watermark_vendor_confidence": 0.0, "spectrum": "visible|nir|unknown", "is_attack": boolean, "attack_type": "paper|replay|3d_mask|none|unknown", "is_real_face": boolean, "verdict_confidence": 0.0, "reasoning": "1-2 sentences" }`;

  try {
    const text = await callDeepSeekText(system, user, DEEPSEEK_MODEL);
    const verdict = parseJsonLoose<JudgeVerdict>(text);
    if (!verdict) {
      return { verdict: null, error: "DeepSeek returned unparseable output" };
    }
    return { verdict, error: null };
  } catch (e) {
    return {
      verdict: null,
      error: e instanceof Error ? e.message : "DeepSeek call failed",
    };
  }
}

// --- Helpers ---------------------------------------------------------------

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function avg(nums: number[]): number {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function cleanStr(s?: string): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || /^(none|unknown|n\/?a)$/i.test(t)) return null;
  return t;
}

function normFaceAttributes(a?: VisionFaceAttrs): FaceAttributes | null {
  if (!a) return null;
  const result: FaceAttributes = {
    age_range: cleanStr(a.age_range),
    gender: cleanStr(a.gender),
    expression: cleanStr(a.expression),
    glasses: typeof a.glasses === "boolean" ? a.glasses : null,
    headwear: typeof a.headwear === "boolean" ? a.headwear : null,
    facial_hair: typeof a.facial_hair === "boolean" ? a.facial_hair : null,
  };
  return Object.values(result).some((v) => v !== null) ? result : null;
}

function normVendor(v?: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || /^(none|n\/?a)$/i.test(s)) return null;
  if (/^unknown$/i.test(s)) return "Unknown";
  return s;
}

function majorityVendor(votes: VendorVote[]): string | null {
  const tally = new Map<string, number>();
  for (const v of votes) {
    if (!v.vendor || v.vendor === "Unknown") continue;
    const key = v.vendor.toLowerCase();
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const v of votes) {
    if (!v.vendor || v.vendor === "Unknown") continue;
    const c = tally.get(v.vendor.toLowerCase()) ?? 0;
    if (c > bestCount) {
      best = v.vendor;
      bestCount = c;
    }
  }
  if (best) return best;
  return votes.some((v) => v.vendor) ? "Unknown" : null;
}

function normWmType(t?: string): "visible" | "invisible" | "none" {
  return t === "visible" || t === "invisible" ? t : "none";
}

function normAttack(t?: string): AttackType {
  switch (t) {
    case "paper":
    case "replay":
    case "3d_mask":
    case "none":
      return t;
    default:
      return "unknown";
  }
}

function normSpectrum(s?: string): Spectrum {
  return s === "visible" || s === "nir" ? s : "unknown";
}

function majoritySpectrum(list: Spectrum[]): Spectrum {
  const counts: Record<Spectrum, number> = { visible: 0, nir: 0, unknown: 0 };
  for (const s of list) counts[s]++;
  if (counts.visible === 0 && counts.nir === 0) return "unknown";
  return counts.nir > counts.visible ? "nir" : "visible";
}

function pickAttackType(votes: AttackVote[]): AttackType {
  const tally = new Map<AttackType, number>();
  for (const v of votes) {
    if (!v.is_attack) continue;
    if (v.attack_type === "none" || v.attack_type === "unknown") continue;
    tally.set(v.attack_type, (tally.get(v.attack_type) ?? 0) + 1);
  }
  let best: AttackType = "unknown";
  let bestCount = 0;
  for (const [type, count] of tally) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  if (bestCount > 0) return best;
  return votes.some((v) => v.is_attack) ? "unknown" : "none";
}
