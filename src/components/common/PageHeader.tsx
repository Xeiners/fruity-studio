import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/utils/cn";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4 animate-rise", className)}>
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="mb-1.5 text-eyebrow">{eyebrow}</div>}
        <h1 className="truncate text-[26px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Conteneur standard des pages. */
export function Page({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-8 px-8 py-8 xl:px-10", wide ? "max-w-[1680px]" : "max-w-[1320px]", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
