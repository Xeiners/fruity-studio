import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useFfmpeg, useKeyStatus, useSettings } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useTheme } from "@/hooks/useTheme";
import { initRenderEvents } from "@/features/production/renderStore";
import { initFfmpegInstallEvents } from "@/features/setup/ffmpegInstallStore";
import { SetupDialog } from "@/features/setup/SetupDialog";
import { openSetup, setupDismissedThisSession, setupHiddenAtStartup } from "@/features/setup/setupStore";
import { networksApi } from "@/services/storage/networks";
import { CommandPalette } from "./CommandPalette";
import { NAV_ITEMS, Sidebar } from "./Sidebar";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const { data: settings } = useSettings();
  const { data: key } = useKeyStatus();
  const { data: ffmpeg } = useFfmpeg();
  const { setPreference } = useTheme();
  const themeSynced = useRef(false);
  const setupChecked = useRef(false);

  // Suivi global du rendu et de l'installation de FFmpeg (survivent a la navigation).
  useEffect(() => {
    initRenderEvents();
    initFfmpegInstallEvents();
    // Apres un rechargement, les vues TikTok / YouTube ne doivent pas rester devant une autre page.
    if (!window.location.hash.startsWith("#/networks")) void networksApi.hideAll().catch(() => undefined);
  }, []);

  // Le theme enregistre en base fait foi au premier chargement.
  useEffect(() => {
    if (settings && !themeSynced.current) {
      themeSynced.current = true;
      setPreference(settings.theme);
    }
  }, [settings, setPreference]);

  // Au lancement : assistant de configuration si la clé Gemini ou FFmpeg manque.
  useEffect(() => {
    if (setupChecked.current || !key || !ffmpeg) return;
    setupChecked.current = true;
    // Une copie deja installee ne redemande jamais l'installation : un probleme de demarrage s'affiche dans Parametres.
    const incomplete = !key.configured || (!ffmpeg.found && !ffmpeg.managedInstalled);
    if (incomplete && !setupHiddenAtStartup() && !setupDismissedThisSession()) openSetup();
  }, [key, ffmpeg]);

  // Retour en haut de page a chaque navigation.
  useEffect(() => {
    if (!location.hash) mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);

  useHotkeys([
    { combo: "mod+k", handler: () => setPaletteOpen((o) => !o), allowInInputs: true },
    { combo: "mod+n", handler: () => navigate("/productions/new"), allowInInputs: true },
    { combo: "mod+,", handler: () => navigate("/settings"), allowInInputs: true },
    ...NAV_ITEMS.map((item, i) => ({ combo: `mod+${i + 1}`, handler: () => navigate(item.to) })),
  ]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
      <main ref={mainRef} className="app-canvas relative min-w-0 flex-1 overflow-y-auto" id="main-scroll">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SetupDialog />
    </div>
  );
}
