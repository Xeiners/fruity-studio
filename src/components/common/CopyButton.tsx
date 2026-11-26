import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { isTauri } from "@/services/storage/invoke";

export async function copyToClipboard(text: string): Promise<void> {
  if (isTauri()) {
    try {
      await writeText(text);
      return;
    } catch {
      /* repli sur l'API du navigateur */
    }
  }
  await navigator.clipboard.writeText(text);
}

export function CopyButton({
  text,
  label = "Copier",
  copiedLabel = "Copié",
  toastMessage,
  ...props
}: Omit<ButtonProps, "onClick"> & { text: string; label?: string; copiedLabel?: string; toastMessage?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      {...props}
      onClick={async () => {
        try {
          await copyToClipboard(text);
          setCopied(true);
          if (toastMessage) toast.success(toastMessage);
        } catch {
          toast.error("Copie impossible", { description: "Le presse-papiers n'est pas accessible." });
        }
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
