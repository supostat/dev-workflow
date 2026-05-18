// Recent-memories panel for the Engram page — the five most recent entries
// from `stats.live.topMemories`. The server types that field as `unknown[]`
// (the dashboard does not own the engram memory contract), so each element is
// narrowed by a structural guard keyed off the concrete `EngramMemory` fields
// before render. Server component: presentational only, no hooks.

import { Panel } from "@/components/layout/Panel";
import { Badge } from "@/components/ui/badge";
import type { EngramStatsResponse } from "@/lib/api";

/** Maximum memories shown — `topMemories` is already short, this is a guard. */
const MAX_MEMORIES = 5;

/**
 * One engram memory — mirrors `EngramMemory` (src/lib/engram.ts). Declared
 * locally because the dashboard receives `topMemories` as `unknown[]`.
 */
interface EngramMemory {
  id: string;
  memory_type: string;
  context: string;
  action: string;
  result: string;
  score: number;
  tags: string;
  project: string;
}

/** Structural guard narrowing an opaque `topMemories` element to `EngramMemory`. */
function isEngramMemory(value: unknown): value is EngramMemory {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["memory_type"] === "string" &&
    typeof candidate["context"] === "string" &&
    typeof candidate["action"] === "string" &&
    typeof candidate["result"] === "string" &&
    typeof candidate["score"] === "number" &&
    typeof candidate["tags"] === "string" &&
    typeof candidate["project"] === "string"
  );
}

/** Last five engram memories, or an empty state when none are present. */
export function RecentMemories({ stats }: { stats: EngramStatsResponse }) {
  const memories = stats.live.topMemories.filter(isEngramMemory).slice(0, MAX_MEMORIES);
  return (
    <Panel title="Recent memories">
      {memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No memories.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One memory row — type badge, score, and the memory context line. */
function MemoryRow({ memory }: { memory: EngramMemory }) {
  return (
    <li className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{memory.memory_type}</Badge>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          score {memory.score.toFixed(1)}
        </span>
      </div>
      <p className="mt-1 text-sm">{memory.context}</p>
    </li>
  );
}
