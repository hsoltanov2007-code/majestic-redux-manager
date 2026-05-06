import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import type { Redux } from "@/lib/mockData";

export function InstallProgressModal({ redux, onClose }: { redux: Redux | null; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!redux) return;
    setProgress(0);
    setDone(false);
    const id = window.setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 10;
        if (next >= 100) {
          window.clearInterval(id);
          setDone(true);
          return 100;
        }
        return next;
      });
    }, 350);
    return () => window.clearInterval(id);
  }, [redux]);

  if (!redux) return null;

  const stages = ["Downloading zip", "Creating backup", "Extracting files", "Replacing GTA files", "Saving installed version"];
  const stage = done ? "Completed" : stages[Math.min(stages.length - 1, Math.floor(progress / 20))];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-background/70 backdrop-blur-sm">
      <div className="w-full max-w-md glass-strong rounded-2xl shadow-elegant p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-xl gradient-primary grid place-items-center shadow-glow">
            {done ? <CheckCircle2 className="h-5 w-5 text-primary-foreground" /> : <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />}
          </div>
          <div>
            <div className="font-semibold">{done ? "Installation complete" : "Installing redux"}</div>
            <div className="text-xs text-muted-foreground">{redux.name} · v{redux.version}</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>{stage}</span>
          <span className="tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full gradient-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {done ? (
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium gradient-primary text-primary-foreground shadow-glow">Done</button>
          ) : (
            <button disabled className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-muted-foreground cursor-not-allowed inline-flex items-center gap-2">
              <Download className="h-4 w-4" /> Installing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
