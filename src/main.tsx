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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  Home,
  ImageIcon,
  Info,
  Layers,
  ListTree,
  LogIn,
  LogOut,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Send,
  RotateCcw,
  Search,
  ShieldCheck,
  Settings,
  Trash2,
  Upload,
  User,
  Users,
  Wifi,
  X,
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

type AppStats = {
  adminsOnline: number;
  adminsTotal: number;
  totalUsers: number;
  usersOnline: number;
};

type SupportReply = {
  authorId: string;
  authorName?: string;
  createdAt: string;
  id: string;
  message: string;
  role: AdminUser["role"];
};

type SupportTicket = {
  createdAt: string;
  id: string;
  message: string;
  replies: SupportReply[];
  status: "open" | "answered";
  updatedAt: string;
  userId: string;
  username?: string;
};

type SupportStateDocument = {
  schemaVersion: 1;
  tickets: SupportTicket[];
};

type Page =
  | "home"
  | "catalog"
  | "category"
  | "modDetail"
  | "rpf"
  | "rpfExplorer"
  | "settings"
  | "admin";

type FilterMode = "all" | "installed" | "notInstalled";

type ProgressPayload = {
  progress: number;
  step: string;
};

type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

type LoginCardSource = {
  title: string;
  subtitle: string;
  accent: string;
  image?: string;
};

type LoginCardSpec = {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  depth: "clear" | "soft" | "depth";
  height: number;
  hue: number;
  image?: string;
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
const APP_VERSION = "0.1.73";
const PROMO_REGISTER_URL = "https://majestic-rp.ru/register?utm_campaign=hrdy";
const PROMO_DISCORD_URL = "https://discord.gg/hrdy";

const LOGIN_CARD_FALLBACKS: LoginCardSource[] = [
  { title: "MAD REDUX v3.0", subtitle: "Редукс", accent: "РД" },
  { title: "Thugger Redux", subtitle: "Редукс", accent: "РД" },
  { title: "HardyGunPack", subtitle: "Оружие", accent: "ОР" },
  { title: "Majestic Redux", subtitle: "Редукс", accent: "РД" },
  { title: "Light Redux", subtitle: "Графика", accent: "ГР" },
  { title: "Venom Redux", subtitle: "Редукс", accent: "РД" },
  { title: "Best Redux", subtitle: "Графика", accent: "ГР" },
];

const CATEGORY_LABELS: Record<string, string> = {
  graphics: "Графика",
  gunpack: "Оружие",
  redux: "Редукс",
  sound: "Звуки",
  timecycle: "Освещение",
};

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

function getCategoryTitle(category?: Pick<Category, "id" | "title"> | null) {
  const id = category?.id?.toLowerCase().trim() || "";
  const title = category?.title?.toLowerCase().trim() || "";

  if (CATEGORY_LABELS[id]) return CATEGORY_LABELS[id];
  if (CATEGORY_LABELS[title]) return CATEGORY_LABELS[title];
  if (title.includes("redux")) return "Редукс";
  if (title.includes("gun")) return "Оружие";
  if (title.includes("graphic")) return "Графика";
  if (title.includes("sound")) return "Звуки";

  return category?.title || "Моды";
}

function getRoleTitle(role?: AdminUser["role"]) {
  if (role === "owner") return "владелец";
  if (role === "admin") return "админ";
  if (role === "viewer") return "просмотр";

  return "не вошёл";
}

function buildLoginCardSources(categories: Category[]): LoginCardSource[] {
  return categories.flatMap((category) =>
    category.mods.map((mod) => {
      const label = getCategoryTitle(category);
      const rawAccent = label.slice(0, 2).toUpperCase();

      return {
        title: mod.name,
        subtitle: mod.version ? `${label} / v${mod.version}` : label,
        accent: rawAccent || "RD",
        image: mod.image || category.image,
      };
    }),
  );
}

function getModGallery(category: Category, mod: ModItem) {
  return Array.from(
    new Set([mod.image, category.image].filter((src): src is string => Boolean(src))),
  );
}

function getModContentItems(mod: ModItem) {
  const items = [
    `Версия v${mod.version}`,
    mod.size ? `Размер: ${mod.size}` : "Размер указан в каталоге",
    "Автоматическая установка в выбранную папку GTA V",
    "Резервная копия для быстрого восстановления",
  ];

  if (mod.rpfPatches?.length) {
    items.push(`Замены внутри RPF: ${mod.rpfPatches.length}`);
  } else {
    items.push("Установка файлов без ручной замены RPF");
  }

  return items;
}

function getRpfPatchLabel(patch: RpfPatch) {
  const archive = patch.rpfPath || "архив RPF";
  const target = patch.internalPath || "файл внутри архива";

  return `${archive} -> ${target}`;
}

const BRAND_WORDMARK_ROWS = [
  {
    className: "brand-wordmark-row--top",
    letters: [
      { key: "h", label: "H", src: "/brand-letters/H.png" },
      { key: "a", label: "A", src: "/brand-letters/a.png" },
      { key: "r", label: "R", src: "/brand-letters/r.png" },
      { key: "d", label: "D", src: "/brand-letters/D.png" },
      { key: "y", label: "Y", src: "/brand-letters/Y.png" },
    ],
  },
  {
    className: "brand-wordmark-row--bottom",
    letters: [
      { key: "m", label: "M", src: "/brand-letters/M.png" },
      { key: "o", label: "O", src: "/brand-letters/O.png" },
      { key: "d2", label: "D", src: "/brand-letters/DD.png" },
      { key: "s", label: "S", src: "/brand-letters/S.png" },
    ],
  },
];

function BrandWordmark({ variant = "hero" }: { variant?: "hero" | "login" | "mini" }) {
  return (
    <div className={`brand-wordmark brand-wordmark--${variant}`} aria-label="Харди Модс">
      <div className="brand-wordmark-inner">
        {BRAND_WORDMARK_ROWS.map((row) => (
          <div key={row.className} className={`brand-wordmark-row ${row.className}`}>
            {row.letters.map((letter, index) => (
              <span
                key={letter.key}
                className={`brand-letter brand-letter--image ${
                  row.className.includes("bottom") ? "brand-letter--bottom" : ""
                } brand-letter--${index}`}
                data-letter={letter.label}
                style={
                  {
                    "--brand-letter-delay": `${index * -0.42}s`,
                    "--brand-letter-duration": `${6.4 + index * 0.55}s`,
                  } as CssVars
                }
              >
                <img src={letter.src} alt="" draggable={false} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LogoMark({ className = "" }: { className?: string }) {
  return <img src="/hardy-h.png" alt="" className={`logo-mark ${className}`} draggable={false} />;
}

function GlowCursor() {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ring = ringRef.current;
    const dot = dotRef.current;

    if (!ring || !dot || window.matchMedia("(pointer: coarse)").matches) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let ringX = targetX;
    let ringY = targetY;
    let frame = 0;
    let active = false;
    let interactive = false;

    document.documentElement.classList.add("has-glow-cursor");

    function render() {
      ringX += (targetX - ringX) * 0.2;
      ringY += (targetY - ringY) * 0.2;

      const ringScale = interactive ? 1.72 : active ? 0.82 : 1;
      const dotScale = active ? 0.62 : interactive ? 0.78 : 1;

      ring.style.transform = `translate3d(${(ringX - 19).toFixed(2)}px, ${(ringY - 19).toFixed(
        2,
      )}px, 0) scale(${ringScale})`;
      dot.style.transform = `translate3d(${(targetX - 4).toFixed(2)}px, ${(targetY - 4).toFixed(
        2,
      )}px, 0) scale(${dotScale})`;

      frame = window.requestAnimationFrame(render);
    }

    function setPosition(event: PointerEvent) {
      targetX = event.clientX;
      targetY = event.clientY;
      interactive = Boolean(
        (event.target as Element | null)?.closest(
          "button,a,input,textarea,select,[role='button'],[data-cursor='button']",
        ),
      );
      ring.classList.toggle("glow-cursor--interactive", interactive);
      dot.classList.toggle("glow-cursor--interactive", interactive);
    }

    function setActive() {
      active = true;
      ring.classList.add("glow-cursor--active");
      dot.classList.add("glow-cursor--active");
    }

    function resetActive() {
      active = false;
      ring.classList.remove("glow-cursor--active");
      dot.classList.remove("glow-cursor--active");
    }

    frame = window.requestAnimationFrame(render);
    window.addEventListener("pointermove", setPosition, { passive: true });
    window.addEventListener("pointerdown", setActive, { passive: true });
    window.addEventListener("pointerup", resetActive, { passive: true });
    window.addEventListener("pointercancel", resetActive, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", setPosition);
      window.removeEventListener("pointerdown", setActive);
      window.removeEventListener("pointerup", resetActive);
      window.removeEventListener("pointercancel", resetActive);
      document.documentElement.classList.remove("has-glow-cursor");
    };
  }, []);

  return (
    <>
      <div ref={ringRef} className="glow-cursor glow-cursor--ring" />
      <div ref={dotRef} className="glow-cursor glow-cursor--dot" />
    </>
  );
}

function createLoginCards(sources: LoginCardSource[] = [], count = 8): LoginCardSpec[] {
  const slots = [
    { left: 8, top: 8 },
    { left: 28, top: 3 },
    { left: 56, top: 9 },
    { left: 6, top: 34 },
    { left: 37, top: 30 },
    { left: 66, top: 25 },
    { left: 24, top: 55 },
    { left: 58, top: 50 },
  ];
  const cards = [...(sources.length > 0 ? sources : LOGIN_CARD_FALLBACKS)].sort(
    () => Math.random() - 0.5,
  );

  return Array.from({ length: count }, (_, index) => {
    const preset = cards[index % cards.length];
    const slot = slots[index % slots.length];

    return {
      id: `${preset.title}-${index}`,
      title: preset.title,
      subtitle: preset.subtitle,
      accent: preset.accent,
      depth: index % 5 === 0 ? "depth" : index % 3 === 0 ? "soft" : "clear",
      height: randomBetween(11.5, 17.5),
      hue: randomBetween(326, 354),
      image: preset.image,
      left: slot.left + randomBetween(-3, 3),
      rotation: randomBetween(-13, 13),
      top: slot.top + randomBetween(-3, 3),
      width: randomBetween(8.8, 12.8),
      delay: randomBetween(-9, 0),
    };
  });
}

function setTiltedCardVars(card: HTMLElement, clientX: number, clientY: number, power = 1) {
  const rect = card.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const px = (x / rect.width - 0.5) * 2;
  const py = (y / rect.height - 0.5) * 2;
  const rx = py * -20 * power;
  const ry = px * 24 * power;

  card.style.setProperty("--mx", `${x}px`);
  card.style.setProperty("--my", `${y}px`);
  card.style.setProperty("--px", px.toFixed(3));
  card.style.setProperty("--py", py.toFixed(3));
  card.style.setProperty("--image-x", `${px * -18 * power}px`);
  card.style.setProperty("--image-y", `${py * -18 * power}px`);
  card.style.setProperty("--copy-x", `${px * 7 * power}px`);
  card.style.setProperty("--copy-y", `${py * 5 * power}px`);
  card.style.setProperty("--rx", `${rx}deg`);
  card.style.setProperty("--ry", `${ry}deg`);
}

function resetTiltedCardVars(card: HTMLElement) {
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
    throw new Error("Безопасное хеширование пароля недоступно в этом браузере");
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
    description: readString(value.description, "Описание не указано"),
    size: readString(value.size, "Размер неизвестен"),
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
        title: readString(entry.title, `Категория ${index + 1}`),
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
          title: "Редукс-моды",
          description: "Доступные редукс-паки",
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
    throw new Error(`Запрос каталога не удался: ${response.status}`);
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
    title: `Категория ${index}`,
    description: "",
    mods: [],
  };
}

function createAdminMod(index = 1): ModItem {
  return {
    id: `mod-${index}`,
    name: `Новый мод ${index}`,
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
  const [selectedMod, setSelectedMod] = useState<ModItem | null>(null);
  const [modGalleryIndex, setModGalleryIndex] = useState(0);
  const [adminCategories, setAdminCategories] = useState<Category[]>([createAdminCategory()]);
  const [adminImportText, setAdminImportText] = useState("");
  const [releaseVersion, setReleaseVersion] = useState(APP_VERSION);
  const [releaseNotes, setReleaseNotes] = useState("Обновление Hardy MODS");
  const [releaseUrl, setReleaseUrl] = useState(
    `https://github.com/hsoltanov2007-code/majestic-redux-manager/releases/download/v${APP_VERSION}/Hardy.MODS_${APP_VERSION}_x64-setup.exe`,
  );
  const [releaseSignature, setReleaseSignature] = useState("");
  const [adminApiUrl, setAdminApiUrl] = useState(initialAdminConnection.apiUrl);
  const [adminToken, setAdminToken] = useState(initialAdminConnection.token);
  const [adminMe, setAdminMe] = useState<AdminUser | null>(null);
  const [backendAdmins, setBackendAdmins] = useState<AdminStateDocument | null>(null);
  const [appStats, setAppStats] = useState<AppStats | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [promoState, setPromoState] = useState<"open" | "closing" | "docked">("open");
  const [supportMessage, setSupportMessage] = useState("");
  const [mySupportTickets, setMySupportTickets] = useState<SupportTicket[]>([]);
  const [adminSupportTickets, setAdminSupportTickets] = useState<SupportTicket[]>([]);
  const [supportReplyDrafts, setSupportReplyDrafts] = useState<Record<string, string>>({});
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
  const heroRailFrame = useRef<number | null>(null);
  const heroRailMotion = useRef({ down: 0, lastTime: 0, speed: 1, up: 0 });

  const loginCardSources = useMemo(() => buildLoginCardSources(categories), [categories]);

  useEffect(() => {
    if (promoState !== "closing") return;

    const timer = window.setTimeout(() => setPromoState("docked"), 620);
    return () => window.clearTimeout(timer);
  }, [promoState]);

  useEffect(() => {
    const motion = heroRailMotion.current;

    function tick(time: number) {
      const dt = motion.lastTime ? Math.min((time - motion.lastTime) / 1000, 0.05) : 0;
      motion.lastTime = time;

      const stage = document.querySelector<HTMLElement>(".home-stage");
      const railStage = stage?.querySelector<HTMLElement>(".hero-rail-stage");
      const upRail = stage?.querySelector<HTMLElement>(".hero-rail-up");
      const downRail = stage?.querySelector<HTMLElement>(".hero-rail-down");

      if (stage && railStage && upRail && downRail) {
        const cssProximity = Number.parseFloat(
          stage.style.getPropertyValue("--hero-proximity") || "0",
        );
        const hoverProximity = railStage.matches(":hover") ? 1 : 0;
        const proximity = Math.max(cssProximity || 0, hoverProximity);
        const targetSpeed = 1 - proximity * 0.64;
        const ease = 1 - Math.pow(0.025, dt);
        const upCycle = Math.max(upRail.scrollHeight / 3, 1);
        const downCycle = Math.max(downRail.scrollHeight / 3, 1);

        motion.speed += (targetSpeed - motion.speed) * ease;
        motion.up = (motion.up + (upCycle / 9.8) * motion.speed * dt) % upCycle;
        motion.down = (motion.down + (downCycle / 11.2) * motion.speed * dt) % downCycle;

        const upX = -8 + Math.sin((motion.up / upCycle) * Math.PI * 2) * 12;
        const downX = 10 - Math.sin((motion.down / downCycle) * Math.PI * 2) * 12;

        upRail.style.transform = `translate3d(${upX.toFixed(2)}px, ${(-motion.up).toFixed(
          2,
        )}px, 0) rotateX(8deg) rotateZ(-2deg)`;
        downRail.style.transform = `translate3d(${downX.toFixed(2)}px, ${(
          -downCycle + motion.down
        ).toFixed(2)}px, 0) rotateX(8deg) rotateZ(2deg)`;
      }

      heroRailFrame.current = window.requestAnimationFrame(tick);
    }

    heroRailFrame.current = window.requestAnimationFrame(tick);

    return () => {
      if (heroRailFrame.current !== null) {
        window.cancelAnimationFrame(heroRailFrame.current);
        heroRailFrame.current = null;
      }
    };
  }, []);

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
        setStatus("Вход через Discord завершён. Проверяю сессию...");
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
          throw new Error(profile?.error || `Админ-API ответил ошибкой: ${profileResponse.status}`);
        }

        if (cancelled) return;

        const user = profile.user as AdminUser;
        setAdminMe(user);
        setStatus(`Вход выполнен: ${getRoleTitle(user.role)}`);

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
            throw new Error(admins?.error || `Админ-API ответил ошибкой: ${adminsResponse.status}`);
          }

          if (!cancelled) setBackendAdmins(admins as AdminStateDocument);
        }
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken("");
          setAdminMe(null);
          setBackendAdmins(null);
          setStatus("Сессия Discord истекла. Войди снова.");
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
    if (!adminMe || !adminToken) return;

    let cancelled = false;

    async function tickPresence() {
      if (cancelled) return;
      await refreshPresence();
    }

    void tickPresence();
    const interval = window.setInterval(tickPresence, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // refreshPresence is a local function declaration that reads the latest saved connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminApiUrl, adminMe, adminToken]);

  useEffect(() => {
    if (isAuthenticated || categories.length > 0) return;

    let cancelled = false;

    async function loadLoginCatalogPreview() {
      const urls = [REDUX_JSON_URL, "/redux.example.json"];

      for (const url of urls) {
        try {
          const list = await fetchCatalog(url);

          if (!cancelled && list.length > 0) {
            setCategories(list);
          }

          return;
        } catch {
          // Try the local fallback next so login cards are still populated offline.
        }
      }
    }

    void loadLoginCatalogPreview();

    return () => {
      cancelled = true;
    };
  }, [categories.length, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    loadState();
    loadCategories();

    if (!isTauriRuntime()) {
      setStatus("Режим предпросмотра: действия Tauri имитируются");
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
                description: "Графический редукс-пак",
                image: "",
                name: "Majestic Redux",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(2),
                description: "Сборка игрока",
                image: "",
                name: "Killa Tops",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(3),
                description: "Пак с RPF-заменами",
                image: "",
                name: "Venom Redux",
              },
            },
            {
              category: createAdminCategory(1),
              mod: {
                ...createAdminMod(4),
                description: "Графическая сборка",
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
      setStatus("Вход настроен");

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
      setStatus("Вход выполнен");

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
    setSelectedMod(null);
    setStatus("Выход выполнен");
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
      setStatus("Ошибка загрузки состояния");
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
        throw new Error("Каталог пустой");
      }

      setCategories(list);
      setStatus("Каталог обновлён");
    } catch (err) {
      try {
        const fallback = await fetchCatalog("/redux.example.json");

        if (fallback.length === 0) {
          throw new Error("Локальный каталог пустой");
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
    setSelectedMod(null);
    setSearchText("");
    setFilterMode("all");
    setPage("catalog");

    if (!loading && categories.length === 0) {
      void loadCategories();
    }
  }

  function openAdmin() {
    if (!canUseAdmin(adminMe)) {
      setStatus("Админ-панель доступна только владельцу или админу");
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
    setSelectedMod(null);
    setPage("admin");
    void loadAdminDashboardData();
  }

  function syncAdminFromCatalog() {
    setAdminCategories(categories.length > 0 ? cloneCatalog(categories) : [createAdminCategory()]);
    setStatus("Админ-каталог синхронизирован с текущими модами");
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
        setStatus("Импорт не удался: категории или моды не найдены");
        return;
      }

      setAdminCategories(next);
      setStatus("Админ-каталог импортирован");
    } catch (err) {
      setStatus("Импорт админ-каталога не удался: " + String(err));
    }
  }

  function useAdminCatalogInPreview() {
    setCategories(cloneCatalog(adminCategories));
    setSelectedCategory(null);
    setSelectedMod(null);
    setPage("catalog");
    setStatus("Админ-каталог открыт в предпросмотре");
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label} скопирован`);
    } catch {
      setStatus(`${label} готов в поле`);
    }
  }

  function openFeaturedMod(category: Category, mod: ModItem) {
    openModDetail(category, mod);
  }

  function openModDetail(category: Category, mod: ModItem) {
    setSelectedCategory(category);
    setSelectedMod(mod);
    setModGalleryIndex(0);
    setSearchText("");
    setFilterMode("all");
    setPage("modDetail");
    setStatus(`${mod.name} открыт`);
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
      const glowX = clamp01((pointer.x - rect.left) / rect.width) * 100;
      const glowY = clamp01((pointer.y - rect.top) / rect.height) * 100;

      pointer.root.style.setProperty("--hero-proximity", easedProximity.toFixed(3));
      pointer.root.style.setProperty("--home-glow-x", `${glowX.toFixed(1)}%`);
      pointer.root.style.setProperty("--home-glow-y", `${glowY.toFixed(1)}%`);
    });
  }

  function resetHeroMotion(event: React.PointerEvent<HTMLElement>) {
    if (heroMotionFrame.current !== null) {
      window.cancelAnimationFrame(heroMotionFrame.current);
      heroMotionFrame.current = null;
    }

    heroMotionPointer.current = null;
    event.currentTarget.style.setProperty("--hero-proximity", "0");
    event.currentTarget.style.setProperty("--home-glow-x", "50%");
    event.currentTarget.style.setProperty("--home-glow-y", "48%");
  }

  function moveHeroCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    setTiltedCardVars(event.currentTarget, event.clientX, event.clientY, 0.26);
  }

  function resetHeroCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    resetTiltedCardVars(event.currentTarget);
  }

  function moveCategoryCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    setTiltedCardVars(event.currentTarget, event.clientX, event.clientY, 0.22);
  }

  function resetCategoryCardLight(event: React.PointerEvent<HTMLButtonElement>) {
    resetTiltedCardVars(event.currentTarget);
  }

  function captureHeroCardPointer(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some preview browsers do not support pointer capture on animated buttons.
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
      throw new Error("Сначала укажи адрес админ-API");
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
      throw new Error(data?.error || `Админ-API ответил ошибкой: ${response.status}`);
    }

    return data as T;
  }

  async function refreshPresence() {
    try {
      const stats = await adminRequest<AppStats>("/api/presence", { method: "POST" });
      setAppStats(stats);
    } catch {
      // Presence is a live nicety; the app should keep working if the API is not deployed yet.
    }
  }

  async function loadAdminStats() {
    if (!canUseAdmin(adminMe)) return;

    try {
      const stats = await adminRequest<AppStats>("/api/stats");
      setAppStats(stats);
    } catch (err) {
      setStatus("Статистику админки загрузить не удалось: " + String(err));
    }
  }

  async function loadMySupportTickets() {
    try {
      const support = await adminRequest<SupportStateDocument>("/api/support/mine");
      setMySupportTickets(support.tickets);
    } catch (err) {
      setStatus("Поддержку загрузить не удалось: " + String(err));
    }
  }

  async function loadAdminSupportTickets() {
    if (!canUseAdmin(adminMe)) return;

    try {
      const support = await adminRequest<SupportStateDocument>("/api/support");
      setAdminSupportTickets(support.tickets);
    } catch (err) {
      setStatus("Заявки поддержки загрузить не удалось: " + String(err));
    }
  }

  async function loadAdminDashboardData() {
    await Promise.all([loadAdminStats(), loadAdminSupportTickets()]);
  }

  function openSupportPanel() {
    setSupportOpen(true);
    void loadMySupportTickets();
  }

  async function submitSupportMessage() {
    const message = supportMessage.trim();

    if (!message) {
      setStatus("Напиши сообщение в поддержку");
      return;
    }

    try {
      setLoading(true);
      const support = await adminRequest<SupportStateDocument>("/api/support", {
        body: JSON.stringify({ message }),
        method: "POST",
      });
      setMySupportTickets(support.tickets);
      setSupportMessage("");
      setStatus("Сообщение отправлено в поддержку");
    } catch (err) {
      setStatus("Сообщение в поддержку не отправилось: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function replySupportTicket(ticketId: string) {
    const message = supportReplyDrafts[ticketId]?.trim() || "";

    if (!message) {
      setStatus("Напиши ответ пользователю");
      return;
    }

    try {
      setLoading(true);
      const support = await adminRequest<SupportStateDocument>(
        `/api/support/${encodeURIComponent(ticketId)}/reply`,
        {
          body: JSON.stringify({ message }),
          method: "POST",
        },
      );
      setAdminSupportTickets(support.tickets);
      setSupportReplyDrafts((current) => ({ ...current, [ticketId]: "" }));
      setStatus("Ответ поддержки отправлен");
    } catch (err) {
      setStatus("Ответ поддержки не отправился: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  function saveAdminConnection() {
    const cleanUrl = (adminApiUrl || DEFAULT_ADMIN_API_URL).trim().replace(/\/+$/, "");

    window.localStorage.setItem(ADMIN_API_URL_KEY, cleanUrl);
    setAdminApiUrl(cleanUrl);

    setStatus("Настройки админ-API сохранены");
  }

  async function openDiscordLogin() {
    const cleanBase = (adminApiUrl || DEFAULT_ADMIN_API_URL).trim().replace(/\/+$/, "");

    if (!cleanBase || cleanBase.includes("YOUR_SUBDOMAIN")) {
      setStatus("Сначала укажи адрес админ-API");
      return;
    }

    const loginUrl = `${cleanBase}/auth/discord/start`;

    try {
      if (isTauriRuntime()) {
        await openUrl(loginUrl);
      } else {
        window.location.href = loginUrl;
      }

      setStatus("Открыл вход через Discord. После авторизации приложение откроется само.");
    } catch (err) {
      setStatus("Не удалось открыть вход через Discord: " + String(err));
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
        setStatus("Сначала войди через Discord, потом нажми Продолжить.");
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
      setStatus(`Вход выполнен: ${getRoleTitle(result.user.role)}`);

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
      setStatus("Вход в админ-панель не удался: " + String(err));
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
    setAppStats(null);
    setMySupportTickets([]);
    setAdminSupportTickets([]);
    setSupportOpen(false);
    setPage("home");
    setSelectedCategory(null);
    setSelectedMod(null);
    setStatus("Выход выполнен");
  }

  async function pullCatalogFromAdminApi() {
    try {
      setLoading(true);
      const catalog = await adminRequest<CatalogDocument>("/api/catalog");
      setAdminCategories(cloneCatalog(normalizeCatalog(catalog)));
      setStatus("Каталог загружен через админ-API");
    } catch (err) {
      setStatus("Загрузка каталога не удалась: " + String(err));
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
          message: `Обновление каталога модов (${catalog.categories.length} категорий)`,
        }),
        method: "PUT",
      });
      setStatus("redux.json опубликован в GitHub");
    } catch (err) {
      setStatus("Публикация каталога не удалась: " + String(err));
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
          message: `Обновление latest.json ${releaseVersion}`,
        }),
        method: "PUT",
      });
      setStatus("latest.json опубликован в GitHub");
    } catch (err) {
      setStatus("Публикация latest.json не удалась: " + String(err));
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
        setStatus(`Токен GitHub работает: ${result.repo} ${result.writePath}`);
        return;
      }

      setStatus(`Проверка токена GitHub не удалась: ${result.error || "неизвестная ошибка"}`);
    } catch (err) {
      setStatus("Проверка токена GitHub не удалась: " + String(err));
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
      setStatus("Админ добавлен");
    } catch (err) {
      setStatus("Добавить админа не удалось: " + String(err));
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
      setStatus("Админ удалён");
    } catch (err) {
      setStatus("Удалить админа не удалось: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkForAppUpdate(silent = false): Promise<Update | null> {
    if (!isTauriRuntime()) {
      if (!silent) {
        setStatus("Проверка обновлений работает только в Tauri-приложении");
      }

      return null;
    }

    try {
      if (!silent) {
        setLoading(true);
        setStatus("Проверяю обновление приложения...");
      }

      const update = await check();
      setTauriUpdate(update);

      if (update) {
        setStatus(`Доступно обновление ${update.version}`);
      } else if (!silent) {
        setStatus("Приложение уже обновлено");
      }

      return update;
    } catch (err) {
      if (!silent) {
        setStatus("Проверка обновления не удалась: " + String(err));
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
      setInstallStep("Проверка обновления");
      setStatus("Проверка обновления...");

      const update = tauriUpdate ?? (await checkForAppUpdate(true));

      if (!update) {
        setStatus("Обновлений нет");
        setInstallStep("");
        return;
      }

      setTauriUpdate(update);
      setStatus(`Скачивание обновления ${update.version}...`);
      setInstallStep("Скачивание обновления");

      let totalBytes = 0;
      let downloadedBytes = 0;

      const onDownloadEvent = (event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setProgress(0);
          setInstallStep("Скачивание обновления");
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
          setInstallStep("Установка обновления");
          setStatus("Обновление скачано, установка...");
        }
      };

      await update.downloadAndInstall(onDownloadEvent);

      setStatus("Перезапуск...");
      setInstallStep("Перезапуск");
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
      setStatus("Путь GTA сохранён в режиме предпросмотра");
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
      setStatus("Укажи папку системных файлов");
      return;
    }

    if (!isTauriRuntime()) {
      const state = { ...readLocalState(), systemPath: cleanPath };
      writeLocalState(state);
      setSystemPath(cleanPath);
      setStatus("Путь системных файлов сохранён в режиме предпросмотра");
      return;
    }

    const state = await invoke<AppState>("save_system_path", {
      systemPath: cleanPath,
    });

    setSystemPath(state.systemPath || cleanPath);
    setInstalledRedux(state.installedRedux || {});
    setStatus("Путь системных файлов сохранён");
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
        setStatus("Ошибка пути системных файлов: " + String(err));
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
        setStatus("Ошибка пути GTA: " + String(err));
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
        setStatus(`${item.name} отмечен как установлен в режиме предпросмотра`);
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
        setStatus(`${item.name} удалён из режима предпросмотра`);
        return;
      }

      const state = await invoke<AppState>("restore_backup", {
        reduxId: item.id,
        gtaPath,
      });

      setInstalledRedux(state.installedRedux || {});
      setStatus("Резервная копия восстановлена");
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
      setStatus("Разблокировка RPF доступна только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);

      const result = await invoke<string>("unlock_rpf_file", {
        rpfPath,
      });

      setStatus(result);
    } catch (err) {
      setStatus("Ошибка разблокировки: " + String(err));
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
      setInternalPath("");
      setReplaceFilePath("");
      await readRpfTree(file);
    }
  }

  async function readRpfTree(nextRpfPath: string) {
    if (!isTauriRuntime()) {
      setStatus("Архивы RPF доступны только в приложении Tauri");
      return;
    }

    try {
      setLoading(true);
      setRpfEntries([]);

      const result = await invoke<string[]>("list_rpf_file", {
        rpfPath: nextRpfPath,
      });

      setRpfEntries(result);
      setStatus(`RPF открыт: ${result.length} файлов`);
    } catch (err) {
      setStatus("Ошибка архива RPF: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadRpfTree() {
    if (!rpfExplorerPath) {
      setStatus("Сначала выбери RPF файл");
      return;
    }

    await readRpfTree(rpfExplorerPath);
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
      setStatus("Замена RPF доступна только в приложении Tauri");
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
      setStatus("Ошибка замены: " + String(err));
    } finally {
      setLoading(false);
    }
  }

  const rpfTree = useMemo(() => {
    return buildRpfTree(rpfEntries);
  }, [rpfEntries]);

  const selectedModGallery = useMemo(() => {
    if (!selectedCategory || !selectedMod) return [];

    return getModGallery(selectedCategory, selectedMod);
  }, [selectedCategory, selectedMod]);

  const selectedModContent = useMemo(() => {
    return selectedMod ? getModContentItems(selectedMod) : [];
  }, [selectedMod]);

  const selectedModInstalled = selectedMod ? installedRedux[selectedMod.id] : undefined;
  const selectedModHasUpdate = Boolean(
    selectedModInstalled && selectedMod && selectedModInstalled.version !== selectedMod.version,
  );
  const selectedModInstallDisabled =
    loading || (Boolean(selectedModInstalled) && !selectedModHasUpdate);
  const selectedModImage =
    selectedModGallery.length > 0
      ? selectedModGallery[modGalleryIndex % selectedModGallery.length]
      : undefined;
  const canOpenAdmin = canUseAdmin(adminMe);
  const canPublishCatalog = canOpenAdmin;
  const canPublishLatest = adminMe?.role === "owner";
  const adminsOnline = appStats?.adminsOnline ?? 0;
  const totalUsers = appStats?.totalUsers ?? 0;

  if (!isAuthenticated) {
    return (
      <>
        <DiscordLoginScreen
          cardSources={loginCardSources}
          loading={loading}
          status={status}
          onCheck={loadAdminProfile}
          onLogin={openDiscordLogin}
        />
        <PromoPopup
          state={promoState}
          onClose={() => {
            setPromoState((current) => (current === "open" ? "closing" : current));
          }}
        />
        {promoState === "docked" && <PromoDock floating />}
      </>
    );
  }

  return (
    <div className="app-shell min-h-screen overflow-hidden bg-[#07070a] text-white">
      <GlowCursor />
      <div className="app-bg app-bg--base" />
      <div className="app-bg app-bg--grid" />
      <div className="app-wire app-wire--left" />
      <div className="app-wire app-wire--right" />

      <header className="relative z-20 h-[88px] border-b border-white/15 bg-black/45 shadow-[0_18px_70px_rgba(0,0,0,.38)] backdrop-blur-2xl">
        <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[160px_1fr_250px] items-center gap-6 px-7">
          <button
            onClick={() => {
              setPage("home");
              setSelectedCategory(null);
              setSelectedMod(null);
            }}
            className="grid h-12 w-36 place-items-center rounded-2xl border border-white/15 bg-white/[.035] text-white shadow-[0_0_28px_rgba(255,255,255,.08)] transition hover:bg-white/[.08]"
          >
            <Home size={36} />
          </button>

          <nav className="top-nav mx-auto flex h-14 items-center gap-2">
            <TopButton
              onClick={() => {
                setSelectedCategory(null);
                setSelectedMod(null);
                setPage("home");
              }}
            >
              Главная
            </TopButton>
            <TopButton onClick={openCatalog}>Моды</TopButton>
            <TopButton onClick={() => setPage("rpf")}>Разблокировка RPF</TopButton>
            <TopButton onClick={() => setPage("rpfExplorer")}>Архивы RPF</TopButton>
            <TopButton onClick={() => setPage("settings")}>Настройки</TopButton>
            {canOpenAdmin && <TopButton onClick={openAdmin}>Админ</TopButton>}
          </nav>

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
                  Нажми кнопку, приложение скачает обновление и запустит установщик.
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
            <div className="home-brand-panel relative z-10 pl-10">
              <div className="home-kicker mb-7 inline-flex items-center gap-3 rounded-full px-5 py-2 text-xs font-black uppercase tracking-[.25em] text-white/75">
                <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,.85)]" />
                ЛУЧШИЙ КАТАЛОГ МОДИФИКАЦИЙ
              </div>

              <div className="home-logo-stack relative inline-block">
                <div className="home-brand-aura" />
                <BrandWordmark variant="hero" />
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

              <div className="home-live-row mt-5">
                <div className="home-live-pill">
                  <Wifi size={17} />
                  <span>{adminsOnline}</span>
                  <strong>админов онлайн</strong>
                </div>
                <div className="home-live-pill home-live-pill--muted">
                  <Users size={17} />
                  <span>{totalUsers}</span>
                  <strong>пользователей</strong>
                </div>
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
                          onPointerDown={captureHeroCardPointer}
                          onPointerMove={moveHeroCardLight}
                          onPointerLeave={resetHeroCardLight}
                          onMouseDown={(event) => {
                            if (event.button === 0) openFeaturedMod(category, mod);
                          }}
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
                                  {getCategoryTitle(category)}
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
                  ХАРДИ МОДС
                </div>

                <div className="leading-none">
                  <div className="text-[110px] font-black text-white">HARDY</div>

                  <div className="text-[110px] font-black text-purple-500">MODS</div>
                </div>

                <div className="mt-12 grid grid-cols-2 gap-6">
                  <DashboardCard
                    title="Моды"
                    description="Каталог модов"
                    icon={<Package />}
                    onClick={openCatalog}
                  />

                  <DashboardCard
                    title="Разблокировка RPF"
                    description="Открыть архив RPF"
                    icon={<FileArchive />}
                    onClick={() => setPage("rpf")}
                  />

                  <DashboardCard
                    title="Архивы RPF"
                    description="Просмотр и замена файлов"
                    icon={<FolderOpen />}
                    onClick={() => setPage("rpfExplorer")}
                  />

                  <DashboardCard
                    title="Настройки"
                    description="Настройки"
                    icon={<Settings />}
                    onClick={() => setPage("settings")}
                  />

                  {canOpenAdmin && (
                    <DashboardCard
                      title="Админ"
                      description="Каталог и обновления"
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
                <div className="catalog-kicker">Коллекция Hardy</div>
                <h2 className="mt-3 text-5xl font-black">Каталог модов</h2>
                <p className="mt-3 max-w-2xl text-white/55">
                  Стеклянные категории, неоновое свечение и быстрый доступ к модам без пустого
                  экрана.
                </p>
              </div>

              <div className="catalog-stats">
                <MiniStat label="Категории" value={String(categories.length)} />
                <MiniStat label="Моды" value={String(catalogModCount)} />
                <MiniStat
                  label="Установлено"
                  value={String(catalogInstalledCount)}
                  tone="success"
                />
              </div>
            </div>

            <div className="catalog-toolbar mb-8">
              <SearchBox value={searchText} onChange={setSearchText} />

              <div className="flex flex-wrap gap-3">
                <FilterButton active={filterMode === "all"} onClick={() => setFilterMode("all")}>
                  Все
                </FilterButton>

                <FilterButton
                  active={filterMode === "installed"}
                  onClick={() => setFilterMode("installed")}
                >
                  Установленные
                </FilterButton>

                <FilterButton
                  active={filterMode === "notInstalled"}
                  onClick={() => setFilterMode("notInstalled")}
                >
                  Новые
                </FilterButton>

                <FilterButton active={false} onClick={() => void loadCategories()}>
                  Обновить
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
                  const hue = 326 + ((index * 13) % 32);

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(category);
                        setSelectedMod(null);
                        setPage("category");
                        setSearchText("");
                      }}
                      onPointerMove={moveCategoryCardLight}
                      onPointerLeave={resetCategoryCardLight}
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
                          <span>{category.mods.length} модов</span>
                          <span>{installedCount} установлено</span>
                        </div>
                        <h3>{category.title}</h3>
                        <p>{category.description || "Свежая подборка модов для Hardy MODS."}</p>
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
                  <PrimaryButton onClick={() => void loadCategories()}>Обновить</PrimaryButton>
                  <PurpleButton onClick={() => setSearchText("")}>Очистить поиск</PurpleButton>
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
                  Все
                </FilterButton>

                <FilterButton
                  active={filterMode === "installed"}
                  onClick={() => setFilterMode("installed")}
                >
                  Установленные
                </FilterButton>

                <FilterButton
                  active={filterMode === "notInstalled"}
                  onClick={() => setFilterMode("notInstalled")}
                >
                  Новые
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
                        {category.mods.length} модов / {installedCount} установлено
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
                setSelectedMod(null);
                setPage("catalog");
              }}
            />

            <div className="catalog-hero mb-8">
              <div>
                <div className="catalog-kicker">Выбранная категория</div>
                <h2 className="text-5xl font-black">{selectedCategory.title}</h2>

                <p className="mt-3 text-white/45">{selectedCategory.description}</p>
              </div>

              <div className="flex flex-wrap justify-end gap-4">
                <SearchBox value={searchText} onChange={setSearchText} />

                <FilterButton active={filterMode === "all"} onClick={() => setFilterMode("all")}>
                  Все
                </FilterButton>

                <FilterButton
                  active={filterMode === "installed"}
                  onClick={() => setFilterMode("installed")}
                >
                  Установленные
                </FilterButton>

                <FilterButton
                  active={filterMode === "notInstalled"}
                  onClick={() => setFilterMode("notInstalled")}
                >
                  Новые
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
                  <PrimaryButton onClick={() => setSearchText("")}>Очистить поиск</PrimaryButton>
                  <PurpleButton onClick={() => setFilterMode("all")}>Все моды</PurpleButton>
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
                      onOpen={() => openModDetail(selectedCategory, item)}
                      onInstall={() => installRedux(item)}
                      onRestore={() => restoreRedux(item)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}

        {page === "modDetail" && selectedCategory && selectedMod && (
          <section className="mod-detail-section catalog-section pt-10">
            <BackButton
              onClick={() => {
                setSelectedMod(null);
                setSearchText("");
                setPage("category");
              }}
            />

            <div className="mod-detail-shell">
              <div className="mod-detail-gallery">
                <div className="mod-detail-gallery-frame">
                  {selectedModImage ? (
                    <img src={selectedModImage} className="mod-detail-gallery-image" />
                  ) : (
                    <div className="mod-detail-gallery-fallback">
                      <ImageIcon size={56} />
                    </div>
                  )}

                  <div className="mod-detail-gallery-shade" />
                  <div className="mod-detail-gallery-label">
                    <span>{getCategoryTitle(selectedCategory)}</span>
                    <strong>{selectedMod.name}</strong>
                  </div>

                  {selectedModGallery.length > 1 && (
                    <div className="mod-detail-gallery-controls">
                      <button
                        type="button"
                        onClick={() =>
                          setModGalleryIndex(
                            (value) =>
                              (value + selectedModGallery.length - 1) % selectedModGallery.length,
                          )
                        }
                      >
                        <ChevronLeft size={20} />
                      </button>

                      <span>
                        {modGalleryIndex + 1}/{selectedModGallery.length}
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          setModGalleryIndex((value) => (value + 1) % selectedModGallery.length)
                        }
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  )}
                </div>

                {selectedModGallery.length > 1 && (
                  <div className="mod-detail-thumbs">
                    {selectedModGallery.map((image, index) => (
                      <button
                        key={`${image}-${index}`}
                        type="button"
                        className={index === modGalleryIndex ? "is-active" : ""}
                        onClick={() => setModGalleryIndex(index)}
                      >
                        <img src={image} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mod-detail-info">
                <div className="catalog-kicker">Карточка мода</div>
                <h2>{selectedMod.name}</h2>
                <p>{selectedMod.description || "Описание мода пока не заполнено в каталоге."}</p>

                <div className="mod-detail-actions">
                  <PrimaryButton
                    disabled={selectedModInstallDisabled}
                    onClick={() => installRedux(selectedMod)}
                  >
                    <Download size={18} />
                    {selectedModHasUpdate
                      ? "Обновить"
                      : selectedModInstalled
                        ? "Установлено"
                        : "Установить"}
                  </PrimaryButton>

                  <PurpleButton
                    disabled={!selectedModInstalled || loading}
                    onClick={() => restoreRedux(selectedMod)}
                  >
                    <RotateCcw size={18} />
                    Восстановить
                  </PurpleButton>
                </div>

                <div className="mod-detail-grid">
                  <div className="mod-detail-card">
                    <div className="mod-detail-card-title">
                      <Layers size={20} />
                      Что входит
                    </div>
                    <div className="mod-detail-list">
                      {selectedModContent.map((item) => (
                        <div key={item} className="mod-detail-list-row">
                          <CheckCircle2 size={17} />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mod-detail-card">
                    <div className="mod-detail-card-title">
                      <ListTree size={20} />
                      Файлы Redux
                    </div>

                    {selectedMod.rpfPatches?.length ? (
                      <div className="mod-detail-patches">
                        {selectedMod.rpfPatches.map((patch, index) => (
                          <div key={`${patch.rpfPath}-${patch.internalPath}-${index}`}>
                            <span>Замена {index + 1}</span>
                            <strong>{getRpfPatchLabel(patch)}</strong>
                            {patch.file && <em>{patch.file}</em>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mod-detail-muted">
                        Для этого мода в каталоге нет ручных RPF-замен. Установка пройдет обычным
                        способом через менеджер.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {page === "rpf" && (
          <ToolPanel
            title="Разблокировка RPF"
            icon={<FileArchive />}
            onBack={() => setPage("home")}
          >
            <div className="rpf-unlocker-layout">
              <div className="rpf-help-card rpf-help-card--accent">
                <div className="rpf-help-icon">
                  <Info size={24} />
                </div>
                <h3>Как использовать</h3>
                <p>
                  Выбери нужный архив `.rpf`, нажми разблокировку и дождись сообщения в статусе.
                  После этого архив можно открывать в разделе “Архивы RPF” и менять файлы внутри.
                </p>
              </div>

              <div className="rpf-help-card">
                <div className="rpf-step">
                  <span>1</span>
                  <strong>Выбери .rpf</strong>
                  <p>Можно брать архив из папки GTA V или из папки установленного мода.</p>
                </div>
                <div className="rpf-step">
                  <span>2</span>
                  <strong>Разблокируй</strong>
                  <p>Менеджер снимет блокировку, чтобы архив можно было редактировать.</p>
                </div>
                <div className="rpf-step">
                  <span>3</span>
                  <strong>Открой архив</strong>
                  <p>Перейди в “Архивы RPF”, выбери файл, дерево появится сразу.</p>
                </div>
              </div>
            </div>

            <div className="rpf-action-card">
              <PathBox text={rpfPath || "RPF файл не выбран"} />

              <div className="flex flex-wrap gap-4">
                <PrimaryButton onClick={chooseRpfFile}>Выбрать .rpf</PrimaryButton>

                <PurpleButton disabled={!rpfPath} onClick={unlockRpf}>
                  Разблокировать
                </PurpleButton>
              </div>
            </div>
          </ToolPanel>
        )}

        {page === "rpfExplorer" && (
          <ToolPanel title="Архивы RPF" icon={<FolderOpen />} onBack={() => setPage("home")}>
            <div className="rpf-explorer-toolbar">
              <PrimaryButton onClick={chooseRpfExplorerFile}>Выбрать и открыть RPF</PrimaryButton>

              <PurpleButton disabled={!rpfExplorerPath} onClick={loadRpfTree}>
                Обновить дерево
              </PurpleButton>

              <SearchBox value={rpfSearch} onChange={setRpfSearch} />
            </div>

            <PathBox text={rpfExplorerPath || "RPF не выбран"} />

            <div className="rpf-explorer-grid">
              <div className="rpf-tree-panel">
                <div className="rpf-panel-title">
                  <ListTree size={19} />
                  Дерево архива
                </div>

                <div className="rpf-tree-scroll">
                  {rpfEntries.length > 0 ? (
                    <TreeView
                      nodes={filterTree(rpfTree, rpfSearch)}
                      selectedPath={internalPath}
                      onSelect={setInternalPath}
                    />
                  ) : (
                    <div className="rpf-empty-tree">
                      <FolderOpen size={42} />
                      <strong>Архив еще не открыт</strong>
                      <span>Выбери RPF файл, и список появится здесь сразу.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rpf-replace-panel">
                <div className="rpf-panel-title">
                  <Upload size={19} />
                  Замена файла
                </div>

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
                    Заменить
                  </PurpleButton>
                </div>
              </div>
            </div>
          </ToolPanel>
        )}

        {page === "admin" && (
          <ToolPanel title="Панель админа" icon={<FileJson />} onBack={() => setPage("home")}>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)] gap-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <PrimaryButton onClick={syncAdminFromCatalog}>
                    <RefreshCw size={18} />
                    Синхронизировать
                  </PrimaryButton>
                  <PurpleButton onClick={addAdminCategory}>
                    <Plus size={18} />
                    Категория
                  </PurpleButton>
                  <PrimaryButton onClick={useAdminCatalogInPreview}>
                    <Package size={18} />
                    Предпросмотр
                  </PrimaryButton>
                  <PrimaryButton onClick={() => copyText(adminCatalogJson, "redux.json")}>
                    <Clipboard size={18} />
                    Копировать JSON
                  </PrimaryButton>
                  <PurpleButton onClick={() => downloadTextFile("redux.json", adminCatalogJson)}>
                    <Download size={18} />
                    Экспорт
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
                          {category.mods.length} модов в категории
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <PrimaryButton onClick={() => addAdminMod(category.id)}>
                          <Plus size={18} />
                          Мод
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
                        label="ID категории"
                        value={category.id}
                        onChange={(value) => updateAdminCategory(category.id, "id", value)}
                      />
                      <AdminField
                        label="Название"
                        value={category.title}
                        onChange={(value) => updateAdminCategory(category.id, "title", value)}
                      />
                      <AdminField
                        label="Ссылка на картинку"
                        value={category.image || ""}
                        onChange={(value) => updateAdminCategory(category.id, "image", value)}
                      />
                      <AdminField
                        label="Описание"
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
                              label="ID мода"
                              value={mod.id}
                              onChange={(value) => updateAdminMod(category.id, mod.id, "id", value)}
                            />
                            <AdminField
                              label="Название"
                              value={mod.name}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "name", value)
                              }
                            />
                            <AdminField
                              label="Версия"
                              value={mod.version}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "version", value)
                              }
                            />
                            <AdminField
                              label="Размер"
                              value={mod.size}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "size", value)
                              }
                            />
                            <AdminField
                              label="Ссылка на картинку"
                              value={mod.image || ""}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "image", value)
                              }
                            />
                            <AdminField
                              label="Ссылка на скачивание"
                              value={mod.downloadUrl}
                              onChange={(value) =>
                                updateAdminMod(category.id, mod.id, "downloadUrl", value)
                              }
                            />
                          </div>

                          <AdminField
                            label="Описание"
                            value={mod.description}
                            onChange={(value) =>
                              updateAdminMod(category.id, mod.id, "description", value)
                            }
                            multiline
                          />

                          <div className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <div className="font-black">Замены RPF</div>
                                <div className="text-xs text-white/45">
                                  Путь может начинаться с update/update.rpf; приложение также
                                  проверяет mods/update/update.rpf
                                </div>
                              </div>
                              <PrimaryButton onClick={() => addAdminRpfPatch(category.id, mod.id)}>
                                <Plus size={18} />
                                Замена RPF
                              </PrimaryButton>
                            </div>

                            {(mod.rpfPatches || []).length === 0 && (
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/45">
                                Замен RPF нет. Мод скопирует обычные файлы из архива.
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
                                      Замена #{patchIndex + 1}
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
                                      label="Путь RPF"
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
                                      label="Путь внутри архива"
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
                                      label="Файл в архиве"
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
                      <div className="text-lg font-black">Админ Discord</div>
                      <div className="text-sm text-white/40">Владелец: 1452029134300774414</div>
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
                      {getRoleTitle(adminMe?.role)}
                    </div>
                  </div>

                  {adminMe && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[.04] p-3 text-sm text-white/60">
                      Discord: {adminMe.username || "без имени"} · {adminMe.id}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <PrimaryButton onClick={openDiscordLogin}>Войти через Discord</PrimaryButton>
                    <PurpleButton disabled={loading} onClick={loadAdminProfile}>
                      Проверить сессию
                    </PurpleButton>
                    <PrimaryButton
                      disabled={loading || !canPublishCatalog}
                      onClick={pullCatalogFromAdminApi}
                    >
                      Загрузить redux.json
                    </PrimaryButton>
                    <PurpleButton
                      disabled={loading || !canPublishCatalog}
                      onClick={publishCatalogToAdminApi}
                    >
                      Опубликовать redux.json
                    </PurpleButton>
                    <PurpleButton
                      disabled={loading || !canPublishLatest}
                      onClick={publishLatestToAdminApi}
                    >
                      Опубликовать latest.json
                    </PurpleButton>
                    <PrimaryButton
                      disabled={loading || adminMe?.role !== "owner"}
                      onClick={checkGithubToken}
                    >
                      Проверить токен GitHub
                    </PrimaryButton>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-lg font-black">Статистика</div>
                    <PrimaryButton
                      disabled={loading || !canOpenAdmin}
                      onClick={loadAdminDashboardData}
                    >
                      <RefreshCw size={18} />
                      Обновить
                    </PrimaryButton>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <MiniStat label="Пользователи" value={String(totalUsers)} tone="success" />
                    <MiniStat label="Онлайн" value={String(appStats?.usersOnline ?? 0)} />
                    <MiniStat label="Админы онлайн" value={String(adminsOnline)} tone="success" />
                    <MiniStat label="Админов" value={String(appStats?.adminsTotal ?? 0)} />
                  </div>
                </div>

                {adminMe?.role === "owner" && (
                  <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                    <div className="mb-4 text-lg font-black">Админы</div>
                    <div className="grid gap-4">
                      <AdminField
                        label="Discord ID"
                        value={newAdminDiscordId}
                        onChange={setNewAdminDiscordId}
                      />
                      <AdminField label="Метка" value={newAdminLabel} onChange={setNewAdminLabel} />
                      <PurpleButton disabled={loading} onClick={addBackendAdmin}>
                        <Plus size={18} />
                        Добавить админа
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
                            <div className="text-xs text-white/40">{admin.label || "админ"}</div>
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
                          Админов пока нет.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-black">Поддержка</div>
                      <div className="text-sm text-white/40">
                        Ответы пользователям прямо из админки
                      </div>
                    </div>
                    <PrimaryButton
                      disabled={loading || !canOpenAdmin}
                      onClick={loadAdminSupportTickets}
                    >
                      <MessageCircle size={18} />
                      Обновить
                    </PrimaryButton>
                  </div>

                  <div className="admin-support-list">
                    {adminSupportTickets.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 p-3 text-sm text-white/40">
                        Заявок пока нет.
                      </div>
                    ) : (
                      adminSupportTickets.map((ticket) => (
                        <div key={ticket.id} className="admin-support-ticket">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <div className="font-black">{ticket.username || "Пользователь"}</div>
                              <div className="font-mono text-xs text-white/35">{ticket.userId}</div>
                            </div>
                            <span className="support-status-chip">
                              {ticket.status === "answered" ? "отвечено" : "новое"}
                            </span>
                          </div>

                          <div className="support-bubble support-bubble--user">
                            {ticket.message}
                          </div>

                          {ticket.replies.map((reply) => (
                            <div key={reply.id} className="support-bubble support-bubble--admin">
                              <div className="support-reply-author">
                                {reply.authorName || getRoleTitle(reply.role)}
                              </div>
                              {reply.message}
                            </div>
                          ))}

                          <textarea
                            value={supportReplyDrafts[ticket.id] || ""}
                            onChange={(event) =>
                              setSupportReplyDrafts((current) => ({
                                ...current,
                                [ticket.id]: event.target.value,
                              }))
                            }
                            placeholder="Ответ пользователю..."
                            className="mt-3 h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-3 text-sm outline-none"
                          />
                          <div className="mt-3 flex justify-end">
                            <PurpleButton
                              disabled={loading || !(supportReplyDrafts[ticket.id] || "").trim()}
                              onClick={() => replySupportTicket(ticket.id)}
                            >
                              <Send size={18} />
                              Ответить
                            </PurpleButton>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 text-lg font-black">Импорт каталога</div>
                  <textarea
                    value={adminImportText}
                    onChange={(event) => setAdminImportText(event.target.value)}
                    placeholder="Вставь redux.json сюда"
                    className="h-40 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-xs outline-none"
                  />
                  <div className="mt-4 flex justify-end">
                    <PurpleButton onClick={importAdminCatalog}>Импорт</PurpleButton>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <div className="mb-4 text-lg font-black">redux.json</div>
                  <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
                    <MiniStat label="Схема" value="v1" />
                    <MiniStat label="Категории" value={String(catalogStats.categoryCount)} />
                    <MiniStat label="Моды" value={String(catalogStats.modCount)} />
                    <MiniStat
                      label="Проблемы"
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
                        <div>{catalogStats.missingDownloads} модов без ссылки на скачивание</div>
                      )}
                      {catalogStats.duplicateIds.length > 0 && (
                        <div>Повторяющиеся ID модов: {catalogStats.duplicateIds.join(", ")}</div>
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
                  <div className="mb-4 text-lg font-black">Манифест обновления</div>
                  <div className="mb-4 flex flex-wrap gap-3">
                    <PrimaryButton onClick={() => checkForAppUpdate(false)}>
                      <RefreshCw size={18} />
                      Проверить обновление
                    </PrimaryButton>
                    <PurpleButton disabled={loading} onClick={installTauriUpdate}>
                      <Download size={18} />
                      Скачать обновление
                    </PurpleButton>
                  </div>
                  <div className="grid gap-4">
                    <AdminField
                      label="Версия"
                      value={releaseVersion}
                      onChange={setReleaseVersion}
                    />
                    <AdminField label="Заметки" value={releaseNotes} onChange={setReleaseNotes} />
                    <AdminField
                      label="Ссылка на установщик"
                      value={releaseUrl}
                      onChange={setReleaseUrl}
                    />
                    <AdminField
                      label="Подпись"
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
                      Копировать
                    </PrimaryButton>
                    <PurpleButton
                      onClick={() => downloadTextFile("latest.json", releaseManifestJson)}
                    >
                      <Download size={18} />
                      Экспорт
                    </PurpleButton>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-sm text-white/55">
                  <div className="mb-3 text-lg font-black text-white">Порядок релиза</div>
                  <div className="space-y-2">
                    <div>1. Упакуй файлы мода относительно корня GTA V.</div>
                    <div>2. Загрузи архив в GitHub Release или репозиторий данных.</div>
                    <div>3. Вставь прямую ссылку на архив в поле скачивания.</div>
                    <div>4. Экспортируй redux.json и загрузи его в репозиторий данных.</div>
                    <div>
                      5. Собери релиз Tauri, вставь ссылку и подпись, затем экспортируй latest.json.
                    </div>
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
                ПУТЬ К GTA V
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
                ПАПКА СИСТЕМНЫХ ФАЙЛОВ
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-4">
                <input
                  value={systemPath}
                  onChange={(e) => setSystemPath(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 outline-none"
                  placeholder="Папка загрузок, резервных копий и временных файлов"
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
              <SettingsCard
                icon={<FileText />}
                title="Версия приложения"
                value={`v${APP_VERSION}`}
              />

              <SettingsCard
                icon={<Gamepad2 />}
                title="GTA V"
                value={gtaPath ? "Настроено" : "Не найдено"}
              />

              <SettingsCard
                icon={<Package />}
                title="Установленные моды"
                value={String(Object.keys(installedRedux).length)}
              />

              <SettingsCard
                icon={<Download />}
                title="Системные файлы"
                value={systemPath ? "Выбрано" : "По умолчанию"}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={() => checkForAppUpdate(false)}>
                <RefreshCw size={18} />
                Проверить обновление
              </PrimaryButton>
              <PurpleButton disabled={loading} onClick={installTauriUpdate}>
                <Download size={18} />
                Скачать обновление
              </PurpleButton>
            </div>
          </ToolPanel>
        )}
      </main>

      <SupportPanel
        open={supportOpen}
        currentUser={adminMe}
        tickets={mySupportTickets}
        message={supportMessage}
        loading={loading}
        onClose={() => setSupportOpen(false)}
        onMessageChange={setSupportMessage}
        onRefresh={loadMySupportTickets}
        onSubmit={submitSupportMessage}
      />

      <PromoPopup
        state={promoState}
        onClose={() => {
          setPromoState((current) => (current === "open" ? "closing" : current));
        }}
      />

      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/45 px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex items-center gap-3 text-sm font-bold">
            <span
              className={`h-3 w-3 rounded-full ${loading ? "bg-yellow-400" : "bg-green-400"}`}
            />

            <span>СТАТУС: {status}</span>
          </div>

          <div className="flex items-center gap-3">
            {promoState === "docked" && <PromoDock />}

            <button type="button" onClick={openSupportPanel} className="support-footer-button">
              <MessageCircle size={18} />
              Поддержка
            </button>

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
        </div>
      </footer>
    </div>
  );
}

function PromoPopup({
  state,
  onClose,
}: {
  state: "open" | "closing" | "docked";
  onClose: () => void;
}) {
  if (state === "docked") return null;

  return (
    <div
      className={`promo-popup-overlay ${state === "closing" ? "promo-popup-overlay--closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Промо Hardy MODS"
    >
      <div className={`promo-popup-card ${state === "closing" ? "promo-popup-card--closing" : ""}`}>
        <button
          type="button"
          className="promo-popup-close"
          onClick={onClose}
          onPointerDown={(event) => {
            event.preventDefault();
            onClose();
          }}
          aria-label="Закрыть"
        >
          <X size={20} />
        </button>

        <div className="promo-popup-glow" />
        <div className="promo-popup-badge">MAJESTIC RP</div>

        <div className="relative z-10">
          <h2 className="promo-popup-title">Зарегистрируйся по нашему промо</h2>
          <p className="promo-popup-text">
            На всех серверах Majestic введи промокод и получи:
            <br />7 дней Majestic Premium + 50 000$ на старте.
          </p>

          <div className="promo-popup-code">
            <span>/promo</span>
            <strong>HRDY</strong>
          </div>

          <div className="promo-popup-actions">
            <button
              type="button"
              className="promo-popup-primary"
              onClick={() => void openUrl(PROMO_REGISTER_URL)}
            >
              <ExternalLink size={19} />
              Зарегистрироваться
            </button>

            <button
              type="button"
              className="promo-popup-discord"
              onClick={() => void openUrl(PROMO_DISCORD_URL)}
            >
              <MessageCircle size={19} />
              Discord HRDY
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PromoDock({ floating = false }: { floating?: boolean }) {
  return (
    <div
      className={floating ? "promo-footer-dock promo-footer-dock--floating" : "promo-footer-dock"}
    >
      <button
        type="button"
        className="promo-footer-action"
        onClick={() => void openUrl(PROMO_DISCORD_URL)}
        aria-label="Discord HRDY"
      >
        <MessageCircle size={18} />
        <span>Discord</span>
      </button>

      <button
        type="button"
        className="promo-footer-action promo-footer-action--code"
        onClick={() => void openUrl(PROMO_REGISTER_URL)}
        aria-label="Промокод HRDY"
      >
        <span className="promo-footer-slash">/</span>
        <span>promo HRDY</span>
      </button>
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

function formatSupportDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function SupportPanel({
  currentUser,
  loading,
  message,
  onClose,
  onMessageChange,
  onRefresh,
  onSubmit,
  open,
  tickets,
}: {
  currentUser: AdminUser | null;
  loading: boolean;
  message: string;
  onClose: () => void;
  onMessageChange: (value: string) => void;
  onRefresh: () => void;
  onSubmit: () => void;
  open: boolean;
  tickets: SupportTicket[];
}) {
  if (!open) return null;

  return (
    <div className="support-overlay">
      <button type="button" className="support-backdrop" onClick={onClose} aria-label="Закрыть" />
      <section className="support-sheet" aria-label="Поддержка">
        <div className="support-sheet-header">
          <div>
            <div className="support-kicker">Hardy MODS</div>
            <h2>Поддержка</h2>
            <p>{currentUser?.username || "Пользователь"} · ответы придут сюда</p>
          </div>
          <button type="button" onClick={onClose} className="support-close-button">
            ×
          </button>
        </div>

        <div className="support-thread-list">
          {tickets.length === 0 ? (
            <div className="support-empty">
              <MessageCircle size={34} />
              <strong>Пока нет обращений</strong>
              <span>Напиши вопрос, и админ сможет ответить из панели.</span>
            </div>
          ) : (
            tickets.map((ticket) => (
              <div key={ticket.id} className="support-ticket">
                <div className="support-ticket-meta">
                  <span>{ticket.status === "answered" ? "отвечено" : "открыто"}</span>
                  <span>{formatSupportDate(ticket.updatedAt)}</span>
                </div>
                <div className="support-bubble support-bubble--user">{ticket.message}</div>

                {ticket.replies.map((reply) => (
                  <div key={reply.id} className="support-bubble support-bubble--admin">
                    <div className="support-reply-author">
                      {reply.authorName || getRoleTitle(reply.role)}
                    </div>
                    {reply.message}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="support-compose">
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Напиши, что случилось..."
          />
          <div className="flex justify-between gap-3">
            <PrimaryButton disabled={loading} onClick={onRefresh}>
              <RefreshCw size={18} />
              Обновить
            </PrimaryButton>
            <PurpleButton disabled={loading || !message.trim()} onClick={onSubmit}>
              <Send size={18} />
              Отправить
            </PurpleButton>
          </div>
        </div>
      </section>
    </div>
  );
}

function DiscordLoginScreen({
  cardSources,
  loading,
  status,
  onCheck,
  onLogin,
}: {
  cardSources: LoginCardSource[];
  loading: boolean;
  status: string;
  onCheck: () => void;
  onLogin: () => void;
}) {
  const loginMotionFrame = useRef<number | null>(null);
  const loginMotionPointer = useRef<{ root: HTMLElement; x: number; y: number } | null>(null);
  const loginCards = useMemo(() => createLoginCards(cardSources), [cardSources]);

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

      pointer.root.style.setProperty("--login-proximity", easedProximity.toFixed(3));
    });
  }

  function moveLoginFloatCard(event: React.PointerEvent<HTMLDivElement>) {
    setTiltedCardVars(event.currentTarget, event.clientX, event.clientY, 0.92);
  }

  function resetLoginFloatCard(event: React.PointerEvent<HTMLDivElement>) {
    resetTiltedCardVars(event.currentTarget);
  }

  function resetLoginCards(event: React.PointerEvent<HTMLElement>) {
    if (loginMotionFrame.current !== null) {
      window.cancelAnimationFrame(loginMotionFrame.current);
      loginMotionFrame.current = null;
    }

    loginMotionPointer.current = null;
    event.currentTarget.style.setProperty("--login-proximity", "0");
    event.currentTarget.style.setProperty("--login-motion-duration", "8s");
    event.currentTarget.style.setProperty("--login-shake", "0px");
    event.currentTarget.style.setProperty("--login-shake-neg", "0px");
  }

  return (
    <div className="app-shell min-h-screen overflow-hidden bg-[#07070a] text-white">
      <GlowCursor />
      <div className="app-bg app-bg--base" />
      <div className="app-bg app-bg--grid" />
      <div className="app-wire app-wire--left" />
      <div className="app-wire app-wire--right" />

      <main
        className="discord-login-shell relative z-10 grid min-h-screen grid-cols-[minmax(430px,.82fr)_minmax(520px,1.18fr)] items-center gap-12 px-12 py-12"
        onPointerMove={moveLoginCards}
        onPointerLeave={resetLoginCards}
      >
        <div className="w-full max-w-[680px] rounded-[36px] border border-white/15 bg-black/52 p-8 shadow-[0_0_80px_rgba(255,255,255,.14)] backdrop-blur-2xl">
          <div className="mb-8 flex items-center gap-4">
            <div className="login-panel-logo">
              <BrandWordmark variant="mini" />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-[.22em] text-white/35">
                Вход в приложение
              </div>
            </div>
          </div>

          <div className="mb-8 rounded-3xl border border-white/10 bg-white/[.04] p-5">
            <div className="mb-2 flex items-center gap-3 text-lg font-black">
              <ShieldCheck size={22} className="text-white/85" />
              Вход через Discord
            </div>
            <div className="text-sm leading-6 text-white/55">
              Все пользователи заходят через Discord. Если роль владелец или админ, после входа
              появится кнопка админ-панели.
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <PrimaryButton disabled={loading} onClick={onLogin}>
              <User size={18} />
              Войти через Discord
            </PrimaryButton>
            <PurpleButton disabled={loading} onClick={onCheck}>
              Продолжить
            </PurpleButton>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm text-white/55">
            Статус: {status}
          </div>
        </div>

        <div className="login-card-stage relative hidden h-[720px] overflow-hidden lg:block">
          {loginCards.map((card) => (
            <div
              key={card.id}
              className={`login-float-card login-float-card--${card.depth}`}
              onPointerMove={moveLoginFloatCard}
              onPointerLeave={resetLoginFloatCard}
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
              {card.image ? (
                <img src={card.image} className="login-float-card-image" />
              ) : (
                <div className="login-float-card-fallback" />
              )}
              <div className="login-float-card-sheen" />
              <div className="login-float-card-mark">{card.accent}</div>
              <div className="login-float-card-copy">
                <span>{card.subtitle}</span>
                <strong>{card.title}</strong>
              </div>
            </div>
          ))}
          <div className="absolute inset-x-10 top-1/2 h-px bg-white/20 shadow-[0_0_34px_rgba(255,255,255,.35)]" />
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
  onOpen,
  onInstall,
  onRestore,
}: {
  item: ModItem;
  installed?: InstalledMod;
  loading: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onRestore: () => void;
}) {
  const hasUpdate = Boolean(installed && installed.version !== item.version);
  const installDisabled = loading || (Boolean(installed) && !hasUpdate);

  return (
    <div className="mod-card group">
      <button type="button" onClick={onOpen} className="mod-card-media mod-card-media-button">
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
          {installed ? (hasUpdate ? "Обновление" : "Установлено") : "Новое"}
        </div>
      </button>

      <div className="p-6">
        <h3 className="text-3xl font-black">{item.name}</h3>
        <p className="mt-3 text-white/55">{item.description}</p>
        <p className="mt-3 text-white/35">
          {item.size}
          {installed && (
            <span className="ml-2 text-white/45">установлено v{installed.version}</span>
          )}
        </p>

        {item.rpfPatches && item.rpfPatches.length > 0 && (
          <div className="mt-4 rounded-2xl border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-sm font-black text-purple-100">
            Замены RPF: {item.rpfPatches.length}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onOpen} className="mod-open-button">
            Подробнее
          </button>

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
            title="Восстановить резервную копию / удалить мод"
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
        placeholder="Поиск..."
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
    <div className="path-box mb-5 break-all rounded-2xl border border-white/10 bg-black/35 p-5 text-white/65">
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
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white px-6 py-4 font-black text-black shadow-[0_0_24px_rgba(255,255,255,.18)] hover:bg-zinc-200 disabled:opacity-40"
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
