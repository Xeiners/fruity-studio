import { cn } from "@/utils/cn";
import { formatTimecode } from "@/utils/format";

/** Representation visuelle du decoupage : N segments de duree fixe. */
export function ClipTimeline({ clipCount, clipDuration, className }: { clipCount: number; clipDuration: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex gap-1">
        {Array.from({ length: clipCount }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex h-8 flex-1 items-center justify-center rounded-md border font-mono text-[11px]",
              i === 0 ? "border-primary/50 bg-lime-soft text-primary-strong" : i === clipCount - 1 ? "border-orange/40 bg-orange-soft text-orange" : "border-border bg-surface text-muted-foreground",
            )}
            title={i === 0 ? "Accroche" : i === clipCount - 1 ? "Chute" : undefined}
          >
            {String(i + 1).padStart(2, "0")}
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground">
        <span>00:00</span>
        <span>{formatTimecode(clipCount * clipDuration)}</span>
      </div>
    </div>
  );
}
