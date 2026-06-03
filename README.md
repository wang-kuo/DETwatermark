# 图像检测 Demo (DETwatermark)

Next.js (Vercel) + Supabase 全栈 demo。用户凭**邀请码**登录,上传图片后由多模型投票判断
**可见水印 / AI 生成 / 人脸真伪(真脸 vs 攻击)**,结果以 `sha256` 去重后存入 Supabase。

> 设计与取舍详见 [`BLUEPRINT.md`](./BLUEPRINT.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 / 后端 | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| 数据库 / 存储 / 认证 | Supabase (Postgres + Storage + Auth) |
| AI 生成 + 人脸框 + deepfake | Sightengine API |
| 可见水印 + 人脸真伪 | 多模型投票:GPT-4o + Gemini 2.5 Flash(视觉)+ DeepSeek(文本裁决) |

> 蓝图标的是「Next.js 14+」,这里用 `create-next-app@latest` 生成的是 Next 16 + React 19,
> 已按 Next 15+ 的 **async `cookies()`** 写法接好 Supabase SSR。

## 当前状态

- ✅ 前后端、多模型检测管线、UI 已完整,`npm run dev` / `npm run build` 可编译通过。
- ✅ 外部 API 走真实调用(Sightengine / GPT-4o / Gemini / DeepSeek)。**未配置某个密钥时该来源自动退化**(返回 `mock` 或跳过该票),其余模型继续投票,不影响整体出结果。

---

## 一、创建 Supabase 项目

1. 打开 <https://supabase.com/dashboard>,新建一个 project,记下 **Project URL** 和 region。
2. 进入 **Project Settings → API**,拿到三个值:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY`(**仅服务端,切勿泄露**)

## 二、建表(执行 SQL)

1. 左侧 **SQL Editor → New query**。
2. 粘贴 [`supabase/schema.sql`](./supabase/schema.sql) 全部内容并 **Run**。
   - 会创建 `invite_codes`、`detections` 两张表与索引。
   - `invite_codes` 锁死(开 RLS + 收回 anon 权限,仅服务端 service-role 可读写),
     避免公开的 anon key 枚举邀请码;`detections` 开 RLS(用户只能读写自己的行)。
3. 插入一个邀请码(把 SQL 末尾那行取消注释,或单独执行):

   ```sql
   insert into invite_codes (code, max_uses) values ('DEMO-2025', 100);
   ```

## 三、建 Storage bucket

1. 左侧 **Storage → New bucket**。
2. 名称填 **`uploads`**(与代码 `STORAGE_BUCKET` 常量一致),**Public 关闭**(私有桶)。
3. 私有桶通过服务端 service-role 上传,前端不直接访问,无需额外策略。

## 四、开启匿名登录

邀请码校验通过后,后端用 `signInAnonymously()` 建立会话:

1. **Authentication → Sign In / Providers**(或 Settings)。
2. 打开 **Allow anonymous sign-ins**。

## 五、配置环境变量

```bash
cp .env.local.example .env.local
```

填入第一步拿到的值:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # 仅服务端

# 可选:配置后才走真实检测,否则返回 mock
SIGHTENGINE_USER=
SIGHTENGINE_SECRET=
GOOGLE_API_KEY=                          # 或 OPENAI_API_KEY
```

> `.env.local` 已被 `.gitignore` 忽略,不会进版本库。

## 六、本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:3000> → 自动跳到 `/login` → 输入邀请码(如 `DEMO-2025`)→ 进入 `/dashboard`
→ 选图 → **Run Analysis**。

- 未配置 Sightengine / 某个大模型密钥时,结果卡片里相应项带 **`mock`** 标记或跳过该票。
- 同一张图第二次检测会显示**「缓存命中」**(命中 `image_hash` 去重,不再花 API 钱)。

---

## 检测管线与外部 API

| 能力 | 文件 | 说明 |
|---|---|---|
| AI 生成 / 人脸框 / deepfake | `lib/sightengine.ts` | Sightengine 一次调用合并 `genai + face-attributes + deepfake`。 |
| 视觉投票(可见水印 + 人脸/光谱/攻击) | `lib/llm.ts` · `lib/analyze.ts` | GPT-4o 与 Gemini 各自给出结构化判断(仅判断是否有可见水印,不猜厂商)。 |
| 文本裁决(人脸真伪) | `lib/analyze.ts`(DeepSeek) | DeepSeek 仅文本,聚合视觉 / Sightengine 投票裁决真假脸。 |

**判定规则**:`ai_generated ≥ 0.5` 且检出人脸 ⇒ 直接判**假脸**(代码层硬规则,裁决模型不可推翻);
否则由 GPT-4o / Gemini / Sightengine 多源**投票**决定是否为攻击(paper / replay / 3D mask),
并输出人脸属性、光谱(可见光 / 近红外)、人脸位置与最终真假脸结论。

密钥都只在 **API Route(服务端)** 读取;前端只调自家 `/api/*`,永远拿不到密钥。

---

## 七、部署到 Vercel

1. 把仓库推到 GitHub。
2. <https://vercel.com/new> 导入该仓库(框架自动识别为 Next.js)。
3. **Settings → Environment Variables**:把 `.env.local` 里的每一项都加进去
   (`NEXT_PUBLIC_*`、`SUPABASE_SERVICE_ROLE_KEY`、`SIGHTENGINE_*`、`OPENAI_API_KEY`、`GOOGLE_API_KEY`、`DEEPSEEK_API_KEY`)。
4. Deploy。后续 push 自动重新部署。

> 注意:`SUPABASE_SERVICE_ROLE_KEY` 与各密钥在 Vercel 里是普通(加密)环境变量,**不要**加
> `NEXT_PUBLIC_` 前缀。

---

## 项目结构

```
app/
  page.tsx                 # 入口:按会话重定向到 /login 或 /dashboard
  login/page.tsx           # 邀请码输入页
  dashboard/page.tsx       # 上传 + 结果(校验会话)
  api/
    verify-invite/route.ts # 校验邀请码 → 匿名登录 → 计数
    detect/route.ts        # 鉴权 → 复算 hash → 去重 → 上传 → 并行检测 → 写库
lib/
  supabase.ts              # browser / server(cookie) / admin(service-role) 三个工厂
  hash.ts                  # 通用 sha256(浏览器 + Node)
  sightengine.ts           # Sightengine 封装(genai + face + deepfake)
  llm.ts                   # GPT-4o / Gemini(视觉)+ DeepSeek(文本)调用封装
  analyze.ts               # 多模型投票 + DeepSeek 裁决 + AI-gen 硬规则
  types.ts                 # 共享结果类型
components/
  ImageUploader.tsx        # 选图 / 算 hash / 调 /api/detect
  ResultCard.tsx           # 结果卡片(高亮水印 / 真假脸)
supabase/schema.sql        # 建表 + RLS,蓝图 §4
```

## 安全要点

- 密钥隔离:`SUPABASE_SERVICE_ROLE_KEY`、`SIGHTENGINE_SECRET`、大模型 key 只在 Route Handler 读取。
- hash 去重:`detections.image_hash` 唯一索引,同图不重复检测,省 API 费用。
- 服务端复算 `sha256` 校验前端传来的 hash,防伪造。
