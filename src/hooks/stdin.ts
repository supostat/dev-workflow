export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  source?: string;
  compaction_trigger?: string;
  task_subject?: string;
}

export function readStdin(): Promise<HookInput> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve({});
      return;
    }

    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data) as HookInput);
      } catch {
        resolve({});
      }
    });

    setTimeout(() => resolve({}), 3000);
  });
}

export interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
}

export function hookSuccess(message: string, eventName?: string): void {
  const output: HookOutput = { continue: true };
  if (eventName && message) {
    output.hookSpecificOutput = {
      hookEventName: eventName,
      additionalContext: message,
    };
  }
  process.stdout.write(JSON.stringify(output));
}

export function hookError(message: string): void {
  process.stderr.write(message);
  process.exitCode = 2;
}
