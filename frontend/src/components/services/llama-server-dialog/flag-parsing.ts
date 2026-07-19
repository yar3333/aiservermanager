/** Extract value for a flag from the flags array. Supports three formats:
 *  - Separate tokens: ["--flag", "value", ...]
 *  - Single string with space: ["--flag value", ...]
 *  - Single string with equals: ["--flag=value", ...]
 */
export function findFlag(flags: string[], name: string): string | null {
  for (const entry of flags) {
    // "--flag=value"
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0 && entry.slice(0, eqIdx) === name) {
      return entry.slice(eqIdx + 1);
    }
    // "--flag value" (space-separated in a single string)
    const spIdx = entry.indexOf(" ");
    if (spIdx > 0 && entry.slice(0, spIdx) === name) {
      return entry.slice(spIdx + 1).trim();
    }
  }
  // Separate tokens fallback: ["--flag", "value"]
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === name && i + 1 < flags.length) {
      return flags[i + 1];
    }
  }
  return null;
}

/** Check if a boolean flag is present. For negation pairs, checks both variants.
 *  Handles both standalone flags ["--flag"] and combined ["--flag on"].
 */
export function flagBool(flags: string[], positive: string, negative: string, fallback: boolean): boolean {
  for (const entry of flags) {
    const key = entry.split(/\s|=/)[0];
    if (key === positive) return true;
    if (key === negative) return false;
  }
  return fallback;
}

export function flagValueStr(flags: string[], flag: string, fallback: string): string {
  const val = findFlag(flags, flag);
  return val !== null ? val : fallback;
}

export function flagValueNum(flags: string[], flag: string, fallback: number): number {
  const val = findFlag(flags, flag);
  if (val !== null) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export function flagValueFloat(flags: string[], flag: string, fallback: number): number {
  const val = findFlag(flags, flag);
  if (val !== null) {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}
