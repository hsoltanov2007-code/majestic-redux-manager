import { createFileRoute } from "@tanstack/react-router";
import { Archive, Download, RotateCcw, Trash2, Plus, Clock, HardDrive } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/backups")({
  head: () => ({
    meta: [
      { title: "Backups — Majestic Redux Manager" },
      { name: "description", content: "Create, restore and manage backups of your GTA V install." },
    ],
  }),
  component: BackupsPage,
});

type Backup = { id: string; name: string; date: string; size: string; reduxes: number };

const initial: Backup[] = [
  { id: "b1", name: "Pre-Update Snapshot", date: "May 4, 2026 · 18:42", size: "3.2 GB", reduxes: 5 },
  { id: "b2", name: "Clean Install", date: "Apr 22, 2026 · 09:15", size: "1.1 GB", reduxes: 0 },
  { id: "b3", name: "Cinematic Setup", date: "Apr 10, 2026 · 22:30", size: "2.7 GB", reduxes: 4 },
];

function BackupsPage() {
  const [backups, setBackups] = useState(initial);

  const create = () => {
    const id = `b${Date.now()}`;
    setBackups([
      {
        id,
        name: `Auto Backup ${backups.length + 1}`,
        date: new Date().toLocaleString(),
        size: "2.4 GB",
        reduxes: 3,
      },
      ...backups,
    ]);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-2">
            <Archive className="h-3.5 w-3.5 text-secondary" /> Safety net
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Backup & <span className="text-gradient">Restore</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Snapshot your GTA V folder before installing reduxes. One-click rollback.
          </p>
        </div>
        <button
          onClick={create}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg gradient-primary text-primary-foreground font-medium shadow-glow"
        >
          <Plus className="h-4 w-4" /> New Backup
        </button>
      </header>

      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total backups", value: backups.length, icon: Archive },
          { label: "Disk used", value: "7.0 GB", icon: HardDrive },
          { label: "Last backup", value: "today", icon: Clock },
        ].map((s) => (
          <div key={s.label} className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </div>
            <div className="text-2xl font-semibold mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl divide-y divide-white/5">
        {backups.map((b) => (
          <div key={b.id} className="flex items-center gap-4 p-4 hover:bg-white/5 transition">
            <div className="h-11 w-11 rounded-lg gradient-primary grid place-items-center shrink-0 shadow-glow">
              <Archive className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{b.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {b.date} · {b.size} · {b.reduxes} reduxes
              </div>
            </div>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-secondary/40 text-secondary hover:bg-secondary/10">
              <RotateCcw className="h-4 w-4" /> Restore
            </button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-white/5">
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={() => setBackups(backups.filter((x) => x.id !== b.id))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
