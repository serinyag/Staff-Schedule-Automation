"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { sendPasswordReset } from "@/lib/supabase/recovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true); setError("");
    try {
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("next", "/auth/complete?mode=recovery");
      const { error: resetError } = await sendPasswordReset(email.trim(), redirect.toString());
      if (resetError) {
        setError(resetError.status === 429 ? "Please wait a few minutes before requesting another link." : "We couldn't send the reset link. Please try again shortly.");
      } else setSent(true);
    } catch { setError("We couldn't connect. Check your connection and try again."); }
    finally { setSending(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">WNC Staff Scheduling</p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-950">Reset your password</h1>
      {sent ? <div role="status" className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
        <p>If an account exists for that email, you&apos;ll receive a password reset link.</p>
        <p>Check your inbox and spam folder. You can open the link on any device or browser. Use the newest email; each link works once.</p>
      </div> : <form onSubmit={requestReset} className="mt-5 space-y-4">
        <p className="text-sm leading-6 text-slate-600">Enter your staff email and we&apos;ll send you a link to choose a new password.</p>
        <p className="text-xs leading-5 text-slate-500">You can open the email link on any device or browser.</p>
        <label className="block text-sm font-medium text-slate-700">Email
          <input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <button disabled={sending} className="h-11 w-full rounded-lg bg-slate-950 text-sm font-medium text-white disabled:opacity-50">{sending ? "Sending…" : "Send reset link"}</button>
      </form>}
      <Link href="/login" className="mt-5 inline-block text-sm font-medium text-slate-600 underline">Back to sign in</Link>
    </section>
  </main>;
}
