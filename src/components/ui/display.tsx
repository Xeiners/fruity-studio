import * as React from "react";
import { Tabs as TabsPrimitive, Progress as ProgressPrimitive, Separator as SeparatorPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

// --- Card ----------------------------------------------------------------------

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[13.5px] font-semibold tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[12.5px] text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

// --- Badge -----------------------------------------------------------------------

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        lime: "border-transparent bg-lime-soft text-primary-strong",
        orange: "border-transparent bg-orange-soft text-orange",
        success: "border-transparent bg-success/12 text-success",
        warning: "border-transparent bg-warning/12 text-warning",
        destructive: "border-transparent bg-destructive/12 text-destructive",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, dot, children, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// --- Tabs ------------------------------------------------------------------------

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none data-[state=active]:animate-fade-in", className)} {...props} />;
}

// --- Progress --------------------------------------------------------------------

function Progress({ className, value, indicatorClassName, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-input", className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        className={cn("h-full rounded-full bg-primary transition-[width] duration-300 ease-out", indicatorClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

// --- Separator / Skeleton / Kbd ----------------------------------------------------

function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("skeleton-shimmer rounded-md", className)} {...props} />;
}

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface px-1 font-mono text-[10.5px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  badgeVariants,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Progress,
  Separator,
  Skeleton,
  Kbd,
};
