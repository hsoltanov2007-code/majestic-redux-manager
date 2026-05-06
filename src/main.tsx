import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import {
  Archive,
  CheckCircle2,
  Download,
  FolderSearch,
  HardDrive,
  Package,
  RotateCcw,
  Settings,
  Sparkles,
} from "lucide-react";

import "./styles.css";

type Page = "redux" | "settings" | "backups";

type ReduxItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  size: string;
  downloadUrl: string;
};

const REDUX_JSON_URL =
  "https://raw.githubusercontent.com/hsoltanov2007-code/majestic-redux-data/main/redux.json";

function App() {
  const [page, setPage] = useState<Page>("redux");

  const [reduxes, setReduxes] = useState<ReduxItem[]>([]);

  const [gtaPath, setGtaPath] = useState("");

  const [status, setStatus] = useState("Готово");

  const [loading, setLoading] = useState(false);

  const gtaDetected = Boolean(gtaPath);

  useEffect(() => {
    loadReduxes();
  }, []);

  async function loadReduxes() {
    try {
      setLoading(true);

      setStatus("Загрузка модов...");

      const list = await invoke<ReduxItem[]>("load_redux_list", {
        jsonUrl: REDUX_JSON_URL,
      });

      setReduxes(list);

      setStatus("Моды загружены");
    } catch (err) {
      setStatus("Ошибка загрузки модов: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function detectGta() {
    try {
      setLoading(true);

      setStatus("Поиск GTA V...");

      const path = await invoke<string>("detect_gta");

      setGtaPath(path);

      setStatus("GTA V найдена");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkGtaProcess() {
    try {
      setLoading(true);

      setStatus("Проверка GTA V...");

      const running = await invoke<boolean>("is_gta_running");

      if (running) {
        setStatus(
          "GTA V сейчас запущена. Закрой игру перед установкой мода."
        );
      } else {
        setStatus("GTA V не запущена");
      }
    } catch (err) {
      setStatus("Ошибка проверки GTA: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function installRedux(item: ReduxItem) {
    if (!gtaPath) {
      setPage("settings");

      setStatus("Сначала укажи папку GTA V");

      return;
    }

    try {
      setLoading(true);

      const running = await invoke<boolean>("is_gta_running");

      if (running) {
        setStatus("Закрой GTA V перед установкой");

        return;
      }

      setStatus("Установка " + item.name + "...");

      const result = await invoke<string>("install_redux", {
        reduxId: item.id,
        downloadUrl: item.downloadUrl,
        gtaPath,
      });

      setStatus(result);
    } catch (err) {
      setStatus("Ошибка установки: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function restoreRedux(item: ReduxItem) {
    if (!gtaPath) {
      setPage("settings");

      setStatus("Сначала укажи папку GTA V");

      return;
    }

    try {
      setLoading(true);

      setStatus("Восстановление backup...");

      const result = await invoke<string>("restore_backup", {
        reduxId: item.id,
        gtaPath,
      });

      setStatus(result);
    } catch (err) {
      setStatus("Ошибка восстановления: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkAppUpdate() {
    try {
      setLoading(true);

      setStatus("Проверка обновлений...");

      const update = await check();

      if (!update) {
        setStatus("Обновлений нет");

        return;
      }

      setStatus(`Найдена версия ${update.version}`);

      await update.downloadAndInstall();

      setStatus("Обновление установлено");

      await relaunch();
    } catch (err) {
      setStatus("Ошибка обновления: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  const title = useMemo(() => {
    if (page === "settings") return "Настройки";

    if (page === "backups") return "Backup";

    return "Моды";
  }, [page]);

  return (
    <div className="min-h-screen bg-[#0b0b16] text-white overflow-hidden">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_10%,rgba(124,58,237,0.35),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(37,99,235,0.28),transparent_35%)]" />

      <div className="relative flex min-h-screen">
        <aside className="w-72 shrink-0 border-r border-white/10 bg-black/30 backdrop-blur-2xl p-5">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 grid place-items-center shadow-[0_0_35px_rgba(124,58,237,0.45)]">
              <Sparkles className="h-7 w-7" />
            </div>

            <div>
              <div className="text-2xl font-black tracking-tight">
                Hardy
              </div>

              <div className="text-sm text-white/50">
                MODS
              </div>
            </div>
          </div>

          <nav className="space-y-2">
            <NavButton
              active={page === "redux"}
              icon={<Package className="h-4 w-4" />}
              label="Моды"
              onClick={() => setPage("redux")}
            />

            <NavButton
              active={page === "settings"}
              icon={<Settings className="h-4 w-4" />}
              label="Настройки"
              onClick={() => setPage("settings")}
            />

            <NavButton
              active={page === "backups"}
              icon={<Archive className="h-4 w-4" />}
              label="Backup"
              onClick={() => setPage("backups")}
            />
          </nav>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
              <HardDrive className="h-4 w-4" />
              GTA V
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  gtaDetected
                    ? "bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]"
                    : "bg-red-500"
                }`}
              />

              <span className="font-semibold">
                {gtaDetected ? "Найдена" : "Не выбрана"}
              </span>
            </div>

            <p className="mt-3 text-xs text-white/45 break-words">
              {gtaDetected
                ? gtaPath
                : "Выбери папку GTA V"}
            </p>
          </div>
        </aside>

        <main className="flex-1 p-8 pb-28">
          <header className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-black tracking-tight">
                {title}
              </h1>

              <p className="text-white/50 mt-1">
                Hardy MODS Launcher
              </p>
            </div>

            <button
              onClick={detectGta}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-3 font-bold transition"
            >
              <FolderSearch className="h-4 w-4" />
              Найти GTA
            </button>
          </header>

          {page === "redux" && (
            <section className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-5">
              {reduxes.map((item) => (
                <div
                  key={item.id}
                  className="rounded-3xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-6 shadow-2xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-black">
                        {item.name}
                      </h2>

                      <p className="text-white/45 text-sm mt-1">
                        Версия {item.version}
                      </p>
                    </div>

                    <div className="rounded-xl bg-purple-500/15 text-purple-200 border border-purple-400/20 px-3 py-1 text-xs font-bold">
                      {item.size}
                    </div>
                  </div>

                  <p className="text-white/65 mt-4 leading-relaxed">
                    {item.description}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      disabled={loading}
                      onClick={() => installRedux(item)}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:opacity-90 disabled:opacity-50 px-5 py-3 font-bold transition"
                    >
                      <Download className="h-4 w-4" />
                      Установить
                    </button>

                    <button
                      disabled={loading}
                      onClick={() => restoreRedux(item)}
                      className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50 px-5 py-3 font-bold transition"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {page === "settings" && (
            <section className="max-w-4xl space-y-5">
              <Panel
                icon={<HardDrive className="h-5 w-5" />}
                title="Папка GTA V"
                description="Автоматический поиск GTA V"
              >
                <input
                  value={gtaPath}
                  onChange={(e) => setGtaPath(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-blue-400"
                  placeholder="C:\Program Files\Rockstar Games\Grand Theft Auto V"
                />

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={detectGta}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-3 font-bold transition"
                  >
                    <FolderSearch className="h-4 w-4" />
                    Найти GTA
                  </button>

                  <button
                    onClick={checkGtaProcess}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-5 py-3 font-bold transition"
                  >
                    Проверить GTA
                  </button>

                  <button
                    onClick={checkAppUpdate}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-5 py-3 font-bold transition"
                  >
                    Проверить обновления
                  </button>
                </div>
              </Panel>
            </section>
          )}

          {page === "backups" && (
            <section className="max-w-4xl">
              <Panel
                icon={<Archive className="h-5 w-5" />}
                title="Backup"
                description="Backup создаётся автоматически"
              >
                <div className="rounded-2xl bg-black/30 border border-white/10 p-4 text-white/70">
                  <div className="flex items-center gap-2 text-green-300 font-bold">
                    <CheckCircle2 className="h-5 w-5" />
                    Путь backup
                  </div>

                  <p className="mt-2 text-sm break-words">
                    %AppData% / HardyMODS / backups
                  </p>
                </div>
              </Panel>
            </section>
          )}
        </main>
      </div>

      <div className="fixed left-80 right-6 bottom-5 rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl px-5 py-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              loading
                ? "bg-yellow-400 animate-pulse"
                : "bg-green-400"
            }`}
          />

          <div className="text-sm text-white/80">
            <span className="font-bold text-white">
              Статус:
            </span>{" "}
            {loading ? "Загрузка... " : ""}
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 font-semibold transition ${
        active
          ? "bg-purple-600 text-white shadow-[0_0_30px_rgba(124,58,237,0.35)]"
          : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-6 shadow-2xl">
      <div className="flex items-start gap-3 mb-5">
        <div className="h-11 w-11 rounded-2xl bg-white/10 border border-white/10 grid place-items-center">
          {icon}
        </div>

        <div>
          <h2 className="text-2xl font-black">
            {title}
          </h2>

          <p className="text-white/50 mt-1">
            {description}
          </p>
        </div>
      </div>

      {children}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);