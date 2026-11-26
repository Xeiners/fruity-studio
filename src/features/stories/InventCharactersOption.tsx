import { useState } from "react";
import { Checkbox } from "@/components/ui/form-controls";
import { cn } from "@/utils/cn";

/** Case « Ajouter d'autres personnages », utilisee a la creation et a la regeneration. */
export function InventCharactersOption({
  defaultChecked = false,
  onChange,
  disabled,
}: {
  defaultChecked?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color]",
        checked ? "border-primary/70 bg-lime-soft ring-1 ring-primary/40" : "border-border bg-surface/60 hover:border-muted-foreground/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => {
          setChecked(value === true);
          onChange(value === true);
        }}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">Ajouter d'autres personnages</span>
        <span className="text-[12px] leading-snug text-muted-foreground">
          Gemini invente des fruits au hasard qui arrivent au fil de l'histoire et créent la scène comique avec votre casting : rivalité, pièges, courses-poursuites et répliques.
        </span>
      </span>
    </label>
  );
}
