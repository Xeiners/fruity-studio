import { QueryClient } from "@tanstack/react-query";

/** Client de cache partage (aussi utilise par les stores globaux hors composants). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Donnees locales : pas de rafraichissement agressif.
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
