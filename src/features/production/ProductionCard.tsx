import { Link } from "react-router";
import { Clapperboard, Film } from "lucide-react";
import { AvatarStack, LocalImage } from "@/components/common/media";
import { Badge, Progress } from "@/components/ui/display";
import type { ProductionSummary } from "@/types";
import { cn } from "@/utils/cn";
import { formatRelative, formatSeconds } from "@/utils/format";
import { PRODUCTION_STATE_LABEL, PRODUCTION_STATE_TONE, productionState } from "@/utils/status";

function ThumbnailFallback({ production }: { production: ProductionSummary }) {
  const color = production.characters[0]?.color ?? "#B7F36B";
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden" style={{ backgroundImage: `radial-gradient(circle at 50% 42%, ${color}33, transparent 70%)` }}>
      <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:14px_14px]" />
      <div className="flex flex-col items-center gap-3">
        <AvatarStack characters={production.characters} size={40} max={3} />
        <Clapperboard className="size-4 text-muted-foreground" strokeWidth={1.75} />
      </div>
    </div>
  );
}

export function ProductionCard({ production, className }: { production: ProductionSummary; className?: string }) {
  const state = productionState(production);
  const pct = production.clipCount ? (production.importedCount / production.clipCount) * 100 : 0;
  const total = production.clipCount * production.clipDuration;
  return (
    <Link
      to={`/productions/${production.id}`}
      data-slot="card"
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/35 hover:shadow-lg hover:shadow-black/10 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden border-b border-border bg-surface">
        {production.previewThumbnail ? (
          <LocalImage
            path={production.previewThumbnail}
            alt={production.title}
            className="size-full transition-transform duration-500 group-hover:scale-[1.03]"
            fallback={<ThumbnailFallback production={production} />}
          />
        ) : (
          <ThumbnailFallback production={production} />
        )}
        <div className="absolute top-2.5 left-2.5">
          <Badge variant={PRODUCTION_STATE_TONE[state]} dot className="bg-popover/90 backdrop-blur">
            {PRODUCTION_STATE_LABEL[state]}
          </Badge>
        </div>
        {production.status === "rendered" && (
          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10.5px] text-white">
            <Film className="size-3" /> MP4
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold tracking-tight">{production.title}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {production.clipCount > 0 ? `${production.clipCount} clips · ${formatSeconds(total)}` : "Sans histoire"} ·{" "}
            {formatRelative(production.updatedAt)}
          </p>
        </div>
        {production.clipCount > 0 && production.status !== "rendered" && (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="h-1" />
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {production.importedCount}/{production.clipCount}
            </span>
          </div>
        )}
        <div className="mt-auto">
          <AvatarStack characters={production.characters} size={22} />
        </div>
      </div>
    </Link>
  );
}
