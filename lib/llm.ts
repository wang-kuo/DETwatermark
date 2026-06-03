// Low-level multimodal / text LLM provider calls (SERVER ONLY — read API keys).
//
//   callOpenAIVision   GPT-4o, sees the image  -> JSON string
//   callGeminiVision   Gemini 2.5 Flash, sees the image -> JSON string
//   callDeepSeekText   DeepSeek (text only) judge/aggregator -> JSON string
//
// Each returns the raw model text (expected JSON) or null when its key is
// absent. Callers wrap these in try/catch so one failing provider just drops
// out of the vote instead of breaking detection.

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
export function hasGemini(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY);
}
export function hasDeepSeek(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/** Best-effort JSON parse: strips ```fences``` and falls back to the first {...} block. */
export function parseJsonLoose<T = unknown>(text: string | null | undefined): T | null {
  if (!text) return null;
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

export async function callOpenAIVision(
  prompt: string,
  base64: string,
  mime: string,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

export async function callGeminiVision(
  prompt: string,
  base64: string,
  mime: string,
): Promise<string | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const model = "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

export async function callDeepSeekText(
  system: string,
  user: string,
  model = "deepseek-chat",
): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;

  // The reasoning model (deepseek-reasoner, the "pro" model) does not accept
  // temperature / response_format — we rely on the prompt + loose JSON parsing
  // for it. deepseek-chat supports JSON mode.
  const isReasoner = model.includes("reasoner");
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (!isReasoner) {
    body.temperature = 0;
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}
