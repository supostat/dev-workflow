import Link from "next/link";

const PIPELINE_STEPS = [
  { name: "PREFLIGHT", type: "bash", detail: "baseline" },
  { name: "READ", type: "Explore", detail: "read-only" },
  { name: "PLAN", type: "Explore", detail: "pseudo-code" },
  { name: "PLAN_REVIEW", type: "Explore", detail: "9 criteria" },
  { name: "CODER", type: "Full", detail: "test-first" },
  { name: "REVIEW\u00d73", type: "Explore\u00d73", detail: "parallel" },
  { name: "FIX", type: "Full", detail: "max 3" },
  { name: "TEST", type: "bash", detail: "mandatory" },
  { name: "VERIFY", type: "Explore", detail: "task match" },
  { name: "COMMIT", type: "Full", detail: "git only" },
] as const;

const REVIEWERS = [
  {
    title: "Security",
    color: "text-red-400",
    border: "border-red-500/30",
    checks: ["OWASP Top 10", "Injection, XSS", "Hardcoded secrets", "Auth / AuthZ", "Input validation"],
  },
  {
    title: "Quality",
    color: "text-blue-400",
    border: "border-blue-500/30",
    checks: ["Single Responsibility", "Dependency direction", "Conventions", "Architecture layers", "Dead code, DRY"],
  },
  {
    title: "Coverage",
    color: "text-green-400",
    border: "border-green-500/30",
    checks: ["Happy path", "Edge cases", "Error paths", "Test isolation", "Meaningful assertions"],
  },
] as const;

const STATS = [
  { value: "10", label: "шагов pipeline" },
  { value: "3", label: "reviewer-а параллельно" },
  { value: "9", label: "критериев плана" },
  { value: "13", label: "MCP tools" },
  { value: "5", label: "хуков автоматики" },
] as const;

export default function HomePage() {
  return (
    <main className="flex flex-col">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 pt-32 pb-24 text-center">
        <p className="mb-4 text-sm font-mono tracking-widest uppercase text-fd-muted-foreground animate-fade-in-up">
          workflow engine for Claude Code
        </p>
        <h1 className="mb-6 text-5xl md:text-7xl font-bold tracking-tight animate-fade-in-up animate-delay-100">
          10 агентов.
          <br />
          <span className="text-fd-muted-foreground">0 импровизаций.</span>
        </h1>
        <p className="mb-10 max-w-2xl text-lg text-fd-muted-foreground animate-fade-in-up animate-delay-200">
          Мульти-агентный pipeline для Claude Code. Каждая задача проходит через
          quality gates — от спецификации до коммита. Код проверяется тремя
          специализированными reviewer-ами параллельно.
        </p>
        <div className="flex gap-4 animate-fade-in-up animate-delay-300">
          <Link
            href="/docs"
            className="rounded-lg bg-white text-black px-8 py-3 font-medium hover:bg-neutral-200 transition-colors"
          >
            Документация
          </Link>
          <Link
            href="/docs/guides/new-project"
            className="rounded-lg border border-neutral-700 px-8 py-3 font-medium hover:border-neutral-500 transition-colors"
          >
            Quick Start
          </Link>
        </div>

        {/* Pipeline visualization */}
        <div className="mt-20 flex flex-wrap justify-center gap-1 md:gap-0 max-w-4xl animate-fade-in-up animate-delay-400">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.name} className="flex items-center">
              <div className="pipeline-step flex flex-col items-center px-2 md:px-3 py-2">
                <span className="text-[10px] md:text-xs font-mono text-fd-muted-foreground">
                  {step.type}
                </span>
                <span className="text-xs md:text-sm font-mono font-bold mt-1">
                  {step.name}
                </span>
                <span className="text-[10px] md:text-xs text-fd-muted-foreground mt-1">
                  {step.detail}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <span className="text-fd-muted-foreground/30 font-mono hidden md:inline">
                  {"\u2192"}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="px-4 py-24 border-t border-neutral-800">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold mb-8 text-red-400/80">
              Без протокола
            </h2>
            <ul className="space-y-4 text-fd-muted-foreground">
              {[
                "Claude импровизирует порядок действий",
                "Пропускает ревью и тесты",
                "Один агент делает всё в одном контексте",
                "Теряет контекст между сессиями",
                "Код не проверяется на соответствие задаче",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-red-500 shrink-0">{"\u00d7"}</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-8 text-green-400/80">
              С dev-workflow
            </h2>
            <ul className="space-y-4 text-fd-muted-foreground">
              {[
                "Жёсткий протокол из 10 шагов с quality gates",
                "TEST и REVIEW — обязательные gates перед коммитом",
                "3 специализированных reviewer-а параллельно",
                "Vault сохраняет контекст между сессиями",
                "VERIFY сверяет результат с оригинальной задачей",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-green-500 shrink-0">{"\u2713"}</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 3 Reviewers */}
      <section className="px-4 py-24 border-t border-neutral-800">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">3 reviewer-а параллельно</h2>
          <p className="text-fd-muted-foreground mb-12 max-w-xl mx-auto">
            Один reviewer бегло по всему. Три специалиста — глубоко в своей
            области. Каждый получает реальный git diff, не самоотчёт.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {REVIEWERS.map((reviewer) => (
              <div
                key={reviewer.title}
                className={`rounded-xl border ${reviewer.border} bg-neutral-900/50 p-6 text-left`}
              >
                <h3 className={`text-lg font-bold mb-4 ${reviewer.color}`}>
                  {reviewer.title}
                </h3>
                <ul className="space-y-2 text-sm text-fd-muted-foreground">
                  {reviewer.checks.map((check) => (
                    <li key={check} className="flex gap-2">
                      <span className={reviewer.color}>&#x2022;</span>
                      {check}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 Flows */}
      <section className="px-4 py-24 border-t border-neutral-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-12 text-center">
            От задачи до коммита
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="rounded-xl border border-neutral-800 p-6">
              <div className="text-sm font-mono text-fd-muted-foreground mb-2">
                Новый проект
              </div>
              <div className="font-mono text-sm space-y-2">
                <div>
                  SPEC.md <span className="text-fd-muted-foreground">{"\u2192"}</span>
                </div>
                <div className="text-blue-400">/vault:from-spec</div>
                <div>
                  vault filled{" "}
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>
                </div>
                <div className="text-blue-400">/workflow:dev phase-1.md</div>
                <div>
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>{" "}
                  <span className="text-green-400">commit</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-neutral-800 p-6">
              <div className="text-sm font-mono text-fd-muted-foreground mb-2">
                Существующий проект
              </div>
              <div className="font-mono text-sm space-y-2">
                <div className="text-blue-400">/vault:analyze</div>
                <div>
                  vault filled{" "}
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>
                </div>
                <div className="text-blue-400">
                  /workflow:dev {'"'}задача{'"'}
                </div>
                <div>
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>{" "}
                  <span className="text-green-400">commit</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-neutral-800 p-6">
              <div className="text-sm font-mono text-fd-muted-foreground mb-2">
                Swarm mode
              </div>
              <div className="font-mono text-sm space-y-2">
                <div>Orchestrator</div>
                <div>
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>{" "}
                  Agent{"\u00d7"}N
                </div>
                <div className="text-blue-400">
                  /workflow:dev --auto-commit
                </div>
                <div>
                  <span className="text-fd-muted-foreground">{"\u2192"}</span>{" "}
                  <span className="text-green-400">commits</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-4 py-24 border-t border-neutral-800">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-8 text-center">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <div className="text-4xl md:text-5xl font-bold">{stat.value}</div>
              <div className="text-sm text-fd-muted-foreground mt-2">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-24 border-t border-neutral-800 text-center">
        <h2 className="text-3xl font-bold mb-4">Начать</h2>
        <p className="text-fd-muted-foreground mb-8 max-w-md mx-auto">
          3 команды до первого pipeline.
        </p>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 max-w-lg mx-auto text-left font-mono text-sm mb-8">
          <div className="text-fd-muted-foreground"># установка</div>
          <div>npm link</div>
          <div className="text-fd-muted-foreground mt-3"># инициализация</div>
          <div>dev-workflow init</div>
          <div className="text-fd-muted-foreground mt-3"># первый pipeline</div>
          <div>
            /workflow:dev{" "}
            <span className="text-fd-muted-foreground">
              {'"'}моя задача{'"'}
            </span>
          </div>
        </div>
        <div className="flex gap-4 justify-center">
          <Link
            href="/docs"
            className="rounded-lg bg-white text-black px-8 py-3 font-medium hover:bg-neutral-200 transition-colors"
          >
            Документация
          </Link>
          <Link
            href="/docs/quality/pipeline"
            className="rounded-lg border border-neutral-700 px-8 py-3 font-medium hover:border-neutral-500 transition-colors"
          >
            Quality Pipeline
          </Link>
        </div>
      </section>
    </main>
  );
}
