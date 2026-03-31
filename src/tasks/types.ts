export type TaskStatus =
  | "pending"
  | "in-progress"
  | "review"
  | "done"
  | "blocked";

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  branch: string | null;
  workflowRun: string | null;
  created: string;
  updated: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  branch?: string;
}
