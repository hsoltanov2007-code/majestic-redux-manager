import React, {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import {
  ArrowLeft,
  Clipboard,
  Download,
  FileArchive,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Settings,
  Trash2,
  Upload,
  User,
} from "lucide-react";

import "./styles.css";

type InstalledMod = {
  version: string;
  files: string[];
};

type AppState = {
  gtaPath: string;
  systemPath: string;
  installedRedux: Record<string, InstalledMod>;
};

type ModItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  size: string;
  image?: string;
  downloadUrl: string;
};

type Category = {
  id: string;
  title: string;
  description: string;
  image?: string;
  mods: ModItem[];
};

type CatalogDocument = {
  schemaVersion: 1;
  app: {
    name: string;
    catalogUrl: string;
  };
  updatedAt: string;
  categories: Category[];
};

type AdminUser = {
  avatar?: string;
  id: string;
  role: "owner" | "admin" | "viewer";
  username?: string;
};

type AdminMember = {
  createdAt?: string;
  createdBy?: string;
  discordId: string;
  label?: string;
};

type AdminStateDocument = {
  admins: AdminMember[];
  ownerDiscordId: string;
  schemaVersion: 1;
};

type Page = "home" | "catalog" | "category" | "rpf" | "rpfExplorer" | "settings" | "admin";

type FilterMode = "all" | "installed" | "notInstalled";

type ProgressPayload = {
  progress: number;
  step: string;
};

type RpfNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children: RpfNode[];
};

type AuthAccount = {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
};

type AuthSession = {
  username: string;
  token: string;
  createdAt: string;
};

type AuthMode = "login" | "setup";

type AuthResult = {
  ok: boolean;
  message?: string;
};

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const REDUX_JSON_URL =
  "https://raw.githubusercontent.com/hsoltanov2007-code/majestic-redux-data/main/redux.json";
const LOCAL_STATE_KEY = "hardy-mods-preview-state";
const ADMIN_API_URL_KEY = "hardy-admin-api-url";
const ADMIN_TOKEN_KEY = "hardy-admin-token";
const ADMIN_DEEP_LINK_PROTOCOL = "hardy-mods:";
const DEFAULT_ADMIN_API_URL = "https://majestic-redux-manager.mmeam.workers.dev";
const AUTH_ACCOUNT_KEY = "hardy-auth-account";
const AUTH_SESSION_KEY = "hardy-auth-session";

const emptyState: AppState = {
  gtaPath: "",
  systemPath: "",
  installedRedux: {},
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

function canUseAdmin(user: AdminUser | null) {
  return user?.role === "owner" || user?.role === "admin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPassword(password: string, salt: string) {
  if (!crypto.subtle) {
    throw new Error("Secure password hashing is unavailable in this browser context");
  }

  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);

  return bytesToHex(new Uint8Array(digest));
}

function readAuthAccount(): AuthAccount | null {
  try {
    const raw = window.localStorage.getItem(AUTH_ACCOUNT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const account = {
      username: readString(parsed.username),
      passwordHash: readString(parsed.passwordHash),
      salt: readString(parsed.salt),
      createdAt: readString(parsed.createdAt),
    };

    return account.username && account.passwordHash && account.salt ? account : null;
  } catch {
    return null;
  }
}

function writeAuthAccount(account: AuthAccount) {
  window.localStorage.setItem(AUTH_ACCOUNT_KEY, JSON.stringify(account));
}

function readAuthSession(account: AuthAccount | null): AuthSession | null {
  if (!account) return null;

  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const session = {
      username: readString(parsed.username),
      token: readString(parsed.token),
      createdAt: readString(parsed.createdAt),
    };

    return session.username === account.username && session.token ? session : null;
  } catch {
    return null;
  }
}

function writeAuthSession(username: string) {
  const session: AuthSession = {
    username,
    token: randomHex(24),
    createdAt: new Date().toISOString(),
  };

  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearAuthSession() {
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}

function normalizeMod(value: unknown, index: number): ModItem | null {
  if (!isRecord(value)) return null;

  const name = readString(value.name);
  const downloadUrl = readString(value.downloadUrl ?? value.download_url);

  if (!name || !downloadUrl) return null;

  return {
    id: readString(value.id, name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `mod-${index + 1}`),
    name,
    version: readString(value.version, "1.0.0"),
    description: readString(value.description, "No description"),
    size: readString(value.size, "Unknown size"),
    image: readString(value.image) || undefined,
    downloadUrl,
  };
}

function normalizeCategories(payload: unknown): Category[] {
  if (!Array.isArray(payload)) return [];

  const categories = payload
    .map((entry, index): Category | null => {
      if (!isRecord(entry) || !Array.isArray(entry.mods)) return null;

      const mods = entry.mods
        .map((mod, modIndex) => normalizeMod(mod, modIndex))
        .filter((mod): mod is ModItem => Boolean(mod));

      return {
        id: readString(entry.id, `category-${index + 1}`),
        title: readString(entry.title, `Category ${index + 1}`),
        description: readString(entry.description),
        image: readString(entry.image) || undefined,
        mods,
      };
    })
    .filter((category): category is Category => Boolean(category));

  if (categories.length > 0) return categories;

  const mods = payload
    .map((mod, index) => normalizeMod(mod, index))
    .filter((mod): mod is ModItem => Boolean(mod));

  return mods.length
    ? [
        {
          id: "redux",
          title: "Redux Mods",
          description: "Available redux packages",
          mods,
        },
      ]
    : [];
}

function normalizeCatalog(payload: unknown): Category[] {
  if (isRecord(payload)) {
    if (Array.isArray(payload.categories)) {
      return normalizeCategories(payload.categories);
    }

    if (Array.isArray(payload.mods)) {
      return normalizeCategories(payload.mods);
    }
  }

  return normalizeCategories(payload);
}

function readLocalState(): AppState {
  try {
    const raw = window.localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return emptyState;

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyState;

    return {
      gtaPath: readString(parsed.gtaPath),
      systemPath: readString(parsed.systemPath),
      installedRedux: isRecord(parsed.installedRedux)
        ? (parsed.installedRedux as Record<string, InstalledMod>)
        : {},
    };
  } catch {
    return emptyState;
  }
}

function writeLocalState(state: AppState) {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}

async function fetchCatalog(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Catalog request failed: ${response.status}`);
  }

  return normalizeCatalog(await response.json());
}

function sanitizeId(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function createAdminCategory(index = 1): Category {
  return {
    id: `category-${index}`,
    title: `Category ${index}`,
    description: "",
    mods: [],
  };
}

function createAdminMod(index = 1): ModItem {
  return {
    id: `mod-${index}`,
    name: `New Mod ${index}`,
    version: "1.0.0",
    description: "",
    size: "0 MB",
    downloadUrl: "https://github.com/USER/REPO/releases/download/v1/mod.zip",
  };
}

function cloneCatalog(catalog: Category[]) {
  return JSON.parse(JSON.stringify(catalog)) as Category[];
}

function buildCatalogDocument(catalog: Category[]): CatalogDocument {
  return {
    schemaVersion: 1,
    app: {
      name: "Hardy MODS",
      catalogUrl: REDUX_JSON_URL,
    },
    updatedAt: new Date().toISOString(),
    categories: catalog,
  };
}

function catalogToJson(catalog: Category[]) {
  return JSON.stringify(buildCatalogDocument(catalog), null, 2);
}

function buildLatestManifest({
  version,
  notes,
  url,
  signature,
}: {
  version: string;
  notes: string;
  url: string;
  signature: string;
}) {
  return JSON.stringify(
    {
      version: version.trim(),
      notes: notes.trim(),
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: signature.trim(),
          url: url.trim(),
        },
      },
    },
    null,
    2,
  );
}

function downloadTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readInitialAdminConnection() {
  let apiUrl = window.localStorage.getItem(ADMIN_API_URL_KEY) || DEFAULT_ADMIN_API_URL;
  let token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";

  try {
    const url = new URL(window.location.href);
    const tokenFromUrl = url.searchParams.get("discord_token");
    const apiUrlFromUrl = url.searchParams.get("admin_api_url");
    let shouldCleanUrl = false;

    if (apiUrlFromUrl) {
      apiUrl = apiUrlFromUrl.replace(/\/+$/, "");
      window.localStorage.setItem(ADMIN_API_URL_KEY, apiUrl);
      url.searchParams.delete("admin_api_url");
      shouldCleanUrl = true;
    }

    if (tokenFromUrl) {
      token = tokenFromUrl.trim();
      window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
      url.searchParams.delete("discord_token");
      shouldCleanUrl = true;
    }

    if (shouldCleanUrl) {
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    return { apiUrl, token };
  }

  return { apiUrl, token };
}

function parseAdminConnectionUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== ADMIN_DEEP_LINK_PROTOCOL && url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const token = url.searchParams.get("discord_token")?.trim() || "";
    const apiUrl = url.searchParams.get("admin_api_url")?.trim().replace(/\/+$/, "") || DEFAULT_ADMIN_API_URL;

    if (!token) {
      return null;
    }

    return { apiUrl, token };
  } catch {
    return null;
  }
}

function App() {
  const [page, setPage] = useState<Page>("home");
  const [initialAdminConnection] = useState(readInitialAdminConnection);

  const [authAccount, setAuthAccount] = useState<AuthAccount | null>(() => readAuthAccount());
  const [authUser, setAuthUser] = useState<string | null>(() => {
    const account = readAuthAccount();
    return readAuthSession(account)?.username ?? null;
  });
  const [authMode, setAuthMode] = useState<AuthMode>(() => (readAuthAccount() ? "login" : "setup"));

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [adminCategories, setAdminCategories] = useState<Category[]>([createAdminCategory()]);
  const [adminImportText, setAdminImportText] = useState("");
  const [releaseVersion, setReleaseVersion] = useState("0.1.51");
  const [releaseNotes, setReleaseNotes] = useState("Hardy MODS Update");
  const [releaseUrl, setReleaseUrl] = useState(
    "https://github.com/hsoltanov2007-code/majestic-redux-manager/releases/download/v0.1.51/Hardy.MODS_0.1.51_x64-setup.exe",
  );
  const [releaseSignature, setReleaseSignature] = useState("");
  const [adminApiUrl, setAdminApiUrl] = useState(initialAdminConnection.apiUrl);
  const [adminToken, setAdminToken] = useState(initialAdminConnection.token);
  const [adminMe, setAdminMe] = useState<AdminUser | null>(null);
  const [backendAdmins, setBackendAdmins] = useState<AdminStateDocument | null>(null);
  const [newAdminDiscordId, setNewAdminDiscordId] = useState("");
  const [newAdminLabel, setNewAdminLabel] = useState("");

  const [gtaPath, setGtaPath] = useState("");
  const [systemPath, setSystemPath] = useState("");

  const [installedRedux, setInstalledRedux] = useState<Record<string, InstalledMod>>({});

  const [rpfPath, setRpfPath] = useState("");
  const [rpfExplorerPath, setRpfExplorerPath] = useState("");
  const [rpfEntries, setRpfEntries] = useState<string[]>([]);
  const [internalPath, setInternalPath] = useState("");
  const [replaceFilePath, setReplaceFilePath] = useState("");
  const [rpfSearch, setRpfSearch] = useState("");

  const [searchText, setSearchText] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installStep, setInstallStep] = useState("");
  const [status, setStatus] = useState("Готово");

  const [tauriUpdate, setTauriUpdate] = useState<Update | null>(null);
  const isAuthenticated = Boolean(adminMe);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    function acceptAdminUrls(urls: string[] | null) {
      if (cancelled || !urls) return;

      for (const rawUrl of urls) {
        const connection = parseAdminConnectionUrl(rawUrl);

        if (!connection) continue;

        window.localStorage.setItem(ADMIN_API_URL_KEY, connection.apiUrl);
        window.localStorage.setItem(ADMIN_TOKEN_KEY, connection.token);
        setAdminApiUrl(connection.apiUrl);
        setAdminToken(connection.token);
        setPage("home");
        setStatus("Discord login complete. Checking session...");
        break;
      }
    }

    getCurrent().then(acceptAdminUrls).catch(() => undefined);

    const unlistenPromise = onOpenUrl(acceptAdminUrls);

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const cleanBase = adminApiUrl.trim().replace(/\/+$/, "");

    if (!adminToken || !cleanBase || cleanBase.includes("YOUR_SUBDOMAIN")) return;

    let cancelled = false;

    async function restoreDiscordSession() {
      try {
        setLoading(true);
        const profileResponse = await fetch(`${cleanBase}/api/me`, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
        });

        const profileText = await profileResponse.text();
        const profile = profileText ? JSON.parse(profileText) : null;

        if (!profileResponse.ok) {
          throw new Error(profile?.error || `Admin API failed: ${profileResponse.status}`);
        }

        if (cancelled) return;

        const user = profile.user as AdminUser;
        setAdminMe(user);
        setStatus(`Logged as ${user.role}`);

        if (user.role === "owner") {
          const adminsResponse = await fetch(`${cleanBase}/api/admins`, {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "Content-Type": "application/json",
            },
          });
          const adminsText = await adminsResponse.text();
          const admins = adminsText ? JSON.parse(adminsText) : null;

          if (!adminsResponse.ok) {
            throw new Error(admins?.error || `Admin API failed: ${adminsResponse.status}`);
          }

          if (!cancelled) setBackendAdmins(admins as AdminStateDocument);
        }
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken("");
          setAdminMe(null);
          setBackendAdmins(null);
          setStatus("Discord session expired. Login again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreDiscordSession();

    return () => {
      cancelled = true;
    };
  }, [adminApiUrl, adminToken]);

  useEffect(() => {
    if (!isAuthenticated) return;

    loadState();
    loadCategories();

    if (!isTauriRuntime()) {
      setStatus("Preview mode: native Tauri actions are simulated");
      return;
    }

    checkForAppUpdate(true);

    const unlistenPromise = listen<ProgressPayload>("install-progress", (event) => {
      setLoading(true);
      setProgress(event.payload.progress);
      setInstallStep(event.payload.step);
      setStatus(event.payload.step);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isAuthenticated]);

  const filteredCategories = useMemo(() => {
    const q = searchText.toLowerCase().trim();

    if (!q) return categories;

    return categories.filter((category) => {
      const categoryText = `${category.title} ${category.description}`.toLowerCase();

      const modText = category.mods
        .map((m) => `${m.name} ${m.description}`)
        .join(" ")
        .toLowerCase();

      return categoryText.includes(q) || modText.includes(q);
    });
  }, [categories, searchText]);

  const categoryMods = useMemo(() => {
    if (!selectedCategory) return [];

    return selectedCategory.mods.filter((mod) => {
      const text = `${mod.name} ${mod.description}`.toLowerCase();
      const matchesSearch = text.includes(searchText.toLowerCase().trim());
      const installed = Boolean(installedRedux[mod.id]);

      if (!matchesSearch) return false;
      if (filterMode === "installed") return installed;
      if (filterMode === "notInstalled") return !installed;

      return true;
    });
  }, [selectedCategory, searchText, filterMode, installedRedux]);

  const adminCatalogJson = useMemo(() => catalogToJson(adminCategories), [adminCategories]);

  const catalogStats = useMemo(() => {
    const modCount = adminCategories.reduce((total, category) => total + category.mods.length, 0);
    const missingDownloads = adminCategories.reduce(
      (total, category) => total + category.mods.filter((mod) => !mod.downloadUrl.trim()).length,
      0,
    );
    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();

    for (const category of adminCategories) {
      for (const mod of category.mods) {
        if (seenIds.has(mod.id)) {
          duplicateIds.add(mod.id);
        }

        seenIds.add(mod.id);
      }
    }

    return {
      categoryCount: adminCategories.length,
      duplicateIds: Array.from(duplicateIds),
      missingDownloads,
      modCount,
    };
  }, [adminCategories]);

  const releaseManifestJson = useMemo(
    () =>
      buildLatestManifest({
        version: releaseVersion,
        notes: releaseNotes,
        url: releaseUrl,
        signature: releaseSignature,
      }),
    [releaseVersion, releaseNotes, releaseSignature, releaseUrl],
  );

  useEffect(() => {
    if (!loading) {
      setTimeout(() => {
        setProgress(0);
        setInstallStep("");
      }, 1000);
    }
  }, [loading]);

  async function setupLocalAccount(
    username: string,
    password: string,
    confirmPassword: string,
  ): Promise<AuthResult> {
    const cleanUsername = username.trim();

    if (cleanUsername.length < 3) {
      return { ok: false, message: "Username минимум 3 символа" };
    }

    if (password.length < 6) {
      return { ok: false, message: "Password минимум 6 символов" };
    }

    if (password !== confirmPassword) {
      return { ok: false, message: "Passwords не совпадают" };
    }

    try {
      const salt = randomHex();
      const account: AuthAccount = {
        username: cleanUsername,
        passwordHash: await hashPassword(password, salt),
        salt,
        createdAt: new Date().toISOString(),
      };

      writeAuthAccount(account);
      writeAuthSession(account.username);
      setAuthAccount(account);
      setAuthUser(account.username);
      setAuthMode("login");
      setStatus("Login настроен");

      return { ok: true };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  async function loginLocalAccount(username: string, password: string): Promise<AuthResult> {
    const account = authAccount ?? readAuthAccount();

    if (!account) {
      setAuthMode("setup");
      return { ok: false, message: "Сначала создай local account" };
    }

    if (username.trim() !== account.username) {
      return { ok: false, message: "Неверный username или password" };
    }

    try {
      const passwordHash = await hashPassword(password, account.salt);

      if (passwordHash !== account.passwordHash) {
        return { ok: false, message: "Неверный username или password" };
      }

      writeAuthSession(account.username);
      setAuthAccount(account);
      setAuthUser(account.username);
      setStatus("Logged in");

      return { ok: true };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  function logoutLocalAccount() {
    clearAuthSession();
    setAuthUser(null);
    setPage("home");
    setSelectedCategory(null);
    setStatus("Logged out");
  }

  async function loadState() {
    if (!isTauriRuntime()) {
      const state = readLocalState();
      setGtaPath(state.gtaPath);
      setSystemPath(state.systemPath);
      setInstalledRedux(state.installedRedux);
      return;
    }

    try {
      const state = await invoke<AppState>("load_app_state");

      setGtaPath(state.gtaPath || "");
      setSystemPath(state.systemPath || "");
      setInstalledRedux(state.installedRedux || {});
    } catch {
      setStatus("Ошибка загрузки state");
    }
  }

  async function loadCategories() {
    try {
      setLoading(true);

      const list = isTauriRuntime()
        ? normalizeCatalog(
            await invoke<Category[]>("load_redux_list", {
              jsonUrl: REDUX_JSON_URL,
            }),
          )
        : await fetchCatalog(REDUX_JSON_URL);

      setCategories(list);
      setStatus("Каталог обновлён");
    } catch (err) {
      try {
        const fallback = await fetchCatalog("/redux.example.json");
        setCategories(fallback);
        setStatus("Каталог загружен из локального примера");
      } catch {
        setStatus("Ошибка загрузки категорий: " + String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  function openAdmin() {
    if (!canUseAdmin(adminMe)) {
      setStatus("Admin доступен только owner/admin");
      return;
    }

    if (
      categories.length > 0 &&
      adminCategories.length === 1 &&
      adminCategories[0].mods.length === 0
    ) {
      setAdminCategories(cloneCatalog(categories));
    }

    setSelectedCategory(null);
    setPage("admin");
  }

  function syncAdminFromCatalog() {
    setAdminCategories(categories.length > 0 ? cloneCatalog(categories) : [createAdminCategory()]);
    setStatus("Admin catalog synced from current mods");
  }

  function updateAdminCategory(
    categoryId: string,
    field: "id" | "title" | "description" | "image",
    value: string,
  ) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              [field]: field === "id" ? sanitizeId(value, category.id) : value,
            }
          : category,
      ),
    );
  }

  function addAdminCategory() {
    setAdminCategories((current) => [...current, createAdminCategory(current.length + 1)]);
  }

  function removeAdminCategory(categoryId: string) {
    setAdminCategories((current) => {
      const next = current.filter((category) => category.id !== categoryId);
      return next.length > 0 ? next : [createAdminCategory()];
    });
  }

  function addAdminMod(categoryId: string) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: [...category.mods, createAdminMod(category.mods.length + 1)],
            }
          : category,
      ),
    );
  }

  function updateAdminMod(categoryId: string, modId: string, field: keyof ModItem, value: string) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: category.mods.map((mod) =>
                mod.id === modId
                  ? {
                      ...mod,
                      [field]: field === "id" ? sanitizeId(value, mod.id) : value,
                    }
                  : mod,
              ),
            }
          : category,
      ),
    );
  }

  function removeAdminMod(categoryId: string, modId: string) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: category.mods.filter((mod) => mod.id !== modId),
            }
          : category,
      ),
    );
  }

  function importAdminCatalog() {
    try {
      const next = normalizeCatalog(JSON.parse(adminImportText));

      if (next.length === 0) {
        setStatus("Admin import failed: no categories or mods found");
        return;
      }

      setAdminCategories(next);
      setStatus("Admin catalog imported");
    } catch (err) {
      setStatus("Admin import failed: " + String(err));
    }
  }

  function useAdminCatalogInPreview() {
    setCategories(cloneCatalog(adminCategories));
    setSelectedCategory(null);
    setPage("catalog");
    setStatus("Admin catalog loaded into preview");
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label} copied`);
    } catch {
      setStatus(`${label} is ready in the text box`);
    }
  }

  async function adminRequest<T>(
    path: string,
    init: RequestInit = {},
    connection?: { apiUrl?: string; token?: string },
  ): Promise<T> {
    const cleanBase = (connection?.apiUrl || adminApiUrl).trim().replace(/\/+$/, "");
    const requestToken = (connection?.token || adminToken).trim();

    if (!cleanBase || cleanBase.includes("YOUR_SUBDOMAIN")) {
      throw new Error("Set Admin API URL first");
    }

    const response = await fetch(`${cleanBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(data?.error || `Admin API failed: ${response.status}`);
    }

    return data as T;
  }

  function saveAdminConnection() {
    const cleanUrl = (adminApiUrl || DEFAULT_ADMIN_API_URL).trim().replace(/\/+$/, "");

    window.localStorage.setItem(ADMIN_API_URL_KEY, cleanUrl);
    setAdminApiUrl(cleanUrl);

    setStatus("Admin API settings saved");
  }

  async function openDiscordLogin() {
    const cleanBase = (adminApiUrl || DEFAULT_ADMIN_API_URL).trim().replace(/\/+$/, "");

    if (!cleanBase || cleanBase.includes("YOUR_SUBDOMAIN")) {
      setStatus("Set Admin API URL first");
      return;
    }

    const loginUrl = `${cleanBase}/auth/discord/start`;

    try {
      if (isTauriRuntime()) {
        await openUrl(loginUrl);
      } else {
        window.location.href = loginUrl;
      }

      setStatus("Discord login opened. After authorization the app will open automatically.");
    } catch (err) {
      setStatus("Discord login open failed: " + String(err));
    }
  }

  function looksLikeDiscordSessionToken(value: string) {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
  }

  async function resolveDiscordSessionToken() {
    const currentToken = adminToken.trim();

    if (looksLikeDiscordSessionToken(currentToken)) {
      return currentToken;
    }

    const storedToken = (window.localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();

    if (looksLikeDiscordSessionToken(storedToken)) {
      return storedToken;
    }

    try {
      const clipboardToken = (await navigator.clipboard.readText()).trim();

      if (looksLikeDiscordSessionToken(clipboardToken)) {
        return clipboardToken;
      }
    } catch {
      return "";
    }

    return "";
  }

  async function loadAdminProfileWithConnection(connection?: { apiUrl?: string; token?: string }) {
    try {
      setLoading(true);
      const cleanUrl = (connection?.apiUrl || adminApiUrl || DEFAULT_ADMIN_API_URL)
        .trim()
        .replace(/\/+$/, "");
      const token = connection?.token?.trim() || (await resolveDiscordSessionToken());

      if (!token) {
        setStatus("Login Discord first, then press Continue.");
        return;
      }

      window.localStorage.setItem(ADMIN_API_URL_KEY, cleanUrl);
      setAdminApiUrl(cleanUrl);

      if (token !== adminToken) {
        window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
        setAdminToken(token);
      }

      const authHeaders = { Authorization: `Bearer ${token}` };
      const result = await adminRequest<{ user: AdminUser }>(
        "/api/me",
        { headers: authHeaders },
        { apiUrl: cleanUrl, token },
      );
      setAdminMe(result.user);
      setStatus(`Logged as ${result.user.role}`);

      if (result.user.role === "owner") {
        const admins = await adminRequest<AdminStateDocument>("/api/admins", {
          headers: authHeaders,
        }, { apiUrl: cleanUrl, token });
        setBackendAdmins(admins);
      }
    } catch (err) {
      setStatus("Admin login failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminProfile() {
    await loadAdminProfileWithConnection();
  }

  async function logoutDiscord() {
    try {
      if (adminToken && !adminApiUrl.includes("YOUR_SUBDOMAIN")) {
        await adminRequest("/auth/logout", { method: "POST" });
      }
    } catch {
      // Local cleanup still logs the user out even if the backend session is already gone.
    }

    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken("");
    setAdminMe(null);
    setBackendAdmins(null);
    setPage("home");
    setSelectedCategory(null);
    setStatus("Logged out");
  }

  async function pullCatalogFromAdminApi() {
    try {
      setLoading(true);
      const catalog = await adminRequest<CatalogDocument>("/api/catalog");
      setAdminCategories(cloneCatalog(normalizeCatalog(catalog)));
      setStatus("Catalog pulled from GitHub via Admin API");
    } catch (err) {
      setStatus("Catalog pull failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function publishCatalogToAdminApi() {
    try {
      setLoading(true);
      const catalog = buildCatalogDocument(adminCategories);
      await adminRequest("/api/catalog", {
        body: JSON.stringify({
          catalog,
          message: `Update redux catalog (${catalog.categories.length} categories)`,
        }),
        method: "PUT",
      });
      setStatus("redux.json published to GitHub");
    } catch (err) {
      setStatus("Catalog publish failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function publishLatestToAdminApi() {
    try {
      setLoading(true);
      await adminRequest("/api/latest", {
        body: JSON.stringify({
          manifest: JSON.parse(releaseManifestJson),
          message: `Update latest.json ${releaseVersion}`,
        }),
        method: "PUT",
      });
      setStatus("latest.json published to GitHub");
    } catch (err) {
      setStatus("latest.json publish failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkGithubToken() {
    try {
      setLoading(true);
      const result = await adminRequest<{
        branch: string;
        error?: string;
        ok: boolean;
        permissions?: Record<string, boolean> | null;
        repo: string;
        repoStatus?: number;
        tokenConfigured: boolean;
        writePath?: string;
      }>("/api/github-token-check", { method: "POST" });

      if (result.ok) {
        setStatus(`GitHub token OK: ${result.repo} ${result.writePath}`);
        return;
      }

      setStatus(`GitHub token check failed: ${result.error || "unknown error"}`);
    } catch (err) {
      setStatus("GitHub token check failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function addBackendAdmin() {
    try {
      setLoading(true);
      const admins = await adminRequest<AdminStateDocument>("/api/admins", {
        body: JSON.stringify({
          discordId: newAdminDiscordId,
          label: newAdminLabel,
        }),
        method: "POST",
      });
      setBackendAdmins(admins);
      setNewAdminDiscordId("");
      setNewAdminLabel("");
      setStatus("Admin added");
    } catch (err) {
      setStatus("Add admin failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function removeBackendAdmin(discordId: string) {
    try {
      setLoading(true);
      const admins = await adminRequest<AdminStateDocument>(
        `/api/admins/${encodeURIComponent(discordId)}`,
        {
          method: "DELETE",
        },
      );
      setBackendAdmins(admins);
      setStatus("Admin removed");
    } catch (err) {
      setStatus("Remove admin failed: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkForAppUpdate(silent = false): Promise<Update | null> {
    if (!isTauriRuntime()) {
      if (!silent) {
        setStatus("Update check works only in Tauri app");
      }

      return null;
    }

    try {
      if (!silent) {
        setLoading(true);
        setStatus("Checking for app update...");
      }

      const update = await check();
      setTauriUpdate(update);

      if (update) {
        setStatus(`Доступно обновление ${update.version}`);
      } else if (!silent) {
        setStatus("App is up to date");
      }

      return update;
    } catch (err) {
      if (!silent) {
        setStatus("Update check failed: " + String(err));
      }

      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function installTauriUpdate() {
    try {
      setLoading(true);
      setProgress(0);
      setInstallStep("Checking update");
      setStatus("Проверка обновления...");

      const update = tauriUpdate ?? (await checkForAppUpdate(true));

      if (!update) {
        setStatus("Обновлений нет");
        setInstallStep("");
        return;
      }

      setTauriUpdate(update);
      setStatus(`Скачивание обновления ${update.version}...`);
      setInstallStep("Downloading update");

      let totalBytes = 0;
      let downloadedBytes = 0;

      const onDownloadEvent = (event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setProgress(0);
          setInstallStep("Downloading update");
          setStatus(`Скачивание обновления ${update.version}...`);
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;

          if (totalBytes > 0) {
            const nextProgress = Math.round((downloadedBytes / totalBytes) * 100);
            setProgress(Math.min(99, nextProgress));
          } else {
            setProgress((current) => Math.min(95, current + 1));
          }
        }

        if (event.event === "Finished") {
          setProgress(100);
          setInstallStep("Installing update");
          setStatus("Обновление скачано, установка...");
        }
      };

      await update.downloadAndInstall(onDownloadEvent);

      setStatus("Перезапуск...");
      setInstallStep("Restarting");
      await relaunch();
    } catch (err) {
      setStatus("Ошибка установки обновления: " + String(err));
      setInstallStep("");
    } finally {
      setLoading(false);
    }
  }

  async function detectGta() {
    if (!isTauriRuntime()) {
      setPage("settings");
      setStatus("Автопоиск GTA доступен только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);

      const path = await invoke<string>("detect_gta");

      setGtaPath(path);

      const state = await invoke<AppState>("save_gta_path", {
        gtaPath: path,
      });

      setInstalledRedux(state.installedRedux || {});
      setStatus("GTA V найдена");
    } catch (err) {
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function persistGtaPath(path: string) {
    const cleanPath = path.trim();

    if (!cleanPath) {
      setStatus("Укажи папку GTA V");
      return;
    }

    if (!isTauriRuntime()) {
      const state = { ...readLocalState(), gtaPath: cleanPath };
      writeLocalState(state);
      setGtaPath(cleanPath);
      setStatus("Путь GTA сохранён в preview-режиме");
      return;
    }

    const state = await invoke<AppState>("save_gta_path", {
      gtaPath: cleanPath,
    });

    setGtaPath(state.gtaPath || cleanPath);
    setInstalledRedux(state.installedRedux || {});
    setStatus("Путь GTA сохранён");
  }

  async function persistSystemPath(path: string) {
    const cleanPath = path.trim();

    if (!cleanPath) {
      setStatus("Укажи папку для system files");
      return;
    }

    if (!isTauriRuntime()) {
      const state = { ...readLocalState(), systemPath: cleanPath };
      writeLocalState(state);
      setSystemPath(cleanPath);
      setStatus("System path сохранён в preview-режиме");
      return;
    }

    const state = await invoke<AppState>("save_system_path", {
      systemPath: cleanPath,
    });

    setSystemPath(state.systemPath || cleanPath);
    setInstalledRedux(state.installedRedux || {});
    setStatus("System path сохранён");
  }

  async function saveManualSettings() {
    try {
      setLoading(true);

      if (gtaPath.trim()) {
        await persistGtaPath(gtaPath);
      }

      if (systemPath.trim()) {
        await persistSystemPath(systemPath);
      }

      if (!gtaPath.trim() && !systemPath.trim()) {
        setStatus("Нечего сохранять");
      }
    } catch (err) {
      setStatus("Ошибка сохранения настроек: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function chooseSystemFolder() {
    if (!isTauriRuntime()) {
      setStatus("Выбор папки доступен только в приложении Tauri");
      return;
    }

    const folder = await open({
      directory: true,
      multiple: false,
    });

    if (typeof folder === "string") {
      try {
        await persistSystemPath(folder);
      } catch (err) {
        setStatus("Ошибка system path: " + String(err));
      }
    }
  }

  async function chooseGtaFolderManual() {
    if (!isTauriRuntime()) {
      setStatus("Выбор папки доступен только в приложении Tauri");
      return;
    }

    const folder = await open({
      directory: true,
      multiple: false,
    });

    if (typeof folder === "string") {
      try {
        await persistGtaPath(folder);
      } catch (err) {
        setStatus("Ошибка GTA path: " + String(err));
      }
    }
  }

  async function installRedux(item: ModItem) {
    if (!gtaPath) {
      setPage("settings");
      setStatus("Сначала выбери GTA папку");
      return;
    }

    const installed = installedRedux[item.id];

    if (installed?.version === item.version) {
      setStatus(`${item.name} уже установлен`);
      return;
    }

    try {
      setLoading(true);

      if (!isTauriRuntime()) {
        const nextInstalled = {
          ...installedRedux,
          [item.id]: {
            version: item.version,
            files: [],
          },
        };

        setInstalledRedux(nextInstalled);
        writeLocalState({
          gtaPath,
          systemPath,
          installedRedux: nextInstalled,
        });
        setProgress(100);
        setStatus(`${item.name} отмечен как установлен в preview-режиме`);
        return;
      }

      const state = await invoke<AppState>("install_redux", {
        reduxId: item.id,
        reduxVersion: item.version,
        downloadUrl: item.downloadUrl,
        gtaPath,
      });

      setInstalledRedux(state.installedRedux || {});
      setStatus(installed ? item.name + " обновлён" : item.name + " установлен");
    } catch (err) {
      setStatus("Ошибка установки: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function restoreRedux(item: ModItem) {
    if (!gtaPath) {
      setPage("settings");
      setStatus("Сначала выбери GTA папку");
      return;
    }

    try {
      setLoading(true);

      if (!isTauriRuntime()) {
        const nextInstalled = { ...installedRedux };
        delete nextInstalled[item.id];
        setInstalledRedux(nextInstalled);
        writeLocalState({
          gtaPath,
          systemPath,
          installedRedux: nextInstalled,
        });
        setStatus(`${item.name} удалён из preview-режима`);
        return;
      }

      const state = await invoke<AppState>("restore_backup", {
        reduxId: item.id,
        gtaPath,
      });

      setInstalledRedux(state.installedRedux || {});
      setStatus("Backup восстановлен");
    } catch (err) {
      setStatus("Ошибка восстановления: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function chooseRpfFile() {
    if (!isTauriRuntime()) {
      setStatus("Выбор RPF доступен только в приложении Tauri");
      return;
    }

    const file = await open({
      multiple: false,
      filters: [{ name: "RPF", extensions: ["rpf"] }],
    });

    if (typeof file === "string") {
      setRpfPath(file);
    }
  }

  async function unlockRpf() {
    if (!rpfPath) {
      setStatus("Сначала выбери .rpf файл");
      return;
    }

    if (!isTauriRuntime()) {
      setStatus("Unlock RPF доступен только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);

      const result = await invoke<string>("unlock_rpf_file", {
        rpfPath,
      });

      setStatus(result);
    } catch (err) {
      setStatus("Ошибка unlock: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function chooseRpfExplorerFile() {
    if (!isTauriRuntime()) {
      setStatus("Выбор RPF доступен только в приложении Tauri");
      return;
    }

    const file = await open({
      multiple: false,
      filters: [{ name: "RPF", extensions: ["rpf"] }],
    });

    if (typeof file === "string") {
      setRpfExplorerPath(file);
    }
  }

  async function loadRpfTree() {
    if (!rpfExplorerPath) {
      setStatus("Сначала выбери RPF файл");
      return;
    }

    if (!isTauriRuntime()) {
      setStatus("RPF Explorer доступен только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);

      const result = await invoke<string[]>("list_rpf_file", {
        rpfPath: rpfExplorerPath,
      });

      setRpfEntries(result);
      setStatus("RPF загружен");
    } catch (err) {
      setStatus("Ошибка RPF Explorer: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function chooseReplaceFile() {
    if (!isTauriRuntime()) {
      setStatus("Выбор файла доступен только в приложении Tauri");
      return;
    }

    const file = await open({
      multiple: false,
    });

    if (typeof file === "string") {
      setReplaceFilePath(file);
    }
  }

  async function replaceRpfFile() {
    if (!rpfExplorerPath || !internalPath || !replaceFilePath) {
      setStatus("Выбери RPF, файл внутри архива и файл для замены");
      return;
    }

    if (!isTauriRuntime()) {
      setStatus("Replace RPF доступен только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);

      const result = await invoke<string>("replace_rpf_file", {
        rpfPath: rpfExplorerPath,
        internalPath,
        newFilePath: replaceFilePath,
      });

      setStatus(result || "Файл заменён");
    } catch (err) {
      setStatus("Ошибка replace: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  const rpfTree = useMemo(() => {
    return buildRpfTree(rpfEntries);
  }, [rpfEntries]);
  const canOpenAdmin = canUseAdmin(adminMe);
  const canPublishCatalog = canOpenAdmin;
  const canPublishLatest = adminMe?.role === "owner";

  if (!isAuthenticated) {
    return (
      <DiscordLoginScreen
        loading={loading}
        status={status}
        onCheck={loadAdminProfile}
        onLogin={openDiscordLogin}
      />
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#050507] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(124,58,237,.25),transparent_30%)]" />

      <header className="relative z-20 h-[76px] border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between px-8">
          <button
            onClick={() => {
              setPage("home");
              setSelectedCategory(null);
            }}
            className="flex items-center gap-3"
          >
            <img src="/hardy-h.png" className="h-10 w-10 object-contain" />
            <span className="text-xl font-black">HARDY MODS</span>
          </button>

          <div className="flex gap-3">
            <TopButton onClick={() => setPage("home")}>Главная</TopButton>
            <TopButton onClick={() => setPage("catalog")}>Mods</TopButton>
            <TopButton onClick={() => setPage("rpf")}>RPF Unlocker</TopButton>
            <TopButton onClick={() => setPage("rpfExplorer")}>RPF Explorer</TopButton>
            {canOpenAdmin && <TopButton onClick={openAdmin}>Admin</TopButton>}

            <CircleButton onClick={loadCategories}>
              <RefreshCw size={18} />
            </CircleButton>

            <CircleButton onClick={detectGta}>
              <FolderSearch size={18} />
            </CircleButton>

            <CircleButton onClick={() => setPage("settings")}>
              <Settings size={18} />
            </CircleButton>

            <CircleButton onClick={logoutDiscord}>
              <LogOut size={18} />
            </CircleButton>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1600px] px-8 pb-28">
        {tauriUpdate && (
          <div className="mt-8 rounded-[28px] border border-purple-500/40 bg-purple-600/20 p-6 shadow-[0_0_45px_rgba(168,85,247,.25)]">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-2xl font-black">
                  Доступно обновление HARDY MODS {tauriUpdate.version}
                </div>

                <div className="mt-2 text-white/55">
                  Нажми кнопку, чтобы скачать и установить новую версию.
                </div>
              </div>

              <button
                onClick={installTauriUpdate}
                disabled={loading}
                className="rounded-2xl bg-white px-6 py-4 font-black text-black hover:scale-105 transition disabled:opacity-40"
              >
                Скачать обновление
              </button>
            </div>
          </div>
        )}

        {page === "home" && (
          <>
            <section className="grid grid-cols-2 items-center gap-10 pt-16">
              <div className="pl-10">
                <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs font-black uppercase tracking-[.25em]">
                  <span className="h-2 w-2 rounded-full bg-purple-500" />
                  HARDY MODS
                </div>

                <div className="leading-none">
                  <div className="text-[110px] font-black text-white">HARDY</div>

                  <div className="text-[110px] font-black text-purple-500">MODS</div>
                </div>

                <div className="mt-12 grid grid-cols-2 gap-6">
                  <DashboardCard
                    title="Mods"
                    description="Каталог модов"
                    icon={<Package />}
                    onClick={() => setPage("catalog")}
                  />

                  <DashboardCard
                    title="RPF Unlocker"
                    description="Unlock RPF"
                    icon={<FileArchive />}
                    onClick={() => setPage("rpf")}
                  />

                  <DashboardCard
                    title="RPF Explorer"
                    description="OpenIV style"
                    icon={<FolderOpen />}
                    onClick={() => setPage("rpfExplorer")}
                  />

                  <DashboardCard
                    title="Settings"
                    description="Настройки"
                    icon={<Settings />}
                    onClick={() => setPage("settings")}
                  />

                  {canOpenAdmin && (
                    <DashboardCard
                      title="Admin"
                      description="Catalog and update tools"
                      icon={<FileJson />}
                      onClick={openAdmin}
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-center">
                <img
                  src="/hardy-h.png"
                  className="h-[580px] w-[580px] object-contain drop-shadow-[0_0_80px_rgba(168,85,247,.6)]"
                />
              </div>
            </section>
          </>
        )}

        {page === "catalog" && !selectedCategory && (
          <section className="pt-10">
            <BackButton onClick={() => setPage("home")} />

            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-5xl font-black">Каталог модов</h2>

              <div className="flex gap-4">
                <SearchBox value={searchText} onChange={setSearchText} />

                <FilterButton active={filterMode === "all"} onClick={() => setFilterMode("all")}>
                  All
                </FilterButton>

                <FilterButton
                  active={filterMode === "installed"}
                  onClick={() => setFilterMode("installed")}
                >
                  Installed
                </FilterButton>

                <FilterButton
                  active={filterMode === "notInstalled"}
                  onClick={() => setFilterMode("notInstalled")}
                >
                  New
                </FilterButton>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {filteredCategories.map((category) => {
                const installedCount = category.mods.filter((mod) => installedRedux[mod.id]).length;

                return (
                  <div
                    key={category.id}
                    className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[.045]"
                  >
                    <div className="h-56 bg-gradient-to-br from-purple-800 to-blue-900">
                      {category.image && (
                        <img src={category.image} className="h-full w-full object-cover" />
                      )}
                    </div>

                    <div className="p-6">
                      <h3 className="text-4xl font-black">{category.title}</h3>

                      <p className="mt-4 text-white/55">{category.description}</p>

                      <div className="mt-4 text-sm text-white/40">
                        {category.mods.length} mods · {installedCount} installed
                      </div>

                      <button
                        onClick={() => {
                          setSelectedCategory(category);
                          setPage("category");
                          setSearchText("");
                        }}
                        className="mt-6 w-full rounded-2xl bg-purple-600 py-4 font-black hover:bg-purple-500"
                      >
                        Открыть
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {page === "category" && selectedCategory && (
          <section className="pt-10">
            <BackButton
              onClick={() => {
                setSelectedCategory(null);
                setPage("catalog");
              }}
            />

            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-5xl font-black">{selectedCategory.title}</h2>

                <p className="mt-3 text-white/45">{selectedCategory.description}</p>
              </div>

              <div className="flex gap-4">
                <SearchBox value={searchText} onChange={setSearchText} />

                <FilterButton active={filterMode === "all"} onClick={() => setFilterMode("all")}>
                  All
                </FilterButton>

                <FilterButton
                  active={filterMode === "installed"}
                  onClick={() => setFilterMode("installed")}
                >
                  Installed
                </FilterButton>

                <FilterButton
                  active={filterMode === "notInstalled"}
                  onClick={() => setFilterMode("notInstalled")}
                >
                  New
                </FilterButton>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {categoryMods.map((item) => {
                const installed = installedRedux[item.id];

                return (
                  <ModCard
                    key={item.id}
                    item={item}
                    installed={installed}
                    loading={loading}
                    onInstall={() => installRedux(item)}
                    onRestore={() => restoreRedux(item)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {page === "rpf" && (
          <ToolPanel title="RPF Unlocker" icon={<FileArchive />} onBack={() => setPage("home")}>
            <PathBox text={rpfPath || "RPF файл не выбран"} />

            <div className="flex gap-4">
              <PrimaryButton onClick={chooseRpfFile}>Выбрать .rpf</PrimaryButton>

              <PurpleButton disabled={!rpfPath} onClick={unlockRpf}>
                Unlock
              </PurpleButton>
            </div>
          </ToolPanel>
        )}

        {page === "rpfExplorer" && (
          <ToolPanel title="RPF Explorer" icon={<FolderOpen />} onBack={() => setPage("home")}>
            <div className="mb-6 flex gap-4">
              <PrimaryButton onClick={chooseRpfExplorerFile}>Выбрать RPF</PrimaryButton>

              <PurpleButton disabled={!rpfExplorerPath} onClick={loadRpfTree}>
                Открыть
              </PurpleButton>
            </div>

            <PathBox text={rpfExplorerPath || "RPF не выбран"} />

            <div className="mb-5">
              <SearchBox value={rpfSearch} onChange={setRpfSearch} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="h-[520px] overflow-auto rounded-3xl border border-white/10 bg-black/35 p-4">
                <TreeView
                  nodes={filterTree(rpfTree, rpfSearch)}
                  selectedPath={internalPath}
                  onSelect={setInternalPath}
                />
              </div>

              <div>
                <PathBox text={internalPath || "Файл не выбран"} />
                <PathBox text={replaceFilePath || "Новый файл не выбран"} />

                <div className="grid grid-cols-2 gap-4">
                  <PrimaryButton onClick={chooseReplaceFile}>
                    <Upload size={18} />
                    Выбрать файл
                  </PrimaryButton>

                  <PurpleButton
                    disabled={!internalPath || !replaceFilePath}
                    onClick={replaceRpfFile}
                  >
                    Replace
                  </PurpleButton>
                </div>
              </div>
            </div>
          </ToolPanel>
        )}

        {page === "admin" && (
          <ToolPanel title="Admin" icon={<FileJson />} onBack={() => setPage("home")}>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)] gap-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <PrimaryButton onClick={syncAdminFromCatalog}>
                    <RefreshCw size={18} />
                    Sync current
                  </PrimaryButton>
                  <PurpleButton onClick={addAdminCategory}>
                    <Plus size={18} />
                    Category
                  </PurpleButton>
                  <PrimaryButton onClick={useAdminCatalogInPreview}>
                    <Package size={18} />
                    Preview
                  </PrimaryButton>
                  <PrimaryButton onClick={() => copyText(adminCatalogJson, "redux.json")}>
                    <Clipboard size={18} />
                    Copy JSON
                  </PrimaryButton>
                  <PurpleButton onClick={() => downloadTextFile("redux.json", adminCatalogJson)}>
                    <Download size={18} />
                    Export
                  </PurpleButton>
                </div>

                {adminCategories.map((category) => (
                  <div
                    key={category.id}
                    className="rounded-3xl border border-white/10 bg-black/25 p-5"
                  >
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xl font-black">{category.title || category.id}</div>
                        <div className="text-sm text-white/40">
                          {category.mods.length} mods in category
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <PrimaryButton onClick={() => addAdminMod(category.id)}>
                          <Plus size={18} />
                          Mod
                        </PrimaryButton>
                        <button
                          type="button"
                          onClick={() => removeAdminCategory(category.id)}
                          className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-200 hover:bg-red-500/25"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <AdminField
                        label="Category ID"
                        value={category.id}
                        onChange={(value) => updateAdminCategory(category.id, "id", value)}
                      />
                      <AdminField
                        label="Title"
                        value={category.title}
                        onChange={(value) => updateAdminCategory(category.id, "title", value)}
                      />
                      <AdminField
                        label="Image URL"
                        value={category.image || ""}
                        onChange={(value) => updateAdminCategory(category.id, "image", value)}
                      />
                      <AdminField
                        label="Description"
                        value={category.description}
                        onChange={(value) => updateAdminCategory(category.id, "description", value)}
                      />
                    </div>

                    <div className="mt-5 space-y-4">
                      {category.mods.map((mod) => (
                        <div key={mod.id} className="rounded-2xl border border-white/10 p-4">
                          <div className="mb-4 flex items-center justify-between gap-4">
                            <div className="font-black">{mod.name || mod.id}</div>
                            <button
                              type="button"
                              onClick={() => removeAdminMod(category.id, mod.id)}
                              className="grid h-10 w-10 place-items-center rounded-xl bg-red-500/15 text-red-200 hover:bg-red-500/25"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <AdminField
                              label="Mod ID"
                              value={mod.id}
                              onChange={(value) => updateAdminMod(category.id, mod.id, "id", value)}
                            />
                            <AdminField
                              label="Name"
                              value={mod.name}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "name", value)
                              }
                            />
                            <AdminField
                              label="Version"
                              value={mod.version}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "version", value)
                              }
                            />
                            <AdminField
                              label="Size"
                              value={mod.size}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "size", value)
                              }
                            />
                            <AdminField
                              label="Image URL"
                              value={mod.image || ""}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "image", value)
                              }
                            />
                            <AdminField
                              label="Download URL"
                              value={mod.downloadUrl}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "downloadUrl", value)
                              }
                            />
                          </div>

                          <AdminField
                            label="Description"
                            value={mod.description}
                            onChange={(value) =>
                              updateAdminMod(category.id, mod.id, "description", value)
                            }
                            multiline
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-5">
                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-black">Discord Admin</div>
                      <div className="text-sm text-white/40">Owner: 1452029134300774414</div>
                    </div>
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-black ${
                        adminMe?.role === "owner"
                          ? "bg-purple-500 text-white"
                          : adminMe?.role === "admin"
                            ? "bg-green-500 text-black"
                            : "bg-white/10 text-white/50"
                      }`}
                    >
                      {adminMe?.role || "not logged"}
                    </div>
                  </div>

                  {adminMe && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[.04] p-3 text-sm text-white/60">
                      Discord: {adminMe.username || "unknown"} · {adminMe.id}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <PrimaryButton onClick={openDiscordLogin}>Login Discord</PrimaryButton>
                    <PurpleButton disabled={loading} onClick={loadAdminProfile}>
                      Check session
                    </PurpleButton>
                    <PrimaryButton
                      disabled={loading || !canPublishCatalog}
                      onClick={pullCatalogFromAdminApi}
                    >
                      Pull redux.json
                    </PrimaryButton>
                    <PurpleButton
                      disabled={loading || !canPublishCatalog}
                      onClick={publishCatalogToAdminApi}
                    >
                      Publish redux.json
                    </PurpleButton>
                    <PurpleButton
                      disabled={loading || !canPublishLatest}
                      onClick={publishLatestToAdminApi}
                    >
                      Publish latest.json
                    </PurpleButton>
                    <PrimaryButton disabled={loading || adminMe?.role !== "owner"} onClick={checkGithubToken}>
                      Check GitHub token
                    </PrimaryButton>
                  </div>
                </div>

                {adminMe?.role === "owner" && (
                  <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                    <div className="mb-4 text-lg font-black">Admins</div>
                    <div className="grid gap-4">
                      <AdminField
                        label="Discord ID"
                        value={newAdminDiscordId}
                        onChange={setNewAdminDiscordId}
                      />
                      <AdminField label="Label" value={newAdminLabel} onChange={setNewAdminLabel} />
                      <PurpleButton disabled={loading} onClick={addBackendAdmin}>
                        <Plus size={18} />
                        Add admin
                      </PurpleButton>
                    </div>

                    <div className="mt-5 space-y-2">
                      {(backendAdmins?.admins || []).map((admin) => (
                        <div
                          key={admin.discordId}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-3"
                        >
                          <div>
                            <div className="font-mono text-sm">{admin.discordId}</div>
                            <div className="text-xs text-white/40">{admin.label || "admin"}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBackendAdmin(admin.discordId)}
                            className="grid h-10 w-10 place-items-center rounded-xl bg-red-500/15 text-red-200 hover:bg-red-500/25"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                      {backendAdmins && backendAdmins.admins.length === 0 && (
                        <div className="rounded-2xl border border-white/10 p-3 text-sm text-white/40">
                          No admins yet.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 text-lg font-black">Import catalog</div>
                  <textarea
                    value={adminImportText}
                    onChange={(event) => setAdminImportText(event.target.value)}
                    placeholder="Paste redux.json here"
                    className="h-40 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-xs outline-none"
                  />
                  <div className="mt-4 flex justify-end">
                    <PurpleButton onClick={importAdminCatalog}>Import</PurpleButton>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 text-lg font-black">redux.json</div>
                  <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
                    <MiniStat label="Schema" value="v1" />
                    <MiniStat label="Categories" value={String(catalogStats.categoryCount)} />
                    <MiniStat label="Mods" value={String(catalogStats.modCount)} />
                    <MiniStat
                      label="Issues"
                      value={String(
                        catalogStats.missingDownloads + catalogStats.duplicateIds.length,
                      )}
                      tone={
                        catalogStats.missingDownloads + catalogStats.duplicateIds.length > 0
                          ? "warning"
                          : "success"
                      }
                    />
                  </div>
                  {(catalogStats.missingDownloads > 0 || catalogStats.duplicateIds.length > 0) && (
                    <div className="mb-4 rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                      {catalogStats.missingDownloads > 0 && (
                        <div>{catalogStats.missingDownloads} mods without Download URL</div>
                      )}
                      {catalogStats.duplicateIds.length > 0 && (
                        <div>Duplicate mod IDs: {catalogStats.duplicateIds.join(", ")}</div>
                      )}
                    </div>
                  )}
                  <textarea
                    readOnly
                    value={adminCatalogJson}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-72 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-xs outline-none"
                  />
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 text-lg font-black">App update manifest</div>
                  <div className="mb-4 flex flex-wrap gap-3">
                    <PrimaryButton onClick={() => checkForAppUpdate(false)}>
                      <RefreshCw size={18} />
                      Check app update
                    </PrimaryButton>
                    <PurpleButton disabled={loading} onClick={installTauriUpdate}>
                      <Download size={18} />
                      Скачать обновление
                    </PurpleButton>
                  </div>
                  <div className="grid gap-4">
                    <AdminField
                      label="Version"
                      value={releaseVersion}
                      onChange={setReleaseVersion}
                    />
                    <AdminField label="Notes" value={releaseNotes} onChange={setReleaseNotes} />
                    <AdminField label="Installer URL" value={releaseUrl} onChange={setReleaseUrl} />
                    <AdminField
                      label="Signature"
                      value={releaseSignature}
                      onChange={setReleaseSignature}
                      multiline
                    />
                  </div>

                  <textarea
                    readOnly
                    value={releaseManifestJson}
                    onFocus={(event) => event.currentTarget.select()}
                    className="mt-4 h-48 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-xs outline-none"
                  />

                  <div className="mt-4 flex flex-wrap justify-end gap-3">
                    <PrimaryButton onClick={() => copyText(releaseManifestJson, "latest.json")}>
                      <Clipboard size={18} />
                      Copy
                    </PrimaryButton>
                    <PurpleButton
                      onClick={() => downloadTextFile("latest.json", releaseManifestJson)}
                    >
                      <Download size={18} />
                      Export
                    </PurpleButton>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-sm text-white/55">
                  <div className="mb-3 text-lg font-black text-white">Release flow</div>
                  <div className="space-y-2">
                    <div>1. Zip mod files relative to GTA V root.</div>
                    <div>2. Upload zip to GitHub Release or data repo.</div>
                    <div>3. Paste direct zip URL into Download URL.</div>
                    <div>4. Export redux.json and upload it to the data repo.</div>
                    <div>5. Build Tauri release, paste URL/signature, export latest.json.</div>
                  </div>
                </div>
              </div>
            </div>
          </ToolPanel>
        )}

        {page === "settings" && (
          <ToolPanel title="Настройки" icon={<Settings />} onBack={() => setPage("home")}>
            <div className="mb-8">
              <div className="mb-3 text-sm font-black uppercase tracking-[.2em] text-white/35">
                GTA V PATH
              </div>

              <div className="grid grid-cols-[1fr_auto_auto] gap-4">
                <input
                  value={gtaPath}
                  onChange={(e) => setGtaPath(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 outline-none"
                  placeholder="Путь GTA V"
                />

                <PrimaryButton onClick={chooseGtaFolderManual}>Выбрать</PrimaryButton>

                <PurpleButton onClick={detectGta}>Найти GTA</PurpleButton>
              </div>
            </div>

            <div className="mb-8">
              <div className="mb-3 text-sm font-black uppercase tracking-[.2em] text-white/35">
                SYSTEM FILES LOCATION
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-4">
                <input
                  value={systemPath}
                  onChange={(e) => setSystemPath(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 outline-none"
                  placeholder="Папка downloads / backups / temp"
                />

                <PrimaryButton onClick={chooseSystemFolder}>Выбрать папку</PrimaryButton>
              </div>
            </div>

            <div className="mb-8 flex justify-end">
              <PurpleButton disabled={loading} onClick={saveManualSettings}>
                Сохранить настройки
              </PurpleButton>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <SettingsCard
                icon={<Gamepad2 />}
                title="GTA V"
                value={gtaPath ? "Configured" : "Missing"}
              />

              <SettingsCard
                icon={<Package />}
                title="Installed Mods"
                value={String(Object.keys(installedRedux).length)}
              />

              <SettingsCard
                icon={<Download />}
                title="System Files"
                value={systemPath ? "Custom" : "AppData"}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={() => checkForAppUpdate(false)}>
                <RefreshCw size={18} />
                Check app update
              </PrimaryButton>
              <PurpleButton disabled={loading} onClick={installTauriUpdate}>
                <Download size={18} />
                Скачать обновление
              </PurpleButton>
            </div>
          </ToolPanel>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/45 px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex items-center gap-3 text-sm font-bold">
            <span
              className={`h-3 w-3 rounded-full ${loading ? "bg-yellow-400" : "bg-green-400"}`}
            />

            <span>СТАТУС: {status}</span>
          </div>

          {loading && (
            <div className="w-[300px]">
              <div className="mb-2 text-right text-xs text-white/45">{installStep}</div>

              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-purple-500 transition-all"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function buildRpfTree(entries: string[]): RpfNode[] {
  const root: RpfNode[] = [];

  for (const raw of entries) {
    const clean = raw.replace("[FILE]", "").replace("[DIR]", "").trim();

    if (!clean) continue;

    const type = raw.includes("[DIR]") ? "dir" : "file";

    const parts = clean.split(/[\\/]/).filter(Boolean);

    let current = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let node = current.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: index === parts.length - 1 ? type : "dir",
          children: [],
        };

        current.push(node);
      }

      current = node.children;
    });
  }

  return root;
}

function filterTree(nodes: RpfNode[], search: string): RpfNode[] {
  if (!search.trim()) {
    return nodes;
  }

  return nodes
    .map((node) => {
      const children = filterTree(node.children, search);

      const matches = node.name.toLowerCase().includes(search.toLowerCase());

      if (matches || children.length > 0) {
        return {
          ...node,
          children,
        };
      }

      return null;
    })
    .filter(Boolean) as RpfNode[];
}

function TreeView({
  nodes,
  selectedPath,
  onSelect,
  level = 0,
}: {
  nodes: RpfNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  level?: number;
}) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            onClick={() => onSelect(node.path)}
            className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${
              selectedPath === node.path ? "bg-purple-600" : "bg-white/5 hover:bg-white/10"
            }`}
            style={{
              paddingLeft: 12 + level * 18,
            }}
          >
            {node.type === "dir" ? (
              <Folder size={17} className="text-purple-300" />
            ) : (
              <FileText size={17} className="text-white/50" />
            )}

            <span>{node.name}</span>
          </button>

          {node.children.length > 0 && (
            <TreeView
              nodes={node.children}
              selectedPath={selectedPath}
              onSelect={onSelect}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DiscordLoginScreen({
  loading,
  status,
  onCheck,
  onLogin,
}: {
  loading: boolean;
  status: string;
  onCheck: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#050507] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(124,58,237,.25),transparent_30%)]" />

      <main className="relative z-10 grid min-h-screen place-items-center px-8 py-12">
        <div className="w-full max-w-[680px] rounded-[36px] border border-white/10 bg-black/45 p-8 shadow-[0_0_70px_rgba(168,85,247,.22)] backdrop-blur-xl">
          <div className="mb-8 flex items-center gap-4">
            <img src="/hardy-h.png" className="h-14 w-14 object-contain" />
            <div>
              <div className="text-3xl font-black">HARDY MODS</div>
              <div className="text-sm font-bold uppercase tracking-[.22em] text-white/35">
                Discord login
              </div>
            </div>
          </div>

          <div className="mb-8 rounded-3xl border border-white/10 bg-white/[.04] p-5">
            <div className="mb-2 flex items-center gap-3 text-lg font-black">
              <ShieldCheck size={22} className="text-purple-300" />
              Login через Discord
            </div>
            <div className="text-sm leading-6 text-white/55">
              Все пользователи заходят через Discord. Если роль owner или admin, после входа
              появится кнопка Admin.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <PrimaryButton disabled={loading} onClick={onLogin}>
              <User size={18} />
              Login Discord
            </PrimaryButton>
            <PurpleButton disabled={loading} onClick={onCheck}>
              Continue
            </PurpleButton>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm text-white/55">
            Status: {status}
          </div>
        </div>
      </main>
    </div>
  );
}

type ButtonActionProps = {
  children: ReactNode;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  disabled?: boolean;
};

function DashboardCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[30px] border border-white/10 bg-white/[.045] p-7 text-left transition hover:-translate-y-2 hover:bg-white/[.07]"
    >
      <div className="mb-8 grid h-16 w-16 place-items-center rounded-2xl bg-purple-600">{icon}</div>

      <h3 className="text-3xl font-black">{title}</h3>
      <p className="mt-3 text-white/45">{description}</p>
    </button>
  );
}

function ModCard({
  item,
  installed,
  loading,
  onInstall,
  onRestore,
}: {
  item: ModItem;
  installed?: InstalledMod;
  loading: boolean;
  onInstall: () => void;
  onRestore: () => void;
}) {
  const hasUpdate = Boolean(installed && installed.version !== item.version);
  const installDisabled = loading || (Boolean(installed) && !hasUpdate);

  return (
    <div className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[.045]">
      <div className="relative h-56 bg-gradient-to-br from-purple-800 to-blue-900">
        {item.image && <img src={item.image} className="h-full w-full object-cover" />}

        <div className="absolute left-4 top-4 rounded-full bg-black/55 px-4 py-2 text-sm font-black">
          v{item.version}
        </div>

        <div
          className={`absolute right-4 top-4 rounded-full px-4 py-2 text-sm font-black ${
            installed ? (hasUpdate ? "bg-yellow-500 text-black" : "bg-green-600") : "bg-purple-600"
          }`}
        >
          {installed ? (hasUpdate ? "Update" : "Installed") : "New"}
        </div>
      </div>

      <div className="p-6">
        <h3 className="text-3xl font-black">{item.name}</h3>
        <p className="mt-3 text-white/55">{item.description}</p>
        <p className="mt-3 text-white/35">
          {item.size}
          {installed && <span className="ml-2 text-white/45">installed v{installed.version}</span>}
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={installDisabled}
            onClick={onInstall}
            className={`flex-1 rounded-2xl py-4 font-black ${
              installed && !hasUpdate ? "bg-green-600" : "bg-purple-600 hover:bg-purple-500"
            } disabled:opacity-40`}
          >
            {hasUpdate ? "Обновить" : installed ? "Установлено" : "Установить"}
          </button>

          <button
            type="button"
            disabled={!installed || loading}
            onClick={onRestore}
            title="Восстановить backup / удалить мод"
            className="rounded-2xl bg-white/10 px-5 disabled:opacity-40"
          >
            <RotateCcw />
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex h-14 min-w-[320px] items-center gap-3 rounded-2xl border border-white/10 bg-black/35 px-5">
      <Search size={18} className="text-white/35" />

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search..."
        className="w-full bg-transparent outline-none placeholder:text-white/30"
      />
    </div>
  );
}

function FilterButton({ children, active, onClick }: ButtonActionProps & { active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-14 rounded-2xl px-5 font-black ${
        active ? "bg-purple-600" : "bg-white/10 hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

function SettingsCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/25 p-6">
      <div className="mb-4 flex items-center gap-3 text-purple-400">
        {icon}
        <span className="font-black">{title}</span>
      </div>

      <div className="text-3xl font-black">{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "text-green-300" : tone === "warning" ? "text-yellow-200" : "text-white";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-3">
      <div className="text-[11px] uppercase tracking-[.16em] text-white/35">{label}</div>
      <div className={`mt-1 text-lg font-black ${toneClass}`}>{value}</div>
    </div>
  );
}

function TopButton({ children, onClick }: ButtonActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-white/10 px-5 py-3 font-black hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function CircleButton({ children, onClick }: ButtonActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-12 w-12 place-items-center rounded-full bg-white/10 hover:bg-white/15"
    >
      {children}
    </button>
  );
}

function BackButton({ onClick }: Pick<ButtonActionProps, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-8 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-4 font-black text-black"
    >
      <ArrowLeft />
      Назад
    </button>
  );
}

function ToolPanel({
  title,
  icon,
  children,
  onBack,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onBack: () => void;
}) {
  return (
    <section className="pt-10">
      <BackButton onClick={onBack} />

      <div className="rounded-[36px] border border-white/10 bg-white/[.045] p-8">
        <div className="mb-8 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-3xl bg-purple-600">{icon}</div>

          <h2 className="text-5xl font-black">{title}</h2>
        </div>

        {children}
      </div>
    </section>
  );
}

function PathBox({ text }: { text: ReactNode }) {
  return (
    <div className="mb-5 break-all rounded-2xl border border-white/10 bg-black/35 p-5 text-white/65">
      {text}
    </div>
  );
}

function AdminField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-[.18em] text-white/35">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 w-full resize-y rounded-2xl border border-white/10 bg-black/35 px-4 py-3 outline-none"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 outline-none"
        />
      )}
    </label>
  );
}

function PrimaryButton({ children, onClick, disabled }: ButtonActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 font-black text-black transition hover:scale-105 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PurpleButton({ children, onClick, disabled }: ButtonActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-2xl bg-purple-600 px-6 py-4 font-black hover:bg-purple-500 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
