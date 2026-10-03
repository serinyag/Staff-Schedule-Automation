"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AvailabilityRevisionRow } from "@/lib/supabase/types";
import { reviewAvailabilityRequest } from "@/app/(authenticated)/admin/availability/actions";

export function ChangeRequests({ requests, names }: { requests: AvailabilityRevisionRow[]; names: Record<string, string> }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <section className="rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Availability change requests</h2>
    <p className="mt-1 text-sm text-slate-600">Published shifts stay in place. Requests that conflict with assigned shifts need cover before approval.</p>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {requests.length === 0 && <p className="mt-3 text-sm text-slate-500">No pending requests.</p>}
    {requests.map(request => <form key={request.id} className="mt-4 rounded-lg border p-4" action={form => startTransition(async () => {
      const result = await reviewAvailabilityRequest(request.id, form.get("decision") === "approve", String(form.get("note") ?? ""));
      setMessage(result); router.refresh();
    })}>
      <p className="font-semibold">{names[request.staff_id] ?? "Staff member"} <span className="font-normal text-slate-500">· {new Date(request.created_at).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam" })}</span></p>
      <details className="my-3 text-sm"><summary className="cursor-pointer">Requested availability</summary><ul className="mt-2 grid gap-1 sm:grid-cols-2">{Array.isArray(request.daily_availability) && request.daily_availability.map((value, i) => {
        const day = value as { available_date: string; morning: boolean; day: boolean; evening: boolean };
        return <li key={i}>{day.available_date}: {(["morning", "day", "evening"] as const).filter(k => !day[k]).join(", ") || "Fully available"}{(!day.morning || !day.day || !day.evening) ? " unavailable" : ""}</li>;
      })}</ul></details>
      <label className="block text-sm">Review note<input name="note" className="mt-1 w-full rounded-lg border p-2" maxLength={1000} /></label>
      <div className="mt-3 flex gap-2"><button name="decision" value="approve" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">Approve</button><button name="decision" value="reject" disabled={pending} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Reject</button></div>
    </form>)}
  </section>;
}
