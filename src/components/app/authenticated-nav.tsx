"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppNavItem } from "@/lib/authenticated-app";

type AuthenticatedNavProps = {
  items: AppNavItem[];
};

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AuthenticatedNav({ items }: AuthenticatedNavProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const isActive = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "rounded-2xl px-4 py-3 text-sm font-medium transition",
              isActive
                ? "bg-slate-950 text-white shadow-[0_10px_30px_rgba(15,23,42,0.2)]"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
