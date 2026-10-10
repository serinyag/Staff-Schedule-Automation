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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
      <div className="mx-auto flex min-h-screen max-w-[112rem] flex-col gap-5 px-3 py-3 sm:px-5 lg:flex-row lg:py-5">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur lg:sticky lg:top-5 lg:h-[calc(100dvh-2.5rem)] lg:w-56 lg:shrink-0 lg:p-4">
          <div className="flex h-full flex-col">
            <div className="rounded-xl bg-slate-950 px-4 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-sky-200">
                WNC Staff
              </p>
              <p className="hidden mt-3 text-xs leading-5 text-slate-300 lg:block">
                Shared workspace for staff scheduling, personal availability, and manager tools.
              </p>
            </div>

            <div className="mt-4 flex-1 space-y-3 lg:overflow-y-auto">
              {managementItems.length > 0 ? (
                <section className="space-y-2">
                  <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-slate-400">
                    Management
                  </p>
                  <AuthenticatedNav items={managementItems} />
                </section>
              ) : null}

              <section className="space-y-2">
                <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  Employee
                </p>
                <AuthenticatedNav items={employeeItems} />
              </section>
            </div>

            <details className="mt-3 text-sm lg:hidden">
              <summary className="text-slate-600">Account · {profileLabel}</summary>
              <p className="mt-2 break-all text-xs">{userEmail}</p>
              <form action={logoutAction}><button className="mt-2 rounded-lg border border-slate-200 px-3 py-2" type="submit">Logout</button></form>
            </details>
            <div className="mt-4 hidden rounded-xl border border-slate-200 bg-slate-50 p-3 lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current user
              </p>
              <p className="mt-2 break-all text-xs font-semibold text-slate-950">{userEmail}</p>
              <p className="mt-1 text-sm text-slate-600">{profileLabel}</p>
              <form action={logoutAction} className="mt-4">
                <button
                  type="submit"
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </aside>

        <main id="main-content" className="min-w-0 flex-1 py-1">{children}</main>
      </div>
    </div>
  );
}
