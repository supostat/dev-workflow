import { countTokens as tokenizeText } from "@anthropic-ai/tokenizer";
import { hashString } from "./spec-hash.js";

const CACHE_CAPACITY = 200;
const tokenCountCache = new Map<string, number>();

export function countTokens(text: string): number {
  const key = hashString(text);

  const cached = tokenCountCache.get(key);
  if (cached !== undefined) {
    tokenCountCache.delete(key);
    tokenCountCache.set(key, cached);
    return cached;
  }

  const count = tokenizeText(text);
  tokenCountCache.set(key, count);
  if (tokenCountCache.size > CACHE_CAPACITY) {
    tokenCountCache.delete(tokenCountCache.keys().next().value!);
  }
  return count;
}

export interface SectionTokenCounts {
  sections: Record<string, number>;
  total: number;
}

export function countSections(sections: Record<string, string>): SectionTokenCounts {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [name, content] of Object.entries(sections)) {
    const count = countTokens(content);
    counts[name] = count;
    total += count;
  }
  return { sections: counts, total };
}
