import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menus";
import { ConfirmProvider } from "@/components/common/ConfirmDialog";
import { FileDropProvider } from "@/hooks/useFileDrop";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { queryClient } from "@/hooks/queryClient";
import { AppRouter } from "./router";
import "./index.css";

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-xl",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <FileDropProvider>
              <AppRouter />
              <ThemedToaster />
            </FileDropProvider>
          </ConfirmProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
