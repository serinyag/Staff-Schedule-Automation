"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function CompleteInvitationPage() {
  const started = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const type = fragment.get("type");
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    // Remove credentials from the address bar before rendering the form.
    window.history.replaceState(null, "", window.location.pathname);
    if (!accessToken || !refreshToken || (type !== "invite" && type !== "recovery")) {
      setMessage("This invitation is missing or has expired. Ask your manager for a new invitation or recovery link.");
      setStatus("error");
      return;
    }
    async function acceptInvitation() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.auth.setSession({ access_token: accessToken!, refresh_token: refreshToken! });
        if (error) throw error;
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) throw userError ?? new Error("Missing user");
        setStatus("ready");
      } catch {
        setMessage("This invitation could not be verified. Ask your manager for a new invitation or recovery link.");
        setStatus("error");
      }
    }
    void acceptInvitation();
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        return;
      }
      window.location.replace("/auth/redirect");
    } catch {
      setMessage("Your password could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">WNC Staff Scheduling</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Set your password</h1>
        {status === "loading" ? <p className="mt-4 text-sm text-slate-600" role="status">Checking your invitation…</p> : null}
        {message ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p> : null}
        {status === "ready" ? (
          <form onSubmit={savePassword} className="mt-5 space-y-4">
            <p className="text-sm text-slate-600">Choose a password to finish setting up your staff login.</p>
            <label className="block text-sm font-medium text-slate-700">New password
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <p className="text-xs text-slate-500">Use at least 8 characters.</p>
            <label className="block text-sm font-medium text-slate-700">Confirm password
              <input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <button disabled={saving} className="h-11 w-full rounded-lg bg-slate-950 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save password and continue"}</button>
          </form>
        ) : null}
        {status === "error" ? <a className="mt-5 inline-block text-sm underline" href="/login">Back to sign in</a> : null}
      </section>
    </main>
  );
}
