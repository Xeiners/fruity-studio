import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/services/storage/invoke";
import type { ThemePreference } from "@/types";

const STORAGE_KEY = "fruity-theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: "dark" | "light";
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "system" || v === "dark" ? v : "dark";
  } catch {
    return "dark";
  }
}

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "dark" | "light" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    if (isTauri()) {
      // Barre de titre Windows assortie au theme.
      void getCurrentWindow()
        .setTheme(preference === "system" ? null : resolved)
        .catch(() => undefined);
    }
  }, [resolved, preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      window.localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* stockage indisponible : le theme reste applique pour la session */
    }
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans ThemeProvider");
  return ctx;
}
