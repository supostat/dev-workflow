/**
 * Overview route — the dashboard entry point. This scaffold ships the real
 * page shell (heading + orientation copy rendered through the design tokens
 * inside the App Router layout). The KPI strip, activity feed, and side
 * panels described by the design-system ADR are built in task-056.
 *
 * A concrete `app/` route is required: without it Next.js static export
 * compiles only the Pages Router 404 and never reaches the App Router tree,
 * so the layout, fonts, and globals.css token bundle would be absent from
 * the export.
 */
export default function OverviewPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 text-muted-foreground">
        Local observability for your dev-workflow projects. Vault sections,
        tasks, workflow runs, and engram activity surface here once a project
        is selected from the navbar.
      </p>
      <p className="mt-4 font-mono text-sm text-muted-foreground">
        dev-workflow web — 127.0.0.1
      </p>
    </section>
  );
}
