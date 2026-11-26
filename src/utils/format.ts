/** Formatage des valeurs affichees (francais). */

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const relativeFormatter = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormatter.format(d);
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const seconds = Math.round((d - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 7) return relativeFormatter.format(Math.round(seconds / 86400), "day");
  return formatDate(iso);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** 9.5 -> "9,5 s" ; 75 -> "1 min 15 s" */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${rounded.toLocaleString("fr-FR")} s`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  return ms == null ? "—" : formatSeconds(ms / 1000);
}

/** Timecode court : 00:09 */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count > 1 ? (plural ?? `${singular}s`) : singular}`;
}

export function padClip(n: number): string {
  return String(n).padStart(2, "0");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
