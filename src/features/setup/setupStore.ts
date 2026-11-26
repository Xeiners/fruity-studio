/** Ouverture globale de l'assistant de configuration (clé Gemini + FFmpeg). */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const HIDE_KEY = "fruity-setup-hidden";
const SESSION_KEY = "fruity-setup-dismissed";

export function openSetup() {
  open = true;
  notify();
}

export function closeSetup() {
  open = false;
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* stockage indisponible : sans consequence */
  }
  notify();
}

export function useSetupOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => open,
  );
}

/** L'utilisateur a demande de ne plus afficher l'assistant au demarrage. */
export function setupHiddenAtStartup(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSetupHiddenAtStartup(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(HIDE_KEY, "1");
    else window.localStorage.removeItem(HIDE_KEY);
  } catch {
    /* stockage indisponible : l'assistant restera propose au demarrage */
  }
}

/** Deja ferme pendant cette session (evite de le rouvrir apres un rechargement). */
export function setupDismissedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
