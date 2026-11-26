/**
 * Acces aux donnees via TanStack Query : cache, etats de chargement/erreur et
 * invalidation apres mutation.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { charactersApi } from "@/services/storage/characters";
import { mediaApi } from "@/services/storage/media";
import { productionsApi } from "@/services/storage/productions";
import { secretsApi, settingsApi, systemApi } from "@/services/storage/system";
import { ffmpegApi } from "@/services/ffmpeg";
import type { AppSettings, MediaKind } from "@/types";

export const qk = {
  characters: (includeArchived: boolean) => ["characters", { includeArchived }] as const,
  character: (id: string) => ["character", id] as const,
  productions: ["productions"] as const,
  production: (id: string) => ["production", id] as const,
  media: (kind: MediaKind | null, query: string) => ["media", kind, query] as const,
  settings: ["settings"] as const,
  keyStatus: ["keyStatus"] as const,
  ffmpeg: ["ffmpeg"] as const,
  appInfo: ["appInfo"] as const,
  stats: ["stats"] as const,
};

type Domain = "characters" | "character" | "productions" | "production" | "media" | "stats";

/** Invalide les domaines touches par une mutation. */
export function invalidate(client: QueryClient, ...domains: Domain[]) {
  for (const d of domains) void client.invalidateQueries({ queryKey: [d] });
}

// --- Personnages -------------------------------------------------------------

export function useCharacters(includeArchived = false) {
  return useQuery({ queryKey: qk.characters(includeArchived), queryFn: () => charactersApi.list(includeArchived) });
}

export function useCharacter(id: string | undefined) {
  return useQuery({
    queryKey: qk.character(id ?? ""),
    queryFn: () => charactersApi.get(id!),
    enabled: Boolean(id),
  });
}

// --- Productions ---------------------------------------------------------------

export function useProductions() {
  return useQuery({ queryKey: qk.productions, queryFn: productionsApi.list });
}

export function useProduction(id: string | undefined) {
  return useQuery({
    queryKey: qk.production(id ?? ""),
    queryFn: () => productionsApi.get(id!),
    enabled: Boolean(id),
  });
}

// --- Mediatheque -----------------------------------------------------------------

export function useMedia(kind: MediaKind | null, query: string) {
  return useQuery({ queryKey: qk.media(kind, query), queryFn: () => mediaApi.list(kind, query || null) });
}

// --- Systeme -------------------------------------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: settingsApi.get, staleTime: Infinity });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => settingsApi.update(settings),
    onSuccess: (saved) => {
      client.setQueryData(qk.settings, saved);
      void client.invalidateQueries({ queryKey: qk.ffmpeg });
    },
  });
}

export function useKeyStatus() {
  return useQuery({ queryKey: qk.keyStatus, queryFn: secretsApi.status, staleTime: Infinity });
}

export function useFfmpeg() {
  return useQuery({ queryKey: qk.ffmpeg, queryFn: () => ffmpegApi.detect(false), staleTime: 5 * 60_000 });
}

export function useAppInfo() {
  return useQuery({ queryKey: qk.appInfo, queryFn: systemApi.appInfo, staleTime: Infinity });
}

export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: systemApi.stats });
}
