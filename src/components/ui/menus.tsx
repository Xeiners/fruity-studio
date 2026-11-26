import * as React from "react";
import {
  DropdownMenu as DropdownMenuPrimitive,
  Select as SelectPrimitive,
  Tooltip as TooltipPrimitive,
  Popover as PopoverPrimitive,
} from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";

const popoverSurface =
  "z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl shadow-black/20 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

// --- DropdownMenu -----------------------------------------------------------

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(popoverSurface, "min-w-48 p-1", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2.5 py-1.5 text-eyebrow", className)} {...props} />;
}

// --- Select ------------------------------------------------------------------

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-[13.5px] whitespace-nowrap transition-[border-color,box-shadow] outline-none hover:border-muted-foreground/40 focus-visible:border-ring/70 focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          popoverSurface,
          "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, hint, ...props }: React.ComponentProps<typeof SelectPrimitive.Item> & { hint?: string }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default items-center rounded-md py-1.5 pr-8 pl-2.5 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      <span className="absolute right-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-primary-strong" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

// --- Tooltip -----------------------------------------------------------------

function TooltipProvider(props: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150} {...props} />;
}

function Tooltip({
  content,
  children,
  side = "top",
  shortcut,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {content}
          {shortcut && (
            <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px] text-muted-foreground">
              {shortcut}
            </kbd>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// --- Popover -----------------------------------------------------------------

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(popoverSurface, "w-72 p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  TooltipProvider,
  Tooltip,
  Popover,
  PopoverTrigger,
  PopoverContent,
};
