import { useCallback } from "react";
import { useSettings, useUpdateSettings } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import type { ThemePreference } from "@/types";

/** Change le theme et le memorise dans les parametres (base locale). */
export function useSetTheme() {
  const { setPreference } = useTheme();
  const { data: settings } = useSettings();
  const { mutate } = useUpdateSettings();
  return useCallback(
    (pref: ThemePreference) => {
      setPreference(pref);
      if (settings && settings.theme !== pref) mutate({ ...settings, theme: pref });
    },
    [setPreference, settings, mutate],
  );
}
