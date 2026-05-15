import React, {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
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
  Bell,
  Clipboard,
  Download,
  FileArchive,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  Home,
  LogIn,
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

type RpfPatch = {
  file: string;
  internalPath: string;
  rpfPath: string;
};

type ModItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  size: string;
  image?: string;
  downloadUrl: string;
  rpfPatches?: RpfPatch[];
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

type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

type LoginCardSpec = {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  depth: "clear" | "soft" | "depth";
  height: number;
  hue: number;
  left: number;
  rotation: number;
  top: number;
  width: number;
  delay: number;
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
const APP_VERSION = "0.1.61";

const LOGIN_CARD_TITLES = [
  ["Redux", "visual pack", "RD"],
  ["RPF", "unlock ready", "RP"],
  ["Neon", "city glow", "NE"],
  ["Drift", "street setup", "DR"],
  ["Ultra", "graphics", "UL"],
  ["Mods", "catalog", "MO"],
  ["Night", "preset", "NI"],
] as const;

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

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createLoginCards(count = 6): LoginCardSpec[] {
  const slots = [
    { left: 8, top: 8 },
    { left: 28, top: 3 },
    { left: 56, top: 9 },
    { left: 6, top: 34 },
    { left: 37, top: 30 },
    { left: 66, top: 25 },
  ];

  return Array.from({ length: count }, (_, index) => {
    const preset = LOGIN_CARD_TITLES[index % LOGIN_CARD_TITLES.length];
    const slot = slots[index % slots.length];

    return {
      id: `${preset[0]}-${index}`,
      title: preset[0],
      subtitle: preset[1],
      accent: preset[2],
      depth: index % 5 === 0 ? "depth" : index % 3 === 0 ? "soft" : "clear",
      height: randomBetween(11.5, 17.5),
      hue: randomBetween(205, 320),
      left: slot.left + randomBetween(-3, 3),
      rotation: randomBetween(-13, 13),
      top: slot.top + randomBetween(-3, 3),
      width: randomBetween(8.8, 12.8),
      delay: randomBetween(-9, 0),
    };
  });
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
    rpfPatches: normalizeRpfPatches(value.rpfPatches ?? value.rpf_patches),
  };
}

function normalizeRpfPatches(value: unknown): RpfPatch[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const patches = value
    .map((entry): RpfPatch | null => {
      if (!isRecord(entry)) return null;

      const rpfPath = readString(entry.rpfPath ?? entry.rpf_path).trim();
      const internalPath = readString(entry.internalPath ?? entry.internal_path).trim();
      const file = readString(entry.file).trim();

      if (!rpfPath || !internalPath || !file) return null;

      return { file, internalPath, rpfPath };
    })
    .filter((patch): patch is RpfPatch => Boolean(patch));

  return patches.length > 0 ? patches : undefined;
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

function createRpfPatch(): RpfPatch {
  return {
    file: "patch/file.meta",
    internalPath: "x64/path/file.meta",
    rpfPath: "update/update.rpf",
  };
}

function updateRpfPatchField(patch: RpfPatch, field: keyof RpfPatch, value: string): RpfPatch {
  const normalized = value.replaceAll("\\", "/").trim();

  if (field === "rpfPath") {
    const markerIndex = normalized.toLowerCase().indexOf(".rpf/");

    if (markerIndex >= 0) {
      const rpfEnd = markerIndex + ".rpf".length;

      return {
        ...patch,
        rpfPath: normalized.slice(0, rpfEnd),
        internalPath: normalized.slice(rpfEnd + 1),
      };
    }
  }

  return {
    ...patch,
    [field]:
      field === "file" || field === "internalPath" || field === "rpfPath" ? normalized : value,
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

    if (
      url.protocol !== ADMIN_DEEP_LINK_PROTOCOL &&
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    const token = url.searchParams.get("discord_token")?.trim() || "";
    const apiUrl =
      url.searchParams.get("admin_api_url")?.trim().replace(/\/+$/, "") || DEFAULT_ADMIN_API_URL;

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
  const [releaseVersion, setReleaseVersion] = useState(APP_VERSION);
  const [releaseNotes, setReleaseNotes] = useState("Hardy MODS Update");
  const [releaseUrl, setReleaseUrl] = useState(
    `https://github.com/hsoltanov2007-code/majestic-redux-manager/releases/download/v${APP_VERSION}/Hardy.MODS_${APP_VERSION}_x64-setup.exe`,
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
  const heroMotionFrame = useRef<number | null>(null);
  const heroMotionPointer = useRef<{ root: HTMLElement; x: number; y: number } | null>(null);

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

    getCurrent()
      .then(acceptAdminUrls)
      .catch(() => undefined);

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

  const catalogModCount = useMemo(
    () => categories.reduce((total, category) => total + category.mods.length, 0),
    [categories],
  );

  const catalogInstalledCount = useMemo(
    () =>
      categories.reduce(
        (total, category) =>
          total + category.mods.filter((mod) => Boolean(installedRedux[mod.id])).length,
        0,
      ),
    [categories, installedRedux],
  );

  const featuredMods = useMemo(() => {
    return categories.flatMap((category) =>
      category.mods.slice(0, 3).map((mod) => ({
        category,
        mod,
      })),
    );
  }, [categories]);

  const heroMods = useMemo(() => {
    const source =
      featuredMods.length > 0
        ? featuredMods
        : [
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(1),
                description: "Redux visual package",
                image: "",
                name: "Majestic Redux",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(2),
                description: "Player build",
                image: "",
                name: "Killa Tops",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(3),
                description: "RPF ready pack",
                image: "",
                name: "Venom Redux",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(4),
                description: "Graphics bundle",
                image: "",
                name: "Best Redux",
              },
            },
          ];

    return source.slice(0, 6);
  }, [featuredMods]);

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

      if (list.length === 0) {
        throw new Error("Catalog is empty");
      }

      setCategories(list);
      setStatus("Каталог обновлён");
    } catch (err) {
      try {
        const fallback = await fetchCatalog("/redux.example.json");

        if (fallback.length === 0) {
          throw new Error("Local catalog is empty");
        }

        setCategories(fallback);
        setStatus("Каталог загружен из локального примера");
      } catch {
        setStatus("Ошибка загрузки категорий: " + String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  function openCatalog() {
    setSelectedCategory(null);
    setSearchText("");
    setFilterMode("all");
    setPage("catalog");

    if (!loading && categories.length === 0) {
      void loadCategories();
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

  function addAdminRpfPatch(categoryId: string, modId: string) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: category.mods.map((mod) =>
                mod.id === modId
                  ? {
                      ...mod,
                      rpfPatches: [...(mod.rpfPatches || []), createRpfPatch()],
                    }
                  : mod,
              ),
            }
          : category,
      ),
    );
  }

  function updateAdminRpfPatch(
    categoryId: string,
    modId: string,
    patchIndex: number,
    field: keyof RpfPatch,
    value: string,
  ) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: category.mods.map((mod) =>
                mod.id === modId
                  ? {
                      ...mod,
                      rpfPatches: (mod.rpfPatches || []).map((patch, index) =>
                        index === patchIndex ? updateRpfPatchField(patch, field, value) : patch,
                      ),
                    }
                  : mod,
              ),
            }
          : category,
      ),
    );
  }

  function removeAdminRpfPatch(categoryId: string, modId: string, patchIndex: number) {
    setAdminCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              mods: category.mods.map((mod) =>
                mod.id === modId
                  ? {
                      ...mod,
                      rpfPatches: (mod.rpfPatches || []).filter((_, index) => index !== patchIndex),
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

  function openFeaturedMod(category: Category, mod: ModItem) {
    setSelectedCategory(category);
    setSearchText(mod.name);
    setFilterMode("all");
    setPage("category");
    setStatus(`${mod.name} ready to install`);
  }

  function moveHeroMotion(event: React.PointerEvent<HTMLElement>) {
    heroMotionPointer.current = {
      root: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
    };

    if (heroMotionFrame.current !== null) return;

    heroMotionFrame.current = window.requestAnimationFrame(() => {
      heroMotionFrame.current = null;
      const pointer = heroMotionPointer.current;

      if (!pointer) return;

      const rail = pointer.root.querySelector<HTMLElement>(".hero-rail-stage");
      const rect = (rail ?? pointer.root).getBoundingClientRect();
      const outsideX = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
      const outsideY = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
      const distance = Math.hypot(outsideX, outsideY);
      const proximity = clamp01(1 - distance / 520);
      const easedProximity = proximity * proximity * (3 - 2 * proximity);

      pointer.root.style.setProperty("--hero-proximity", easedProximity.toFixed(3));
      pointer.root.style.setProperty("--hero-rail-up-duration", `${28 + easedProximity * 34}s`);
      pointer.root.style.setProperty("--hero-rail-down-duration", `${32 + easedProximity * 36}s`);
      pointer.root.style.setProperty("--hero-spin-duration", `${10 + easedProximity * 26}s`);
      const shake = easedProximity * 2.4;

      pointer.root.style.setProperty("--hero-shake", `${shake}px`);
      pointer.root.style.setProperty("--hero-shake-neg", `${-shake}px`);
    });
  }

  function resetHeroMotion(event: React.PointerEvent<HTMLElement>) {
    if (heroMotionFrame.current !== null) {
      window.cancelAnimationFrame(heroMotionFrame.current);
      heroMotionFrame.current = null;
    }

    heroMotionPointer.current = null;
    event.currentTarget.style.setProperty("--hero-proximity", "0");
    event.currentTarget.style.setProperty("--hero-rail-up-duration", "28s");
    event.currentTarget.style.setProperty("--hero-rail-down-duration", "32s");
    event.currentTarget.style.setProperty("--hero-spin-duration", "10s");
    event.currentTarget.style.setProperty("--hero-shake", "0px");
    event.currentTarget.style.setProperty("--hero-shake-neg", "0px");
  }

  function moveHeroCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const px = (x / rect.width - 0.5) * 2;
    const py = (y / rect.height - 0.5) * 2;
    const rx = py * -20;
    const ry = px * 24;

    card.style.setProperty("--mx", `${x}px`);
    card.style.setProperty("--my", `${y}px`);
    card.style.setProperty("--px", px.toFixed(3));
    card.style.setProperty("--py", py.toFixed(3));
    card.style.setProperty("--image-x", `${px * -18}px`);
    card.style.setProperty("--image-y", `${py * -18}px`);
    card.style.setProperty("--copy-x", `${px * 7}px`);
    card.style.setProperty("--copy-y", `${py * 5}px`);
    card.style.setProperty("--rx", `${rx}deg`);
    card.style.setProperty("--ry", `${ry}deg`);
  }

  function resetHeroCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    const card = event.currentTarget;

    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--px", "0");
    card.style.setProperty("--py", "0");
    card.style.setProperty("--image-x", "0px");
    card.style.setProperty("--image-y", "0px");
    card.style.setProperty("--copy-x", "0px");
    card.style.setProperty("--copy-y", "0px");
    card.style.setProperty("--mx", "50%");
    card.style.setProperty("--my", "50%");
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
        const admins = await adminRequest<AdminStateDocument>(
          "/api/admins",
          {
            headers: authHeaders,
          },
          { apiUrl: cleanUrl, token },
        );
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
        rpfPatches: item.rpfPatches || [],
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
    <div className="min-h-screen overflow-hidden bg-[#09090b] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_16%_36%,rgba(255,255,255,.22),transparent_25%),radial-gradient(circle_at_78%_18%,rgba(255,255,255,.16),transparent_23%),linear-gradient(135deg,#151517_0%,#050506_46%,#1b1b1f_100%)]" />
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[size:76px_76px] opacity-45" />
      <div className="pointer-events-none fixed -left-16 top-40 h-64 w-64 rotate-12 border border-white/18 shadow-[0_0_60px_rgba(255,255,255,.10)]" />
      <div className="pointer-events-none fixed right-24 top-24 h-40 w-40 rotate-45 border border-white/18 shadow-[0_0_50px_rgba(255,255,255,.10)]" />

      <header className="relative z-20 h-[88px] border-b border-white/15 bg-black/45 shadow-[0_18px_70px_rgba(0,0,0,.38)] backdrop-blur-2xl">
        <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[160px_1fr_250px] items-center gap-6 px-7">
          <button
            onClick={() => {
              setPage("home");
              setSelectedCategory(null);
            }}
            className="grid h-12 w-36 place-items-center rounded-2xl border border-white/15 bg-white/[.035] text-white shadow-[0_0_28px_rgba(255,255,255,.08)] transition hover:bg-white/[.08]"
          >
            <Home size={36} />
          </button>

          <div className="mx-auto flex h-14 items-center gap-2 rounded-[28px] border border-white/10 bg-white/[.045] px-2 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] backdrop-blur-2xl">
            <TopButton onClick={() => setPage("home")}>Главная</TopButton>
            <TopButton onClick={openCatalog}>Mods</TopButton>
            <TopButton onClick={() => setPage("rpf")}>RPF Unlocker</TopButton>
            <TopButton onClick={() => setPage("rpfExplorer")}>RPF Explorer</TopButton>
            <TopButton onClick={() => setPage("settings")}>Settings</TopButton>
            {canOpenAdmin && <TopButton onClick={openAdmin}>Admin</TopButton>}
          </div>

          <div className="flex items-center justify-end gap-3">
            <CircleButton onClick={() => checkForAppUpdate(false)}>
              <Bell size={18} />
            </CircleButton>

            <CircleButton onClick={detectGta}>
              <FolderSearch size={18} />
            </CircleButton>

            <button
              type="button"
              onClick={logoutDiscord}
              className="flex h-12 items-center gap-3 rounded-2xl border border-white/15 bg-white/[.06] px-6 font-black text-white transition hover:bg-white/[.12]"
            >
              <LogOut size={18} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main
        className={`relative z-10 mx-auto max-w-[1600px] ${
          page === "home" ? "h-[calc(100vh-88px)] overflow-hidden px-0 pb-0" : "px-8 pb-28"
        }`}
      >
        {tauriUpdate && (
          <div className="mt-8 overflow-hidden rounded-[28px] border border-white/15 bg-black/45 shadow-[0_0_45px_rgba(255,255,255,.12)]">
            <div className="flex items-center justify-between gap-6 border-b border-white/10 bg-white/[.06] px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-black">
                  <Download size={22} />
                </div>
                <div>
                  <div className="text-2xl font-black">Есть обновление</div>
                  <div className="text-sm text-white/55">Hardy MODS можно обновить сейчас</div>
                </div>
              </div>

              <button
                onClick={installTauriUpdate}
                disabled={loading}
                className="rounded-2xl bg-white px-6 py-4 font-black text-black hover:scale-105 transition disabled:opacity-40"
              >
                Скачать и установить
              </button>
            </div>

            <div className="grid grid-cols-[1fr_1fr_1.5fr] border-b border-white/10 text-sm">
              <div className="border-r border-white/10 px-6 py-4">
                <div className="text-xs font-black uppercase tracking-[.18em] text-white/35">
                  Версия
                </div>
                <div className="mt-2 font-mono text-lg text-zinc-200">v{tauriUpdate.version}</div>
              </div>
              <div className="border-r border-white/10 px-6 py-4">
                <div className="text-xs font-black uppercase tracking-[.18em] text-white/35">
                  Статус
                </div>
                <div className="mt-2 text-lg font-black">
                  {loading ? installStep || "Скачивание" : "Готово к скачиванию"}
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="text-xs font-black uppercase tracking-[.18em] text-white/35">
                  Что делать
                </div>
                <div className="mt-2 text-white/65">
                  Нажми кнопку, app скачает обновление и запустит установщик.
                </div>
              </div>
            </div>

            {loading && installStep && (
              <div className="px-6 py-5">
                <div className="mb-2 flex items-center justify-between text-sm text-white/55">
                  <span>{installStep}</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-white transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {page === "home" && (
          <section
            className="home-stage relative grid h-full min-h-0 grid-cols-[minmax(430px,.72fr)_minmax(640px,1.28fr)] items-center gap-8 overflow-hidden"
            onPointerMove={moveHeroMotion}
            onPointerLeave={resetHeroMotion}
          >
            <div className="relative z-10 pl-10">
              <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-white/18 bg-white/[.07] px-5 py-2 text-xs font-black uppercase tracking-[.25em] text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-xl">
                <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,.85)]" />
                THE BEST CATALOG OF MODIFICATIONS
              </div>

              <div className="relative inline-block">
                <img
                  src="/hardy-h.png"
                  className="mx-auto h-[300px] w-[300px] object-contain opacity-95 drop-shadow-[0_0_50px_rgba(255,255,255,.20)]"
                />
                <div className="-mt-16 text-center">
                  <div className="text-[76px] font-black leading-none text-white drop-shadow-[0_0_22px_rgba(255,255,255,.28)]">
                    HARDY
                  </div>
                  <div className="text-[74px] font-black leading-none text-zinc-300 drop-shadow-[0_0_26px_rgba(255,255,255,.32)]">
                    MODS
                  </div>
                </div>
              </div>

              <div className="mt-10 flex gap-5">
                <button
                  type="button"
                  onClick={openCatalog}
                  className="h-16 min-w-[210px] rounded-2xl bg-white px-8 text-xl font-black text-black shadow-[0_0_34px_rgba(255,255,255,.30)] transition hover:scale-[1.03]"
                >
                  Каталог модов
                </button>
              </div>
            </div>

            <div className="hero-rail-stage relative h-full min-h-0">
              {[0, 1].map((lane) => {
                const laneMods = [...heroMods, ...heroMods, ...heroMods];

                return (
                  <div
                    key={`lane-${lane}`}
                    className={`hero-rail hero-rail-${lane === 0 ? "up" : "down"}`}
                  >
                    {laneMods.map(({ category, mod }, index) => {
                      const blurClass =
                        index % 11 === 0
                          ? "hero-strip-card--depth-blur"
                          : index % 5 === 0
                            ? "hero-strip-card--soft-blur"
                            : "";

                      return (
                        <button
                          key={`${lane}-${category.id}-${mod.id}-${index}`}
                          type="button"
                          onPointerMove={moveHeroCardLight}
                          onPointerLeave={resetHeroCardLight}
                          onClick={() => openFeaturedMod(category, mod)}
                          className={`hero-strip-card ${blurClass}`}
                          style={
                            {
                              "--hero-card-delay": `${(index + lane * 3) * -0.58}s`,
                            } as React.CSSProperties
                          }
                        >
                          <div className="hero-strip-card-motion">
                            <div className="hero-strip-card-inner">
                              {mod.image ? (
                                <img src={mod.image} className="hero-strip-card-image" />
                              ) : (
                                <div className="hero-strip-card-fallback" />
                              )}
                              <div className="hero-strip-card-shade" />
                              <div className="hero-strip-card-light" />
                              <div className="hero-strip-card-copy absolute bottom-4 left-4 right-4 text-left">
                                <div className="hero-strip-card-badge mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/55 px-3 py-1 text-[11px] font-black uppercase tracking-[.16em] text-white/75 backdrop-blur-md">
                                  <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.8)]" />
                                  {category.title || "Redux"}
                                </div>
                                <div className="hero-strip-card-title font-black uppercase text-white drop-shadow-[0_2px_14px_rgba(0,0,0,.9)]">
                                  {mod.name}
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {page === ("home-legacy" as Page) && (
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
                    onClick={openCatalog}
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
          <section className="catalog-section pt-10">
            <BackButton onClick={() => setPage("home")} />

            <div className="catalog-hero mb-6">
              <div>
                <div className="catalog-kicker">Hardy collection</div>
                <h2 className="mt-3 text-5xl font-black">Каталог модов</h2>
                <p className="mt-3 max-w-2xl text-white/55">
                  Glass категории, neon glow и быстрый доступ к модам без пустого экрана.
                </p>
              </div>

              <div className="catalog-stats">
                <MiniStat label="Categories" value={String(categories.length)} />
                <MiniStat label="Mods" value={String(catalogModCount)} />
                <MiniStat label="Installed" value={String(catalogInstalledCount)} tone="success" />
              </div>
            </div>

            <div className="catalog-toolbar mb-8">
              <SearchBox value={searchText} onChange={setSearchText} />

              <div className="flex flex-wrap gap-3">
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

                <FilterButton active={false} onClick={() => void loadCategories()}>
                  Refresh
                </FilterButton>
              </div>
            </div>

            {loading && categories.length === 0 ? (
              <div className="catalog-grid">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="category-card category-card--loading" />
                ))}
              </div>
            ) : filteredCategories.length > 0 ? (
              <div className="catalog-grid">
                {filteredCategories.map((category, index) => {
                  const installedCount = category.mods.filter(
                    (mod) => installedRedux[mod.id],
                  ).length;
                  const hue = 215 + ((index * 37) % 95);

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(category);
                        setPage("category");
                        setSearchText("");
                      }}
                      className="category-card group"
                      style={
                        {
                          "--category-delay": `${index * 70}ms`,
                          "--category-hue": hue,
                        } as CssVars
                      }
                    >
                      <div className="category-card-glow" />
                      <div className="category-card-media">
                        {category.image ? (
                          <img src={category.image} className="h-full w-full object-cover" />
                        ) : (
                          <div className="category-card-fallback">
                            <Package size={48} />
                          </div>
                        )}
                        <div className="category-card-orbit" />
                      </div>

                      <div className="category-card-body">
                        <div className="category-card-meta">
                          <span>{category.mods.length} mods</span>
                          <span>{installedCount} installed</span>
                        </div>
                        <h3>{category.title}</h3>
                        <p>{category.description || "Fresh mods collection for Hardy MODS."}</p>
                        <div className="category-card-action">Открыть</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="catalog-empty">
                <div className="catalog-empty-icon">
                  <Package size={34} />
                </div>
                <h3>Каталог не пустой экран</h3>
                <p>
                  Ничего не найдено по фильтрам или каталог не успел загрузиться. Можно обновить
                  список без перезапуска приложения.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <PrimaryButton onClick={() => void loadCategories()}>Refresh</PrimaryButton>
                  <PurpleButton onClick={() => setSearchText("")}>Clear search</PurpleButton>
                </div>
              </div>
            )}
          </section>
        )}

        {page === ("catalog-legacy" as Page) && !selectedCategory && (
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
          <section className="catalog-section pt-10">
            <BackButton
              onClick={() => {
                setSelectedCategory(null);
                setPage("catalog");
              }}
            />

            <div className="catalog-hero mb-8">
              <div>
                <div className="catalog-kicker">Selected category</div>
                <h2 className="text-5xl font-black">{selectedCategory.title}</h2>

                <p className="mt-3 text-white/45">{selectedCategory.description}</p>
              </div>

              <div className="flex flex-wrap justify-end gap-4">
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

            {categoryMods.length === 0 ? (
              <div className="catalog-empty">
                <div className="catalog-empty-icon">
                  <Search size={34} />
                </div>
                <h3>Моды не найдены</h3>
                <p>Сбрось поиск или фильтр, и карточки сразу появятся обратно.</p>
                <div className="mt-5 flex justify-center gap-3">
                  <PrimaryButton onClick={() => setSearchText("")}>Clear search</PrimaryButton>
                  <PurpleButton onClick={() => setFilterMode("all")}>All mods</PurpleButton>
                </div>
              </div>
            ) : (
              <div className="catalog-grid">
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
            )}
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

                          <div className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <div className="font-black">RPF patches</div>
                                <div className="text-xs text-white/45">
                                  Path can start with update/update.rpf; app also tries
                                  mods/update/update.rpf
                                </div>
                              </div>
                              <PrimaryButton onClick={() => addAdminRpfPatch(category.id, mod.id)}>
                                <Plus size={18} />
                                RPF patch
                              </PrimaryButton>
                            </div>

                            {(mod.rpfPatches || []).length === 0 && (
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/45">
                                No RPF patches. This mod will copy normal files from the zip.
                              </div>
                            )}

                            <div className="space-y-3">
                              {(mod.rpfPatches || []).map((patch, patchIndex) => (
                                <div
                                  key={`${mod.id}-rpf-${patchIndex}`}
                                  className="rounded-xl border border-white/10 bg-black/25 p-3"
                                >
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="text-sm font-black">
                                      Patch #{patchIndex + 1}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeAdminRpfPatch(category.id, mod.id, patchIndex)
                                      }
                                      className="grid h-9 w-9 place-items-center rounded-xl bg-red-500/15 text-red-200 hover:bg-red-500/25"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-3 gap-3">
                                    <AdminField
                                      label="RPF path"
                                      value={patch.rpfPath}
                                      onChange={(value) =>
                                        updateAdminRpfPatch(
                                          category.id,
                                          mod.id,
                                          patchIndex,
                                          "rpfPath",
                                          value,
                                        )
                                      }
                                    />
                                    <AdminField
                                      label="Internal path"
                                      value={patch.internalPath}
                                      onChange={(value) =>
                                        updateAdminRpfPatch(
                                          category.id,
                                          mod.id,
                                          patchIndex,
                                          "internalPath",
                                          value,
                                        )
                                      }
                                    />
                                    <AdminField
                                      label="File in zip"
                                      value={patch.file}
                                      onChange={(value) =>
                                        updateAdminRpfPatch(
                                          category.id,
                                          mod.id,
                                          patchIndex,
                                          "file",
                                          value,
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
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
                    <PrimaryButton
                      disabled={loading || adminMe?.role !== "owner"}
                      onClick={checkGithubToken}
                    >
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

            <div className="grid grid-cols-4 gap-6">
              <SettingsCard icon={<FileText />} title="App Version" value={`v${APP_VERSION}`} />

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
  const loginMotionFrame = useRef<number | null>(null);
  const loginMotionPointer = useRef<{ root: HTMLElement; x: number; y: number } | null>(null);
  const loginCards = useMemo(() => createLoginCards(), []);

  function moveLoginCards(event: React.PointerEvent<HTMLElement>) {
    loginMotionPointer.current = {
      root: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
    };

    if (loginMotionFrame.current !== null) return;

    loginMotionFrame.current = window.requestAnimationFrame(() => {
      loginMotionFrame.current = null;
      const pointer = loginMotionPointer.current;

      if (!pointer) return;

      const stage = pointer.root.querySelector<HTMLElement>(".login-card-stage");
      const rect = (stage ?? pointer.root).getBoundingClientRect();
      const outsideX = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
      const outsideY = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
      const distance = Math.hypot(outsideX, outsideY);
      const proximity = clamp01(1 - distance / 420);
      const easedProximity = proximity * proximity * (3 - 2 * proximity);
      const shake = easedProximity * 2;

      pointer.root.style.setProperty("--login-motion-duration", `${12 + easedProximity * 18}s`);
      pointer.root.style.setProperty("--login-shake", `${shake}px`);
      pointer.root.style.setProperty("--login-shake-neg", `${-shake}px`);
    });
  }

  function resetLoginCards(event: React.PointerEvent<HTMLElement>) {
    if (loginMotionFrame.current !== null) {
      window.cancelAnimationFrame(loginMotionFrame.current);
      loginMotionFrame.current = null;
    }

    loginMotionPointer.current = null;
    event.currentTarget.style.setProperty("--login-motion-duration", "12s");
    event.currentTarget.style.setProperty("--login-shake", "0px");
    event.currentTarget.style.setProperty("--login-shake-neg", "0px");
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#09090b] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_22%_36%,rgba(255,255,255,.20),transparent_26%),radial-gradient(circle_at_78%_18%,rgba(124,58,237,.24),transparent_24%),linear-gradient(135deg,#17171a_0%,#050506_46%,#1f1f23_100%)]" />
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[size:76px_76px] opacity-40" />
      <div className="pointer-events-none fixed -left-12 top-36 h-64 w-64 rotate-12 border border-white/16 shadow-[0_0_60px_rgba(255,255,255,.10)]" />
      <div className="pointer-events-none fixed right-20 top-24 h-44 w-44 rotate-45 border border-white/16 shadow-[0_0_55px_rgba(168,85,247,.14)]" />

      <main
        className="discord-login-shell relative z-10 grid min-h-screen grid-cols-[minmax(430px,.82fr)_minmax(520px,1.18fr)] items-center gap-12 px-12 py-12"
        onPointerMove={moveLoginCards}
        onPointerLeave={resetLoginCards}
      >
        <div className="w-full max-w-[680px] rounded-[36px] border border-white/15 bg-black/52 p-8 shadow-[0_0_80px_rgba(255,255,255,.14)] backdrop-blur-2xl">
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
              <ShieldCheck size={22} className="text-white/85" />
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

        <div className="login-card-stage relative hidden h-[720px] overflow-hidden lg:block">
          {loginCards.map((card) => (
            <div
              key={card.id}
              className={`login-float-card login-float-card--${card.depth}`}
              style={
                {
                  "--login-card-delay": `${card.delay}s`,
                  "--login-card-height": `${card.height}rem`,
                  "--login-card-hue": card.hue.toFixed(0),
                  "--login-card-left": `${card.left}%`,
                  "--login-card-rotate": `${card.rotation}deg`,
                  "--login-card-top": `${card.top}%`,
                  "--login-card-width": `${card.width}rem`,
                } as CssVars
              }
            >
              <div className="login-float-card-sheen" />
              <div className="login-float-card-mark">{card.accent}</div>
              <div className="login-float-card-copy">
                <span>{card.subtitle}</span>
                <strong>{card.title}</strong>
              </div>
            </div>
          ))}
          <div className="absolute inset-x-10 top-1/2 h-px bg-white/20 shadow-[0_0_34px_rgba(255,255,255,.35)]" />
          <div className="login-brand-title absolute bottom-24 right-16 text-right">
            <div className="text-[82px] font-black leading-none text-white drop-shadow-[0_0_28px_rgba(255,255,255,.22)]">
              HARDY
            </div>
            <div className="text-[78px] font-black leading-none text-zinc-300 drop-shadow-[0_0_28px_rgba(255,255,255,.26)]">
              MODS
            </div>
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
    <button type="button" onClick={onClick} className="dashboard-card">
      <div className="dashboard-card-icon">{icon}</div>

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
    <div className="mod-card group">
      <div className="mod-card-media">
        {item.image ? (
          <img src={item.image} className="h-full w-full object-cover" />
        ) : (
          <div className="mod-card-fallback">
            <Download size={46} />
          </div>
        )}

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

        {item.rpfPatches && item.rpfPatches.length > 0 && (
          <div className="mt-4 rounded-2xl border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-sm font-black text-purple-100">
            RPF patch install: {item.rpfPatches.length} replacements
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={installDisabled}
            onClick={onInstall}
            className={`mod-action-button flex-1 ${
              installed && !hasUpdate ? "mod-action-button--installed" : ""
            } disabled:opacity-40`}
          >
            {hasUpdate ? "Обновить" : installed ? "Установлено" : "Установить"}
          </button>

          <button
            type="button"
            disabled={!installed || loading}
            onClick={onRestore}
            title="Восстановить backup / удалить мод"
            className="rounded-2xl border border-white/10 bg-white/10 px-5 transition hover:bg-white/15 disabled:opacity-40"
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
    <div className="search-box">
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
      className={`filter-chip ${active ? "filter-chip--active" : ""}`}
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
    <button type="button" onClick={onClick} className="top-nav-button">
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
      className="rounded-2xl border border-white/15 bg-white px-6 py-4 font-black text-black shadow-[0_0_24px_rgba(255,255,255,.18)] hover:bg-zinc-200 disabled:opacity-40"
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
