/**
 * Parse a context-size string like "20000", "20k", "20 K", "3x20k", "3 x 20k" → number.
 */
export function parseContextSize(raw: string | number): number {
  if (typeof raw === "number") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  // Split on optional multiplier prefix: "Nx" or "N x"
  const parts = trimmed.split(/\s*x\s*/i);

  let multiplier = 1;
  let valuePart: string;

  if (parts.length >= 2) {
    const m = parts[0].trim();
    if (m) {
      multiplier = parseInt(m, 10);
      if (isNaN(multiplier) || multiplier < 1) multiplier = 1;
    }
    valuePart = parts.slice(1).join("").trim();
  } else {
    valuePart = trimmed;
  }

  // Parse value + unit suffix
  const match = valuePart.match(/^(\d+)\s*([kKmM])?$/);
  if (!match) return 0;

  let value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit) {
    if (unit.toLowerCase() === "k") value *= 1024;
    else if (unit.toLowerCase() === "m") value *= 1024 * 1024;
  }

  return multiplier * value;
}

/**
 * Preset context-size values (in tokens).
 */
export const CONTEXT_PRESETS = [8192, 16384, 32768, 65536, 98304, 131072, 196608, 262144, 524288, 1048576];

/**
 * Format a raw token count into a short label like "20K", "1M".
 */
export function formatShort(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1048576) {
    const m = n / 1048576;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 1024) {
    const k = n / 1024;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return `${n}`;
}

/**
 * Format a raw token count for display in the dialog.
 * If slots > 1 and n is evenly divisible by slots and the quotient is a known preset → "N x 16K".
 * Otherwise → short form.
 */
export function formatContextSize(n: number, slots: number): string {
  if (n <= 0) return "";

  if (slots > 1 && n % slots === 0) {
    const perSlot = n / slots;
    if (CONTEXT_PRESETS.includes(perSlot)) {
      return `${slots} x ${formatShort(perSlot)}`;
    }
  }

  return formatShort(n);
}
