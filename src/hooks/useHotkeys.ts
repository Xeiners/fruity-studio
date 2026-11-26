import { useEffect, useRef } from "react";

export interface Hotkey {
  /** Ex. "mod+k", "mod+n", "mod+1", "mod+,", "escape" (mod = Ctrl, ou Cmd sur macOS). */
  combo: string;
  handler: (event: KeyboardEvent) => void;
  /** Autorise le raccourci pendant la saisie dans un champ. */
  allowInInputs?: boolean;
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const mod = parts.includes("mod");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt");
  const hasMod = event.ctrlKey || event.metaKey;
  if (mod !== hasMod || shift !== event.shiftKey || alt !== event.altKey) return false;
  return event.key.toLowerCase() === key;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function useHotkeys(hotkeys: Hotkey[]) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const hk of ref.current) {
        if (!matches(event, hk.combo)) continue;
        if (!hk.allowInInputs && isEditable(event.target)) continue;
        event.preventDefault();
        hk.handler(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
