"use client";

import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Compass,
  Menu,
  MessageSquare,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const GROUPS: {
  label: string;
  items: { href: string; label: string; icon: typeof Compass }[];
}[] = [
  {
    label: "Research",
    items: [
      { href: ROUTES.recommendations, label: "Your matches", icon: Compass },
      { href: ROUTES.compare, label: "Compare", icon: ChartNoAxesCombined },
      { href: ROUTES.advisor, label: "Advisor", icon: MessageSquare },
    ],
  },
  {
    label: "Your inputs",
    items: [
      { href: ROUTES.onboardingProfile, label: "Profile", icon: UserRound },
      {
        href: ROUTES.onboardingPreferences,
        label: "Priorities",
        icon: SlidersHorizontal,
      },
      {
        href: ROUTES.onboardingOccupation,
        label: "Occupation",
        icon: BriefcaseBusiness,
      },
    ],
  },
];

function currentItem(pathname: string) {
  return GROUPS.flatMap((group) => group.items)
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function WorkspaceLocation() {
  const pathname = usePathname();
  return <span>{currentItem(pathname)?.label ?? "Set up your profile"}</span>;
}

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const active = currentItem(pathname);
  const disclosure = useRef<HTMLDetailsElement>(null);

  const navigation = (
    <nav
      aria-label={mobile ? "Mobile workspace" : "Workspace"}
      className="space-y-7"
    >
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {group.label}
          </p>
          <ul className="space-y-1">
            {group.items.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active?.href === href ? "page" : undefined}
                  onClick={() => {
                    if (disclosure.current) {
                      disclosure.current.open = false;
                      disclosure.current.querySelector("summary")?.focus();
                    }
                  }}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active?.href === href
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  if (!mobile) return navigation;

  return (
    <details
      key={pathname}
      ref={disclosure}
      className="border-t px-4 py-3 lg:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && disclosure.current?.open) {
          disclosure.current.open = false;
          disclosure.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Menu aria-hidden="true" className="size-4" />
        Navigation
        <span className="ml-auto text-muted-foreground">
          {active?.label ?? "Setup"}
        </span>
      </summary>
      <div className="pt-4 pb-2">{navigation}</div>
    </details>
  );
}
