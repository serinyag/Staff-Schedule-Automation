import type { ReactNode } from "react";
import { requireManagerOrAdmin } from "@/lib/authenticated-app";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManagerOrAdmin();
  return children;
}
