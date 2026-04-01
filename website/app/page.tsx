import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-4 text-4xl font-bold">dev-workflow</h1>
      <p className="mb-8 max-w-lg text-lg text-fd-muted-foreground">
        Workflow engine с агентами и vault для Claude Code.
        Мульти-агентный pipeline от спецификации до коммита.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-6 py-3 text-fd-primary-foreground font-medium"
        >
          Документация
        </Link>
        <Link
          href="/docs/guides/new-project"
          className="rounded-lg border border-fd-border px-6 py-3 font-medium"
        >
          Quick Start
        </Link>
      </div>
    </main>
  );
}
