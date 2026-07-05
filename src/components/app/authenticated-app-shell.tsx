import type { ReactNode } from "react";
import { logoutAction } from "@/app/(authenticated)/actions";
import { AuthenticatedNav } from "@/components/app/authenticated-nav";
import type { AppNavItem } from "@/lib/authenticated-app";

type AuthenticatedAppShellProps = {
  userEmail: string;
  profileLabel: string;
  managementItems: AppNavItem[];
  employeeItems: AppNavItem[];
  children: ReactNode;
};

export function AuthenticatedAppShell({
  userEmail,
  profileLabel,
  managementItems,
  employeeItems,
  children,
}: AuthenticatedAppShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(188,212,255,0.45),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[96rem] flex-col gap-6 px-4 py-4 sm:px-6 lg:flex-row lg:px-8 lg:py-6">
        <aside className="rounded-[2rem] border border-white/70 bg-white/90 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-80 lg:p-5">
          <div className="flex h-full flex-col">
            <div className="rounded-[1.5rem] bg-slate-950 px-5 py-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-sky-200">
                WNC Staff
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Shared workspace for staff scheduling, personal availability, and manager tools.
              </p>
            </div>

            <div className="mt-5 flex-1 space-y-5 overflow-y-auto pr-1">
              {managementItems.length > 0 ? (
                <section className="space-y-2">
                  <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Management
                  </p>
                  <AuthenticatedNav items={managementItems} />
                </section>
              ) : null}

              <section className="space-y-2">
                <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Employee
                </p>
                <AuthenticatedNav items={employeeItems} />
              </section>
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current user
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">{userEmail}</p>
              <p className="mt-1 text-sm text-slate-600">{profileLabel}</p>
              <form action={logoutAction} className="mt-4">
                <button
                  type="submit"
                  className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-1">{children}</main>
      </div>
    </div>
  );
}
