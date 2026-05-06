import { Link, useRouterState } from "@tanstack/react-router";
import {
  Package,
  Settings,
  Archive,
  Crown,
  Gamepad2,
  Activity,
} from "lucide-react";

const nav = [
  { to: "/", label: "Redux List", icon: Package },
  { to: "/backups", label: "Backups", icon: Archive },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ gtaDetected }: { gtaDetected: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="w-64 shrink-0 glass-strong border-r flex flex-col h-screen sticky top-0">
      <div className="px-5 pt-6 pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl gradient-primary grid place-items-center shadow-glow">
            <Crown className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Majestic</div>
            <div className="text-xs text-muted-foreground">Redux Manager</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = pathname === to;

          return (
            <Link
              key={to}
              to={to}
              preload={false}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground ring-glow"
                  : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 p-3 rounded-xl glass">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Gamepad2 className="h-3.5 w-3.5" /> GTA V Status
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              gtaDetected
                ? "bg-success shadow-[0_0_8px_var(--success)]"
                : "bg-destructive"
            }`}
          />

          <span className="text-sm font-medium">
            {gtaDetected ? "Detected" : "Not selected"}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Activity className="h-3 w-3" />
          {gtaDetected ? "GTA V folder selected" : "Select folder in Settings"}
        </div>
      </div>
    </aside>
  );
}