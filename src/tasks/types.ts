export type TaskStatus =
  | "pending"
  | "in-progress"
  | "review"
  | "done"
  | "blocked";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  branch: string | null;
  workflowRun: string | null;
  created: string;
  updated: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  branch?: string;
}
