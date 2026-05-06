import { Download, HardDrive, RefreshCcw, RotateCcw, Trash2 } from "lucide-react";
import type { Redux } from "@/lib/mockData";

export function ReduxCard({
  redux,
  onInstall,
  onUninstall,
}: {
  redux: Redux;
  onInstall: (r: Redux) => void;
  onUninstall: (r: Redux) => void;
}) {
  const hasUpdate = redux.installed && redux.installedVersion && redux.installedVersion !== redux.version;

  return (
    <div className="group glass rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-elegant hover:ring-glow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold tracking-tight truncate">{redux.name}</h3>
          <div className="text-xs text-muted-foreground mt-0.5">
            v{redux.version}
            {redux.installedVersion && redux.installedVersion !== redux.version ? (
              <span className="ml-2 text-warning">installed v{redux.installedVersion}</span>
            ) : null}
          </div>
        </div>
        <div className="h-10 w-10 rounded-lg gradient-primary grid place-items-center shrink-0 shadow-glow">
          <span className="text-xs font-bold text-primary-foreground">
            {redux.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground line-clamp-3 mb-4 min-h-[3.75rem]">
        {redux.description}
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-4 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <HardDrive className="h-3 w-3" /> {redux.size}
        </span>
        <span className="font-mono truncate max-w-full opacity-70">{redux.downloadUrl}</span>
      </div>

      <div className="flex gap-2">
        {redux.installed ? (
          <>
            <button
              onClick={() => onUninstall(redux)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" /> Удалить
            </button>
            <button
              onClick={() => onInstall(redux)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold gradient-primary text-primary-foreground shadow-glow hover:opacity-95 transition"
            >
              {hasUpdate ? <RefreshCcw className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              {hasUpdate ? "Обновить" : "Переустановить"}
            </button>
          </>
        ) : (
          <button
            onClick={() => onInstall(redux)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold gradient-primary text-primary-foreground shadow-glow hover:opacity-95 transition"
          >
            <Download className="h-4 w-4" /> Установить
          </button>
        )}
      </div>
    </div>
  );
}
