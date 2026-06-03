import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

// Entry point: send the user to /dashboard if signed in, otherwise /login.
export default async function Home() {
  // Before the Supabase env vars are filled in, fall through to /login so the
  // skeleton still renders instead of crashing.
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
