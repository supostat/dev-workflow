import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";

export function status(): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const reader = new VaultReader(context);

  console.log(`Project:  ${context.projectName}`);
  console.log(`Branch:   ${context.branch}`);
  console.log(`Parent:   ${context.parentBranch}`);
  console.log(`Vault:    ${context.vaultPath}`);
  console.log(`Exists:   ${reader.exists() ? "yes" : "no"}`);

  if (!reader.exists()) {
    console.log(`\nRun 'dev-vault init' to set up.`);
    return;
  }

  const files = {
    stack: reader.readStack(),
    conventions: reader.readConventions(),
    knowledge: reader.readKnowledge(),
    gameplan: reader.readGameplan(),
  };

  console.log(`\nFiles:`);
  for (const [name, content] of Object.entries(files)) {
    const status = content ? `${content.split("\n").length} lines` : "empty";
    console.log(`  ${name.padEnd(14)} ${status}`);
  }

  const branch = reader.readBranch(context.branch);
  console.log(`\nBranch context: ${branch ? branch.status : "none"}`);

  const logs = reader.readRecentDailyLogs(3);
  console.log(`Daily logs:     ${logs.length} recent`);
  for (const log of logs) {
    console.log(`  ${log.date}`);
  }
}
