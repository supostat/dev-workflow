import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: {
    template: "%s | dev-workflow",
    default: "dev-workflow",
  },
  description: "Development workflow engine with agents and vault for Claude Code",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
