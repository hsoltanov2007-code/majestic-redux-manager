import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useApp } from "./__root";
import { ReduxCard } from "@/components/ReduxCard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Redux List — Majestic Redux Manager" },
      { name: "description", content: "Browse, install and update your redux list." },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const { reduxes, onInstall, onUninstall } = useApp();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "installed" | "available">("all");

  const filtered = reduxes.filter((r) => {
    if (tab === "installed" && !r.installed) return false;
    if (tab === "available" && r.installed) return false;
    if (q && !`${r.name} ${r.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const installedCount = reduxes.filter((r) => r.installed).length;
  const updatesCount = reduxes.filter(
    (r) => r.installed && r.installedVersion && r.installedVersion !== r.version,
  ).length;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Majestic RP
        </div>
        <h1 className="text-4xl font-bold tracking-tight">
          Redux <span className="text-gradient">Manager</span>
        </h1>
        <p className="text-muted-foreground mt-2">
          {installedCount} installed · {reduxes.length} in list · {updatesCount} updates available
        </p>
      </header>

      <div className="glass rounded-2xl p-3 mb-6 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search redux..."
            className="w-full bg-white/5 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex p-1 rounded-lg bg-white/5 text-sm">
          {(
            [
              ["all", "Все"],
              ["installed", "Установлено"],
              ["available", "Доступно"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`px-3 py-1.5 rounded-md transition ${
                tab === value
                  ? "gradient-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => (
          <ReduxCard key={r.id} redux={r} onInstall={onInstall} onUninstall={onUninstall} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="glass rounded-2xl py-16 text-center text-muted-foreground">
          Redux не найден.
        </div>
      )}
    </div>
  );
}
