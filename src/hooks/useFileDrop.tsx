/**
 * Glisser-deposer de fichiers depuis l'Explorateur Windows.
 *
 * Dans WebView2, les evenements HTML5 ne donnent pas les chemins des fichiers :
 * on ecoute donc l'evenement natif de Tauri et on determine la zone visee a
 * partir de la position du curseur (`elementFromPoint` + `data-dropzone`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { isTauri } from "@/services/storage/invoke";

export interface DropZoneConfig {
  /** Filtre les chemins acceptes (ex. extensions video). */
  accept: (path: string) => boolean;
  onDrop: (paths: string[]) => void;
  /** Libelle utilise dans les messages ("la vidéo du clip 2"). */
  label: string;
  multiple?: boolean;
  disabled?: boolean;
}

interface DropContextValue {
  register: (id: string, config: DropZoneConfig) => () => void;
  activeZone: string | null;
  dragging: boolean;
}

const DropContext = createContext<DropContextValue | null>(null);

function zoneAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const zone = el?.closest<HTMLElement>("[data-dropzone]");
  return zone?.dataset.dropzone ?? null;
}

export function FileDropProvider({ children }: { children: ReactNode }) {
  const zones = useRef(new Map<string, DropZoneConfig>());
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          setDragging(false);
          setActiveZone(null);
          return;
        }
        const scale = window.devicePixelRatio || 1;
        const x = payload.position.x / scale;
        const y = payload.position.y / scale;
        const id = zoneAt(x, y);
        const config = id ? zones.current.get(id) : undefined;
        const usable = config && !config.disabled ? id : null;

        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          setActiveZone(usable);
          return;
        }
        // drop
        setDragging(false);
        setActiveZone(null);
        if (!config || !usable) {
          if (payload.paths.length) {
            toast.info("Déposez le fichier sur une zone d'import", {
              description: "Par exemple la carte du clip correspondant ou la galerie d'un personnage.",
            });
          }
          return;
        }
        const accepted = payload.paths.filter(config.accept);
        const rejected = payload.paths.length - accepted.length;
        if (accepted.length === 0) {
          toast.error("Format non pris en charge", { description: `Ce fichier ne peut pas être utilisé pour ${config.label}.` });
          return;
        }
        if (!config.multiple && accepted.length > 1) {
          toast.error("Un seul fichier attendu", {
            description: `Déposez un seul fichier pour ${config.label} afin d'éviter toute erreur d'association.`,
          });
          return;
        }
        if (rejected > 0) {
          toast.warning(`${rejected} fichier(s) ignoré(s)`, { description: "Format non pris en charge." });
        }
        config.onDrop(accepted);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const register = useCallback((id: string, config: DropZoneConfig) => {
    zones.current.set(id, config);
    return () => {
      zones.current.delete(id);
    };
  }, []);

  const value = useMemo(() => ({ register, activeZone, dragging }), [register, activeZone, dragging]);
  return <DropContext.Provider value={value}>{children}</DropContext.Provider>;
}

/**
 * Enregistre une zone de depot. Renvoie les props a poser sur l'element et
 * l'etat de survol.
 */
export function useDropZone(id: string, config: DropZoneConfig) {
  const ctx = useContext(DropContext);
  if (!ctx) throw new Error("useDropZone doit être utilisé dans FileDropProvider");
  const configRef = useRef(config);
  configRef.current = config;

  const { register } = ctx;
  useEffect(
    () =>
      register(id, {
        accept: (p) => configRef.current.accept(p),
        onDrop: (paths) => configRef.current.onDrop(paths),
        get label() {
          return configRef.current.label;
        },
        get multiple() {
          return configRef.current.multiple;
        },
        get disabled() {
          return configRef.current.disabled;
        },
      }),
    [id, register],
  );

  return {
    dropProps: { "data-dropzone": id },
    isOver: ctx.activeZone === id,
    isDragging: ctx.dragging,
  };
}
