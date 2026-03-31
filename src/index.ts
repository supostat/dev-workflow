export { detectContext } from "./lib/context.js";
export { VaultReader } from "./lib/reader.js";
export { VaultWriter } from "./lib/writer.js";
export { renderTemplate } from "./lib/templates.js";
export { interpolate } from "./lib/interpolate.js";
export { parseFrontmatter, serializeFrontmatter } from "./lib/frontmatter.js";
export { readFileOrNull, writeFileSafe, slugify, todayDate } from "./lib/fs-helpers.js";
export { AgentRegistry } from "./agents/registry.js";
export { AgentContextBuilder } from "./agents/context-builder.js";
export { parseAgentFile } from "./agents/loader.js";

export type { ProjectContext, VaultData, DailyLog, BranchContext } from "./lib/types.js";
export type { Frontmatter } from "./lib/frontmatter.js";
export type { AgentDefinition, PreparedAgent, AgentPermissions, VaultSection, GitOperation } from "./agents/types.js";
