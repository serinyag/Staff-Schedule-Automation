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
    <div className="flex flex-wrap gap-1 lg:flex-col">
      {items.map((item) => {
        const isActive = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium transition",
              isActive
                ? "bg-slate-900 text-white"
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
