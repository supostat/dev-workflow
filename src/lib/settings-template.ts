import { join } from "node:path";
import { PACKAGE_ROOT } from "./package-root.js";

export function buildSettingsJson(): string {
  const distDir = join(PACKAGE_ROOT, "dist");
  const hookBase = join(distDir, "hooks");
  const statuslinePath = join(distDir, "lib", "statusline.js");
  return JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/session-start.js`,
          timeout: 10000,
        }],
      }],
      SessionEnd: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/session-end.js`,
          timeout: 10000,
        }],
      }],
      TaskCompleted: [{
        hooks: [{
          type: "command",
          command: `node ${hookBase}/post-task.js`,
          timeout: 5000,
        }],
      }],
    },
    permissions: {
      allow: [
        "Read",
        "Edit",
        "Write",
        "Bash(npm test)",
        "Bash(npm run *)",
        "Bash(npx *)",
        "Bash(pnpm test)",
        "Bash(pnpm run *)",
        "Bash(node *)",
        "Bash(git status*)",
        "Bash(git diff*)",
        "Bash(git log*)",
        "Bash(git branch*)",
        "Bash(git add *)",
        "Bash(git commit *)",
        "Bash(git stash *)",
        "Bash(ls *)",
        "Bash(cat *)",
        "Bash(pwd)",
        "Bash(wc *)",
        "Agent",
        "mcp__dev-workflow__*",
      ],
      deny: [
        "Read(./.env)",
        "Read(./.env.*)",
        "Bash(git push *)",
        "Bash(git reset --hard*)",
        "Bash(rm -rf *)",
      ],
    },
    statusLine: {
      type: "command",
      command: `node ${statuslinePath}`,
    },
  }, null, 2);
}
