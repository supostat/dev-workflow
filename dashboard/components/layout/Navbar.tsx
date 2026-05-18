import Link from "next/link";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

/**
 * Top navbar shell — the Dashboard Grid layout uses a navbar only, no
 * sidebar. The project switcher dropdown and live tools land in task-056;
 * this scaffold ships the static structure: brand, page nav links, theme
 * toggle.
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
        <ul className="flex items-center gap-4 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
