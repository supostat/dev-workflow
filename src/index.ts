// Public package surface for `@engramm/dev-workflow`.
//
// Only the communication-profile integration API is re-exported here.
// Every other module (vault readers/writers, the workflow engine, the task
// manager, the MCP server, the engram bridge, etc.) is internal — consumed
// through the `dev-workflow` CLI and MCP server, not imported directly — and
// is deliberately NOT part of the public surface.

export { loadCommunicationConfig } from "./lib/communication.js";
export { getActiveProfile, setActiveProfile, clearActiveProfile } from "./lib/communication-state.js";

export type {
  CommunicationProfile,
  CommunicationConfig,
  ToneType,
  VerbosityType,
  ExpertiseType,
  LanguageType,
  OutputType,
} from "./lib/types.js";
