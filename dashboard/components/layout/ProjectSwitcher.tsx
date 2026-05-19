"use client";

// Navbar project switcher — a dropdown over the registered projects. The
// active project and the registry list both come from `ProjectContext`; the
// provider keeps the list live via its `/events/projects` SSE subscription, so
// a project added in Settings appears here without a reload. Selecting a
// project PUTs `/api/projects/active` through the context, which also fans the
// change out to other tabs over SSE.

import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveProject } from "@/lib/project-context";

/** Dropdown that lists registry projects and switches the active one. */
export function ProjectSwitcher() {
  const { activeProject, projects, setActiveProject } = useActiveProject();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <span className="max-w-40 truncate">{activeProject ?? "Select project"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>No projects registered</DropdownMenuItem>
        ) : (
          projects.map((name) => (
            <DropdownMenuItem
              key={name}
              onClick={() => void setActiveProject(name)}
              className="gap-2"
            >
              <Check
                className={name === activeProject ? "h-4 w-4" : "h-4 w-4 opacity-0"}
              />
              {name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
