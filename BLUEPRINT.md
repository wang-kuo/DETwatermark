# 图像检测 Demo — 项目蓝图

> Next.js (Vercel) + Supabase 全栈 demo。用户凭邀请码登录,上传图片后调用检测 API 判断水印 / 人脸 / AI 生成 / spoofing,结果以 hash 去重后存入 Supabase。
>
> 本文件作为 Claude Code 的搭建蓝图。建议放在仓库根目录,启动时让 Claude Code 先读它。

---

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 14+ (App Router) + TypeScript | 部署到 Vercel |
| 样式 | Tailwind CSS | |
| 后端逻辑 | Next.js API Routes (Route Handlers) | 所有外部 API 密钥只在此层使用 |
| 数据库 | Supabase Postgres | 检测记录、邀请码 |
| 对象存储 | Supabase Storage | 图片二进制 |
| 认证 | Supabase Auth | 匿名会话 / magic link |
| AI 生成 + 人脸检测 | Sightengine API | `genai` / `face-attributes` / `deepfake` 模型 |
| 水印检测 | 多模态大模型 VQA | Gemini 2.5 Flash 或 GPT-4o,prompt 兜底 |

---

## 2. 核心流程

```
用户输入邀请码
  → POST /api/verify-invite 校验
  → 通过则建立 Supabase 会话(匿名登录或 magic link)
  → 进入 /dashboard
  → 选择图片,前端计算 sha256(图片字节)
  → POST /api/detect { hash, file }
      → 查 detections 表:hash 已存在?
          是 → 直接返回缓存结果(不再花 API 钱)
          否 → 上传 Supabase Storage
             → 并行调用 Sightengine(genai + face + deepfake)
             → 调用大模型 VQA 判断水印
             → 写入 detections 表
             → 返回结果
  → 前端展示检测结果
```

**两个关键设计点**

1. **hash 去重**:`sha256` 作为 `detections.image_hash` 的唯一索引,同一张图永不重复检测,省 API 费用。
2. **密钥隔离**:Sightengine secret、大模型 API key 只能出现在 API Route(服务端)。前端永远拿不到,只调自家 `/api/*`。

---

## 3. 检测能力与现实边界

### 3.1 Sightengine(一次调用组合多个模型)

通过 `models` 参数组合:

- `genai` — 图像是否由 AI 生成
- `face-attributes` — 是否含人脸及属性
- `deepfake` — 人脸是否被伪造 / 换脸

### 3.2 Anti-spoofing 的重要预期管理

⚠️ **务必在 UI 上标注**:面具(mask)、纸张攻击(paper attack)、视频回放(replay)这类 **PAD(Presentation Attack Detection)在单张静态图上几乎无法可靠判断**。

- Sightengine 的 `deepfake` 针对的是"数字换脸伪造",**不是**物理呈现攻击。
- 真正的活体检测(liveness / PAD)需要**视频流或引导式多帧采集**(如要求用户转头、眨眼)。
- Demo 阶段将 spoofing 一项标为「实验性 / 仅供参考」,避免误导。

### 3.3 水印检测

Sightengine 无专门水印接口。用大模型 VQA 兜底。建议 prompt:

```
你是图像审核助手。请判断这张图中是否存在水印、半透明 logo、
平台标识或叠加文字。以 JSON 返回:
{ "has_watermark": bool, "type": "visible|invisible|none",
  "location": "描述位置或 none", "confidence": 0-1, "notes": "" }
只返回 JSON,不要其他文字。
```

---

## 4. 数据库 Schema(Supabase SQL Editor 执行)

```sql
-- 邀请码表
create table invite_codes (
  code        text primary key,
  used_by     uuid references auth.users,
  used_at     timestamptz,
  max_uses    int default 1,
  use_count   int default 0,
  created_at  timestamptz default now()
);

-- 检测记录表
create table detections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users,
  image_hash      text unique not null,      -- sha256, 去重索引
  storage_path    text not null,             -- Supabase Storage 路径
  mime_type       text,
  watermark_result jsonb,                     -- 大模型 VQA 输出
  face_result     jsonb,                      -- Sightengine 人脸 + deepfake
  genai_result    jsonb,                      -- Sightengine AI 生成判断
  created_at      timestamptz default now()
);

create index on detections (user_id);
create index on detections (created_at desc);

-- RLS:用户只能读写自己的检测记录
alter table detections enable row level security;

create policy "own_rows_select" on detections
  for select using (auth.uid() = user_id);
create policy "own_rows_insert" on detections
  for insert with check (auth.uid() = user_id);
```

**Storage bucket**:在 Supabase 控制台建一个 bucket(如 `uploads`),设为 private,通过签名 URL 访问。

> 备选:如果坚持把 base64 直接存库(更简单但不推荐用于多图场景),则在 `detections` 增加一列 `image_base64 text`,并去掉 Storage 相关逻辑。表会膨胀、查询变慢,仅适合极小规模 demo。

---

## 5. 项目结构

```
.
├── app/
│   ├── login/
│   │   └── page.tsx              # 邀请码输入页
│   ├── dashboard/
│   │   └── page.tsx              # 上传 + 结果展示
│   ├── api/
│   │   ├── verify-invite/
│   │   │   └── route.ts          # 校验邀请码、建立会话
│   │   └── detect/
│   │       └── route.ts          # 上传 → 去重 → 调 API → 写库
│   ├── layout.tsx
│   └── page.tsx                  # 重定向到 /login 或 /dashboard
├── lib/
│   ├── supabase.ts               # Supabase 客户端(server + browser)
│   ├── hash.ts                   # sha256 计算
│   ├── sightengine.ts            # Sightengine 调用封装
│   └── watermark.ts              # 大模型 VQA 调用封装
├── components/
│   ├── ImageUploader.tsx
│   └── ResultCard.tsx
├── .env.local                    # 见下方环境变量
└── BLUEPRINT.md                  # 本文件
```

---

## 6. 各 API Route 职责

### `POST /api/verify-invite`
- 入参:`{ code: string }`
- 查 `invite_codes`,校验 `use_count < max_uses`
- 通过 → 触发 Supabase 匿名登录(`signInAnonymously`)或发送 magic link,并 `use_count += 1`、记 `used_by` / `used_at`
- 出参:`{ ok: bool, error?: string }`

### `POST /api/detect`
- 入参:`multipart/form-data`,含图片文件 + 前端算好的 `hash`
- 步骤:
  1. 校验会话(`auth.uid()` 存在)
  2. 服务端复算 sha256 校验,防伪造
  3. 查 `detections` 是否已有该 `image_hash` → 命中则直接返回
  4. 上传 Storage,得 `storage_path`
  5. **并行**:`sightengine(genai + face + deepfake)` 与 `watermarkVQA(image)`
  6. 写入 `detections`
  7. 返回 `{ watermark_result, face_result, genai_result, cached: false }`

---

## 7. 环境变量(`.env.local`)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # 仅服务端,绝不暴露给前端

# Sightengine (https://dashboard.sightengine.com)
SIGHTENGINE_USER=
SIGHTENGINE_SECRET=

# 多模态大模型(二选一)
GOOGLE_API_KEY=                   # Gemini 2.5 Flash(推荐,性价比高)
# OPENAI_API_KEY=                 # 或 GPT-4o
```

> ⚠️ 安全约束:`SUPABASE_SERVICE_ROLE_KEY`、`SIGHTENGINE_SECRET`、大模型 key **只能在 API Route 读取**。任何 `NEXT_PUBLIC_` 前缀的变量都会进入浏览器,密钥绝不能加该前缀。

---

## 8. 给 Claude Code 的启动 Prompt

把下面这段直接发给 Claude Code(已在仓库根目录、本蓝图同级):

```
读取 BLUEPRINT.md。按其中方案搭建项目骨架:

1. 初始化 Next.js 14 App Router + TypeScript + Tailwind 项目。
2. 安装并配置 @supabase/supabase-js 与 @supabase/ssr,在 lib/supabase.ts
   导出 server 端和 browser 端两个客户端工厂。
3. 实现 lib/hash.ts(sha256)、lib/sightengine.ts、lib/watermark.ts 三个封装,
   外部 API 用占位实现 + 清晰 TODO 注释,先保证类型和调用形态正确。
4. 实现 /api/verify-invite 与 /api/detect 两个 Route Handler,逻辑按蓝图第 6 节。
5. 实现 login 页(邀请码输入)与 dashboard 页(上传 + 结果卡片),
   UI 简洁即可。spoofing 结果旁标注「实验性,单张静态图不可靠」。
6. 生成 supabase/schema.sql(蓝图第 4 节的建表语句),方便我在 Supabase 控制台执行。
7. 写一份 README,说明:Supabase 项目创建、建表、建 Storage bucket、
   填 .env.local、本地运行、Vercel 部署的步骤。

先把骨架跑起来(npm run dev 能编译通过),外部 API 的真实调用留 TODO,
我拿到密钥后再逐个接通。每完成一步简要说明你做了什么。
```

---

## 9. 后续可扩展项

- 真正的活体检测:接入引导式视频采集 + 专门 PAD 服务(FaceOnLive / AWS Rekognition Liveness)
- 隐形水印 / C2PA:校验 Content Credentials 元数据、接 Google SynthID
- 检测历史页:列出用户过往所有 detections
- 限流:对每个邀请码限制每日检测次数
- 批量上传与异步队列(Supabase Edge Functions / 队列)
