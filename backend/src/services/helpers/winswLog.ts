import { JournalLine } from "../serviceController";

/**
 * "2026-11-06 23:02:13,678" — the stamp WinSW puts in front of its own status
 * log lines. The time is local to the machine that wrote the file.
 */
const LEADING_TIMESTAMP_REGEX = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s+(.*)$/;

/**
 * Split one WinSW log line into a journal entry.
 *
 * Lines WinSW wrote itself already carry the time of the event, so that stamp is
 * used and dropped from the message; raw program output has no stamp at all and
 * falls back to the log file's modification time — the only thing available.
 * Without this the panel shows the file's mtime in front of every line of the
 * wrapper log, next to the timestamp already inside the message.
 */
export function parseWinSwLogLine(line: string, fileTimestampIso: string): JournalLine {
  const match = LEADING_TIMESTAMP_REGEX.exec(line);
  if (!match) return { timestamp: fileTimestampIso, message: line };

  const [, year, month, day, hour, minute, second, fraction, rest] = match;
  const stamp = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0")),
  );
  if (Number.isNaN(stamp.getTime())) return { timestamp: fileTimestampIso, message: line };

  return { timestamp: stamp.toISOString(), message: rest };
}
