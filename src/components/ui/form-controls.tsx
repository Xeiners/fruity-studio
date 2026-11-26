import * as React from "react";
import { Label as LabelPrimitive, Switch as SwitchPrimitive, Slider as SliderPrimitive, Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

const fieldBase =
  "w-full min-w-0 rounded-md border border-input bg-surface px-3 text-[13.5px] text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 focus-visible:border-ring/70 focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/15";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldBase, "h-9 py-1", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-[12.5px] font-medium text-foreground/90 select-none peer-disabled:opacity-50", className)}
      {...props}
    />
  );
}

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground dark:bg-foreground" />
    </SwitchPrimitive.Root>
  );
}

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const count = (props.value ?? props.defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {Array.from({ length: count }).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className="block size-4 rounded-full border-2 border-primary bg-background shadow transition-[box-shadow] outline-none hover:ring-4 hover:ring-primary/15 focus-visible:ring-4 focus-visible:ring-primary/25"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-muted-foreground/50 bg-surface outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Champ de formulaire : libelle + aide + erreur. */
function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
  aside,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-orange">*</span>}
        </Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export { Input, Textarea, Label, Switch, Slider, Checkbox, Field };
