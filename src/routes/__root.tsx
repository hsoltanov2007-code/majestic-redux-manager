import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/AppSidebar";
import { REDUXES, type Redux } from "@/lib/mockData";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar gtaDetected={false} />

      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function useApp() {
  return {
    reduxes: REDUXES,
    onInstall: (_redux: Redux) => undefined,
    onUninstall: (_redux: Redux) => undefined,
  };
}
