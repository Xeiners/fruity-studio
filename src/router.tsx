import { createHashRouter, RouterProvider, useRouteError, Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { CharactersPage } from "@/features/characters/CharactersPage";
import { CharacterFormPage } from "@/features/characters/CharacterFormPage";
import { CharacterProfilePage } from "@/features/characters/CharacterProfilePage";
import { NewProductionPage } from "@/features/stories/NewProductionPage";
import { ProductionsPage } from "@/features/production/ProductionsPage";
import { ProductionWorkspacePage } from "@/features/production/ProductionWorkspacePage";
import { MediaLibraryPage } from "@/features/library/MediaLibraryPage";
import { NetworksPage } from "@/features/networks/NetworksPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { errorMessage } from "@/services/storage/invoke";

function RouteError() {
  const error = useRouteError();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <AlertTriangle className="size-8 text-destructive" strokeWidth={1.6} />
      <div>
        <h1 className="text-lg font-semibold">Cet écran a rencontré un problème</h1>
        <p className="mt-1 max-w-lg text-[13px] text-muted-foreground" data-selectable>
          {errorMessage(error)}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Retour au tableau de bord</Link>
      </Button>
    </div>
  );
}

// Routeur par hachage : robuste au rechargement dans la WebView (pas de serveur).
const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage />, errorElement: <RouteError /> },
      { path: "characters", element: <CharactersPage />, errorElement: <RouteError /> },
      { path: "characters/new", element: <CharacterFormPage />, errorElement: <RouteError /> },
      { path: "characters/:id", element: <CharacterProfilePage />, errorElement: <RouteError /> },
      { path: "productions", element: <ProductionsPage />, errorElement: <RouteError /> },
      { path: "productions/new", element: <NewProductionPage />, errorElement: <RouteError /> },
      { path: "productions/:id", element: <ProductionWorkspacePage />, errorElement: <RouteError /> },
      { path: "library", element: <MediaLibraryPage />, errorElement: <RouteError /> },
      { path: "networks", element: <NetworksPage />, errorElement: <RouteError /> },
      { path: "settings", element: <SettingsPage />, errorElement: <RouteError /> },
      { path: "*", element: <RouteError /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
