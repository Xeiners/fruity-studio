import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { errorMessage } from "@/services/storage/invoke";
import { cn } from "@/utils/cn";

/** Etat vide elegant : icone, titre, explication, action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border text-center animate-fade-in",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-8 py-16",
        className,
      )}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-2xl" />
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-border bg-card text-primary-strong",
            compact ? "size-10" : "size-12",
          )}
        >
          <Icon className={compact ? "size-5" : "size-6"} strokeWidth={1.75} />
        </div>
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className={cn("font-semibold tracking-tight", compact ? "text-[13.5px]" : "text-[15px]")}>{title}</p>
        {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center", className)}>
      <AlertTriangle className="size-6 text-destructive" strokeWidth={1.75} />
      <div>
        <p className="font-semibold">Impossible de charger ces données</p>
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground" data-selectable>
          {errorMessage(error)}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Réessayer
        </Button>
      )}
    </div>
  );
}

export function GridSkeleton({ count = 6, className, itemClassName }: { count?: number; className?: string; itemClassName?: string }) {
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("h-56 rounded-xl", itemClassName)} />
      ))}
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-border bg-surface text-foreground [&_.notice-icon]:text-muted-foreground",
    warning: "border-warning/30 bg-warning/8 [&_.notice-icon]:text-warning",
    danger: "border-destructive/30 bg-destructive/8 [&_.notice-icon]:text-destructive",
    success: "border-success/30 bg-success/8 [&_.notice-icon]:text-success",
  } as const;
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[13px]", tones[tone], className)}>
      {Icon && <Icon className="notice-icon mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("leading-relaxed text-muted-foreground", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
