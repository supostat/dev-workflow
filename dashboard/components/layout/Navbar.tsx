import Link from "next/link";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ProjectSwitcher } from "@/components/layout/ProjectSwitcher";
import { RefreshButton } from "@/components/layout/RefreshButton";

/**
 * Top navbar shell — the Dashboard Grid layout uses a navbar only, no
 * sidebar. A server component: the brand, the page nav links, and the static
 * structure are server-rendered; the interactive project switcher, refresh
 * button, and theme toggle are `"use client"` islands composed in here.
 */
const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/vault", label: "Vault" },
  { href: "/tasks", label: "Tasks" },
  { href: "/workflow", label: "Workflow" },
  { href: "/engram", label: "Engram" },
  { href: "/settings", label: "Settings" },
];

export function Navbar() {
  return (
    <header className="border-b border-border">
      <nav className="flex h-14 items-center gap-6 px-6">
        <span className="font-semibold">dev-workflow</span>
        <ProjectSwitcher />
        <ul className="flex items-center gap-4 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1">
          <RefreshButton />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
