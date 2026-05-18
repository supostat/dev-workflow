"use client";

// "New task" dialog — a react-hook-form with a required title and an optional
// description. Priority and branch inputs the task-056 spec lists are omitted:
// the web API's `createTask` accepts only `{title, description}`, so wiring
// those fields would silently drop them — a half-built form. They are deferred
// (debt #2). On submit the parent persists the task and re-fetches the list.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
});

/** Validated new-task form values. */
export type NewTaskValues = z.infer<typeof taskSchema>;

interface NewTaskDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open/close the dialog. */
  onOpenChange: (open: boolean) => void;
  /** Persist the validated task; resolves once the create + re-fetch settle. */
  onSubmit: (values: NewTaskValues) => Promise<void>;
}

/** Modal form for creating a task through `POST /api/tasks`. */
export function NewTaskDialog({ open, onOpenChange, onSubmit }: NewTaskDialogProps) {
  const form = useForm<NewTaskValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", description: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">New task</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Creates a task file under `.dev-vault/tasks/` with generated frontmatter.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Short task title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional details"
                      className="min-h-24"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating…" : "Create task"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
