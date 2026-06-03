"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import ImageUploader from "@/components/ImageUploader";

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
  }, [router]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-zinc-500">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">图像检测</h1>
        <button
          onClick={handleSignOut}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          退出
        </button>
      </header>
      <p className="mt-1 text-sm text-zinc-500">
        上传一张图片,检测水印、人脸、AI 生成与 spoofing。
      </p>
      <div className="mt-6">
        <ImageUploader />
      </div>
    </main>
  );
}
