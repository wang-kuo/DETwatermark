// Watermark detection via multimodal-LLM VQA (SERVER ONLY — reads model keys).
//
// Sightengine has no dedicated watermark model, so we ask a vision LLM to
// inspect the image and answer in the structured JSON from BLUEPRINT §3.3.
// Gemini 2.5 Flash is preferred (cost); GPT-4o is the fallback.
//
// Until a key is configured the wrapper returns a labelled mock (mock: true).

import type { WatermarkResult } from "./types";

const VQA_PROMPT = `你是图像审核助手。请判断这张图中是否存在水印、半透明 logo、
平台标识或叠加文字。以 JSON 返回:
{ "has_watermark": bool, "type": "visible|invisible|none",
  "location": "描述位置或 none", "confidence": 0-1, "notes": "" }
只返回 JSON,不要其他文字。`;

export async function detectWatermark(
  bytes: Uint8Array,
  mimeType: string,
): Promise<WatermarkResult> {
  const base64 = Buffer.from(bytes).toString("base64");

  if (process.env.GOOGLE_API_KEY) {
    return detectWithGemini(base64, mimeType);
  }
  if (process.env.OPENAI_API_KEY) {
    return detectWithOpenAI(base64, mimeType);
  }
  // TODO: set GOOGLE_API_KEY (Gemini 2.5 Flash) or OPENAI_API_KEY (GPT-4o) to
  // enable real watermark VQA.
  return mockWatermarkResult();
}

// --- Gemini ----------------------------------------------------------------

async function detectWithGemini(
  base64: string,
  mimeType: string,
): Promise<WatermarkResult> {
  // TODO: confirm model id / API version — https://ai.google.dev/api/generate-content
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: VQA_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseWatermarkJson(text);
}

// --- OpenAI ----------------------------------------------------------------

async function detectWithOpenAI(
  base64: string,
  mimeType: string,
): Promise<WatermarkResult> {
  // TODO: confirm model id — GPT-4o vision via the Chat Completions API.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VQA_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  return parseWatermarkJson(text);
}

// --- Internal --------------------------------------------------------------

function parseWatermarkJson(text: string | undefined): WatermarkResult {
  if (!text) {
    return { ...emptyWatermark(), notes: "Empty model response" };
  }
  try {
    // Strip ```json fences the model may wrap the JSON in.
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<WatermarkResult>;
    return {
      has_watermark: Boolean(parsed.has_watermark),
      type:
        parsed.type === "visible" || parsed.type === "invisible"
          ? parsed.type
          : "none",
      location: typeof parsed.location === "string" ? parsed.location : "none",
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      mock: false,
    };
  } catch {
    return {
      ...emptyWatermark(),
      notes: `Failed to parse model JSON: ${text.slice(0, 200)}`,
    };
  }
}

function emptyWatermark(): WatermarkResult {
  return {
    has_watermark: false,
    type: "none",
    location: "none",
    confidence: 0,
    notes: "",
    mock: false,
  };
}

function mockWatermarkResult(): WatermarkResult {
  return {
    has_watermark: false,
    type: "none",
    location: "none",
    confidence: 0,
    notes: "mock 结果 — 未配置大模型 API key",
    mock: true,
  };
}
