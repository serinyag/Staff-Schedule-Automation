import type { ReactNode } from "react";
import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { getAuthenticatedAppContext } from "@/lib/authenticated-app";

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await getAuthenticatedAppContext();

  return (
    <AuthenticatedAppShell
      userEmail={context.userEmail}
      profileLabel={context.profileLabel}
      managementItems={context.managementItems}
      employeeItems={context.employeeItems}
    >
      {children}
    </AuthenticatedAppShell>
  );
}
