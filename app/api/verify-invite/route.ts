// POST /api/verify-invite  (BLUEPRINT §6)
//   in : { code: string }
//   out: { ok: boolean, error?: string }
//
// Validates an invite code, establishes an anonymous Supabase session (so the
// browser receives auth cookies), then marks the code as used.

import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured — fill in .env.local first" },
      { status: 500 },
    );
  }

  // Idempotency guard: if this browser already holds a valid session, don't mint
  // a new anonymous user or burn another use_count — just let them through.
  // (Covers page refresh / back+resubmit / re-visiting /login.)
  const supabase = await createSupabaseServerClient();
  {
    const {
      data: { user: existingUser },
    } = await supabase.auth.getUser();
    if (existingUser) {
      return NextResponse.json({ ok: true });
    }
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  if (typeof body.code !== "string" || body.code.trim() === "") {
    return NextResponse.json(
      { ok: false, error: "Invite code is required" },
      { status: 400 },
    );
  }
  const code = body.code.trim();

  const admin = createSupabaseAdminClient();

  // 1. Look up the invite code (service role — invite_codes is not user-owned).
  const { data: invite, error: fetchErr } = await admin
    .from("invite_codes")
    .select("code, max_uses, use_count")
    .eq("code", code)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: fetchErr.message },
      { status: 500 },
    );
  }
  if (!invite) {
    return NextResponse.json(
      { ok: false, error: "Invalid invite code" },
      { status: 403 },
    );
  }
  if (invite.use_count >= invite.max_uses) {
    return NextResponse.json(
      { ok: false, error: "This invite code has been used up" },
      { status: 403 },
    );
  }

  // 2. Establish a session. signInAnonymously writes the auth cookies through
  //    the cookie-bound server client, so subsequent /api/detect calls are
  //    authenticated. Requires "Anonymous sign-ins" enabled in Supabase Auth.
  const { data: auth, error: authErr } =
    await supabase.auth.signInAnonymously();
  if (authErr || !auth.user) {
    return NextResponse.json(
      {
        ok: false,
        error:
          authErr?.message ??
          "Anonymous sign-in failed — enable Anonymous sign-ins in the Supabase dashboard",
      },
      { status: 500 },
    );
  }

  // 3. Mark the code as used.
  //    TODO: read-then-write is racy under concurrency. For production move this
  //    into a Postgres function / atomic update guarded by use_count < max_uses.
  const { error: updateErr } = await admin
    .from("invite_codes")
    .update({
      use_count: invite.use_count + 1,
      used_by: auth.user.id,
      used_at: new Date().toISOString(),
    })
    .eq("code", code);

  if (updateErr) {
    // The session cookie was already written by signInAnonymously above. Revoke
    // it so the client-visible error matches the actual auth state, and an
    // un-consumed code can't grant silent access on the next page load.
    await supabase.auth.signOut();
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
