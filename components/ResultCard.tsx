import type { DetectionResponse } from "@/lib/types";

export default function ResultCard({ result }: { result: DetectionResponse }) {
  const { genai_result, face_result, watermark_result, cached } = result;
  const faceCount = face_result.faces.length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">检测结果</h2>
        {cached && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            缓存命中(未重复消耗 API)
          </span>
        )}
      </div>

      {/* AI 生成 */}
      <Row
        label="AI 生成"
        value={formatProb(genai_result.ai_generated)}
        mock={genai_result.mock}
      />

      {/* 水印 */}
      <div className="border-t border-black/5 pt-3 dark:border-white/10">
        <Row
          label="水印"
          value={
            watermark_result.has_watermark
              ? `有(${watermark_result.type})· 置信度 ${formatProb(
                  watermark_result.confidence,
                )}`
              : "未检测到"
          }
          mock={watermark_result.mock}
        />
        {watermark_result.has_watermark &&
          watermark_result.location !== "none" && (
            <p className="mt-1 text-xs text-zinc-500">
              位置:{watermark_result.location}
            </p>
          )}
        {watermark_result.notes && (
          <p className="mt-1 text-xs text-zinc-400">{watermark_result.notes}</p>
        )}
      </div>

      {/* 人脸 */}
      <div className="border-t border-black/5 pt-3 dark:border-white/10">
        <Row
          label="人脸数量"
          value={String(faceCount)}
          mock={face_result.mock}
        />
      </div>

      {/* Spoofing / 活体 — 实验性 */}
      <div className="border-t border-black/5 pt-3 dark:border-white/10">
        <Row
          label="Spoofing / 换脸"
          value={formatProb(face_result.deepfake_score)}
          mock={face_result.mock}
        />
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠️ 实验性,单张静态图不可靠。Sightengine 的 deepfake 针对数字换脸,
          并非物理呈现攻击(面具 / 纸张 / 回放)。真正的活体检测需视频流或多帧引导采集。
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mock,
}: {
  label: string;
  value: string;
  mock: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="flex items-center gap-2 font-medium">
        {value}
        {mock && (
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-normal text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            mock
          </span>
        )}
      </span>
    </div>
  );
}

function formatProb(p: number | null): string {
  if (p === null || Number.isNaN(p)) return "未知";
  return `${Math.round(p * 100)}%`;
}
