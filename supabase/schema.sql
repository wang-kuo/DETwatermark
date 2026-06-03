-- DETwatermark — Supabase schema (BLUEPRINT §4)
-- 在 Supabase 控制台的 SQL Editor 里执行本文件。
-- 语句均为幂等(if not exists / drop policy if exists),可重复运行。

-- 邀请码表 -----------------------------------------------------------------
create table if not exists invite_codes (
  code        text primary key,
  used_by     uuid references auth.users,
  used_at     timestamptz,
  max_uses    int default 1,
  use_count   int default 0,
  created_at  timestamptz default now()
);

-- invite_codes 是访问控制的唯一关口:绝不能让公开的 anon key 直接读取。
-- 开启 RLS 且不加任何宽松策略 => anon / authenticated 角色零访问;
-- 服务端用 service-role key(createSupabaseAdminClient)读写,本就绕过 RLS,不受影响。
alter table invite_codes enable row level security;
revoke all on invite_codes from anon, authenticated;

-- 检测记录表 ---------------------------------------------------------------
create table if not exists detections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users,
  image_hash       text unique not null,      -- sha256, 去重索引
  storage_path     text not null,             -- Supabase Storage 路径
  mime_type        text,
  watermark_result jsonb,                      -- 大模型 VQA 输出
  face_result      jsonb,                      -- Sightengine 人脸 + deepfake
  genai_result     jsonb,                      -- Sightengine AI 生成判断
  created_at       timestamptz default now()
);

create index if not exists detections_user_id_idx on detections (user_id);
create index if not exists detections_created_at_idx on detections (created_at desc);

-- RLS:用户只能读写自己的检测记录 -----------------------------------------
-- 注意:服务端用 service-role key 写入(绕过 RLS),这些策略主要保护未来的
-- 前端直读场景(如检测历史页)。
alter table detections enable row level security;

drop policy if exists "own_rows_select" on detections;
create policy "own_rows_select" on detections
  for select using (auth.uid() = user_id);

drop policy if exists "own_rows_insert" on detections;
create policy "own_rows_insert" on detections
  for insert with check (auth.uid() = user_id);

-- 示例邀请码(取消注释并按需修改)-----------------------------------------
-- insert into invite_codes (code, max_uses) values ('DEMO-2025', 100);
