// Unit tests for the communication.yaml form model — the serializer's
// indentation / header shape, undefined-field omission, boolean literals, and
// the zod schema's rejection of an out-of-set `expertise` value.

import { describe, expect, it } from "vitest";
import {
  communicationFormSchema,
  serializeCommunicationYaml,
  type CommunicationForm,
} from "@/components/settings/communicationYaml";

describe("serializeCommunicationYaml", () => {
  it("emits the active_profile and profiles headers at indent 0", () => {
    const yaml = serializeCommunicationYaml("senior_fast", {
      senior_fast: { language: "en" },
    });
    const lines = yaml.split("\n");
    expect(lines[0]).toBe("active_profile: senior_fast");
    expect(lines[1]).toBe("profiles:");
  });

  it("indents the profile name by 2 and its fields by 4", () => {
    const yaml = serializeCommunicationYaml("default", {
      default: { language: "ru", tone: "terse" },
    });
    expect(yaml).toContain("  default:\n");
    expect(yaml).toContain("    language: ru\n");
    expect(yaml).toContain("    tone: terse\n");
  });

  it("omits fields left undefined", () => {
    const yaml = serializeCommunicationYaml("default", {
      default: { language: "ru" },
    });
    expect(yaml).not.toContain("tone:");
    expect(yaml).not.toContain("verbosity:");
    expect(yaml).not.toContain("emojis:");
  });

  it("renders booleans as bare true / false literals", () => {
    const yaml = serializeCommunicationYaml("default", {
      default: { language: "ru", ask_before_acting: true, emojis: false },
    });
    expect(yaml).toContain("    ask_before_acting: true\n");
    expect(yaml).toContain("    emojis: false\n");
  });

  it("serializes every profile in the map", () => {
    const profiles: Record<string, CommunicationForm> = {
      one: { language: "ru" },
      two: { language: "en" },
    };
    const yaml = serializeCommunicationYaml("one", profiles);
    expect(yaml).toContain("  one:\n");
    expect(yaml).toContain("  two:\n");
  });

  it("terminates the document with a trailing newline", () => {
    const yaml = serializeCommunicationYaml("default", { default: { language: "ru" } });
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("emits only the two headers and a trailing newline for an empty profile map", () => {
    const yaml = serializeCommunicationYaml("default", {});
    expect(yaml).toBe("active_profile: default\nprofiles:\n");
  });
});

describe("communicationFormSchema", () => {
  it("accepts a profile with a valid expertise value", () => {
    const result = communicationFormSchema.safeParse({ language: "ru", expertise: "senior" });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-set expertise value", () => {
    const result = communicationFormSchema.safeParse({ language: "ru", expertise: "mid" });
    expect(result.success).toBe(false);
  });

  it("rejects a profile missing the required language field", () => {
    const result = communicationFormSchema.safeParse({ tone: "terse" });
    expect(result.success).toBe(false);
  });
});
