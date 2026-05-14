const DISCORD_API = "https://discord.com/api";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DEFAULT_OWNER_ID = "1452029134300774414";

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      if (route === "GET /health") {
        return json(request, env, { ok: true, service: "majestic-redux-manager" });
      }

      if (route === "GET /auth/discord/start") {
        return startDiscordAuth(request, env);
      }

      if (route === "GET /auth/discord/callback") {
        return finishDiscordAuth(request, env);
      }

      if (route === "POST /auth/logout") {
        return json(
          request,
          env,
          { ok: true },
          {
            "Set-Cookie": cookie("hm_session", "", { maxAge: 0 }),
          },
        );
      }

      if (route === "GET /api/me") {
        const user = await requireUser(request, env);
        return json(request, env, { user: await publicUser(user, env) });
      }

      if (route === "GET /api/admins") {
        await requireRole(request, env, "owner");
        return json(request, env, await getAdminState(env));
      }

      if (route === "POST /api/github-token-check") {
        await requireRole(request, env, "owner");
        return json(request, env, await checkGithubToken(env));
      }

      if (route === "POST /api/admins") {
        const user = await requireRole(request, env, "owner");
        const body = await readJson(request);
        const admin = await addAdmin(env, body.discordId, body.label, user.id);
        return json(request, env, admin);
      }

      if (request.method === "DELETE" && url.pathname.startsWith("/api/admins/")) {
        await requireRole(request, env, "owner");
        const discordId = decodeURIComponent(url.pathname.slice("/api/admins/".length));
        return json(request, env, await removeAdmin(env, discordId));
      }

      if (route === "GET /api/catalog") {
        await requireRole(request, env, "admin");
        const catalog = await readJsonFile(env, env.DATA_REPO, env.CATALOG_PATH || "redux.json");
        return json(request, env, normalizeCatalogDocument(catalog));
      }

      if (route === "PUT /api/catalog") {
        const user = await requireRole(request, env, "admin");
        const body = await readJson(request);
        const catalog = normalizeCatalogDocument(body.catalog ?? body);
        validateCatalog(catalog);

        const result = await writeJsonFile(
          env,
          env.DATA_REPO,
          env.CATALOG_PATH || "redux.json",
          catalog,
          body.message || `Update redux catalog by Discord ${user.id}`,
        );

        return json(request, env, { ok: true, commit: result.commit });
      }

      if (route === "PUT /api/latest") {
        const user = await requireRole(request, env, "owner");
        const body = await readJson(request);
        const manifest = body.manifest ?? body;
        validateLatestManifest(manifest);

        const result = await writeJsonFile(
          env,
          env.MANAGER_REPO,
          env.LATEST_PATH || "latest.json",
          manifest,
          body.message || `Update app manifest by Discord ${user.id}`,
        );

        return json(request, env, { ok: true, commit: result.commit });
      }

      return json(request, env, { error: "Not found" }, {}, 404);
    } catch (error) {
      const status = error.status || 500;
      return errorResponse(error.message || "Internal error", status);
    }
  },
};

async function startDiscordAuth(request, env) {
  requireEnv(env, ["DISCORD_CLIENT_ID", "DISCORD_REDIRECT_URI"]);

  const state = crypto.randomUUID();
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": cookie("hm_oauth_state", state, { maxAge: 600 }),
    },
  });
}

async function finishDiscordAuth(request, env) {
  requireEnv(env, ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"]);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = parseCookies(request.headers.get("Cookie")).hm_oauth_state;

  if (!code || !state || state !== expectedState) {
    return authErrorPage(
      "Invalid Discord OAuth state",
      "Open the app and click Login Discord again. Do not refresh or reuse the callback URL.",
    );
  }

  const form = new URLSearchParams();
  form.set("client_id", env.DISCORD_CLIENT_ID);
  form.set("client_secret", env.DISCORD_CLIENT_SECRET);
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", env.DISCORD_REDIRECT_URI);

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (!tokenResponse.ok) {
    const detail = await safeResponseText(tokenResponse);
    return authErrorPage(
      "Discord token exchange failed",
      detail || "Check DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI in Cloudflare.",
    );
  }

  const token = await tokenResponse.json();
  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!userResponse.ok) {
    return authErrorPage("Discord user fetch failed", await safeResponseText(userResponse));
  }

  const discordUser = await userResponse.json();
  const sessionToken = await signSession(
    {
      avatar: discordUser.avatar || "",
      id: discordUser.id,
      username: discordUser.username || "",
    },
    env,
  );

  const user = await publicUser(await verifySession(sessionToken, env), env);
  const appLoginUrl = buildAppLoginUrl(request, sessionToken);
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Hardy MODS Admin Login</title>
    <style>
      body { min-height:100vh; margin:0; display:grid; place-items:center; background:#07070a; color:white; font:16px system-ui; }
      main { width:min(560px, calc(100vw - 40px)); border:1px solid #272133; border-radius:28px; padding:32px; background:linear-gradient(135deg, #0d0b12, #13091f); box-shadow:0 24px 80px rgba(124,58,237,.25); }
      a { display:inline-block; margin:16px 0; background:#7c3aed; color:#fff; padding:12px 18px; border-radius:12px; font-weight:800; text-decoration:none; }
      p { color:#c7c1d6; line-height:1.6; }
      code { color:#c4b5fd; }
    </style>
    <script>
      const appUrl = ${JSON.stringify(appLoginUrl)};
      window.addEventListener("load", () => {
        window.location.href = appUrl;
      });
    </script>
  </head>
  <body>
    <main>
      <h1>Discord login complete</h1>
    <p>Role: <code>${escapeHtml(user.role)}</code> · Discord ID: <code>${escapeHtml(user.id)}</code></p>
      <p>Hardy MODS should open automatically. If Windows asks, allow the browser to open the app.</p>
      <a href="${escapeHtml(appLoginUrl)}">Open Hardy MODS</a>
      <p>If nothing opens, install the latest Hardy MODS version and try Login Discord again.</p>
    </main>
  </body>
</html>`;

  const headers = new Headers({
    "Content-Type": "text/html;charset=utf-8",
  });
  headers.append("Set-Cookie", cookie("hm_oauth_state", "", { maxAge: 0 }));
  headers.append("Set-Cookie", cookie("hm_session", sessionToken, { maxAge: 60 * 60 * 24 * 7 }));

  return new Response(html, { headers });
}

function buildAppLoginUrl(request, sessionToken) {
  try {
    const appUrl = new URL("hardy-mods://auth");
    appUrl.searchParams.set("discord_token", sessionToken);
    appUrl.searchParams.set("admin_api_url", new URL(request.url).origin);
    return appUrl.toString();
  } catch {
    return "hardy-mods://auth";
  }
}

function authErrorPage(title, detail = "") {
  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Hardy MODS Login Error</title>
    <style>
      body { background:#07070a; color:white; font:16px system-ui; padding:32px; }
      code, pre { color:#fca5a5; white-space:pre-wrap; }
      a { color:#c4b5fd; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
    <p>Close this tab and try Login Discord again from the app.</p>
  </body>
</html>`,
    {
      status: 400,
      headers: { "Content-Type": "text/html;charset=utf-8" },
    },
  );
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function requireUser(request, env) {
  const token = readSessionToken(request);

  if (!token) {
    throw httpError(401, "Login required");
  }

  return verifySession(token, env);
}

async function requireRole(request, env, role) {
  const user = await requireUser(request, env);
  const resolvedRole = await getRole(user.id, env);

  if (role === "owner" && resolvedRole !== "owner") {
    throw httpError(403, "Owner role required");
  }

  if (role === "admin" && !["owner", "admin"].includes(resolvedRole)) {
    throw httpError(403, "Admin role required");
  }

  return { ...user, role: resolvedRole };
}

async function publicUser(user, env) {
  return {
    avatar: user.avatar,
    id: user.id,
    role: await getRole(user.id, env),
    username: user.username,
  };
}

async function getRole(discordId, env) {
  if (discordId === ownerId(env)) return "owner";

  const state = await getAdminState(env);
  return state.admins.some((admin) => admin.discordId === discordId) ? "admin" : "viewer";
}

async function getAdminState(env) {
  try {
    const state = await readJsonFile(env, env.DATA_REPO, env.ADMINS_PATH || "admin/admins.json");
    return {
      admins: Array.isArray(state.admins) ? state.admins : [],
      ownerDiscordId: state.ownerDiscordId || ownerId(env),
      schemaVersion: 1,
    };
  } catch {
    return {
      admins: [],
      ownerDiscordId: ownerId(env),
      schemaVersion: 1,
    };
  }
}

async function addAdmin(env, discordId, label, createdBy) {
  const cleanId = String(discordId || "").trim();

  if (!/^\d{15,25}$/.test(cleanId)) {
    throw httpError(400, "Discord ID must be a numeric snowflake");
  }

  if (cleanId === ownerId(env)) {
    throw httpError(400, "Owner does not need to be added as admin");
  }

  const state = await getAdminState(env);
  const existing = state.admins.find((admin) => admin.discordId === cleanId);

  if (existing) {
    return state;
  }

  state.admins.push({
    createdAt: new Date().toISOString(),
    createdBy,
    discordId: cleanId,
    label: String(label || "").trim(),
  });

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.ADMINS_PATH || "admin/admins.json",
    state,
    `Add admin ${cleanId}`,
  );

  return state;
}

async function removeAdmin(env, discordId) {
  const state = await getAdminState(env);
  state.admins = state.admins.filter((admin) => admin.discordId !== discordId);

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.ADMINS_PATH || "admin/admins.json",
    state,
    `Remove admin ${discordId}`,
  );

  return state;
}

async function checkGithubToken(env) {
  const repo = env.DATA_REPO;
  const path = "admin/token-check.json";
  const result = {
    branch: env.GITHUB_BRANCH || "main",
    repo,
    tokenConfigured: Boolean(String(env.GITHUB_TOKEN || "").trim()),
  };

  if (!result.tokenConfigured) {
    return { ...result, ok: false, error: "GITHUB_TOKEN is empty in Worker runtime" };
  }

  const repoResponse = await github(env, `/repos/${repo}`);
  const repoText = await repoResponse.text();

  result.repoStatus = repoResponse.status;

  if (!repoResponse.ok) {
    return {
      ...result,
      ok: false,
      error: `GitHub repo read failed: ${repoText}`,
    };
  }

  try {
    const repoData = JSON.parse(repoText);
    result.permissions = repoData.permissions || null;
  } catch {
    result.permissions = null;
  }

  try {
    await writeJsonFile(
      env,
      repo,
      path,
      {
        checkedAt: new Date().toISOString(),
        ok: true,
        service: "majestic-redux-manager",
      },
      "Check GitHub token write access",
    );

    return { ...result, ok: true, writePath: path };
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: error.message || String(error),
    };
  }
}

function normalizeCatalogDocument(value) {
  if (value && typeof value === "object" && Array.isArray(value.categories)) {
    return {
      app: {
        catalogUrl: value.app?.catalogUrl || "",
        name: value.app?.name || "Hardy MODS",
      },
      categories: value.categories,
      schemaVersion: 1,
      updatedAt: value.updatedAt || new Date().toISOString(),
    };
  }

  if (Array.isArray(value)) {
    const looksLikeCategories = value.some((entry) => Array.isArray(entry?.mods));

    return {
      app: {
        catalogUrl: "",
        name: "Hardy MODS",
      },
      categories: looksLikeCategories
        ? value
        : [
            {
              description: "Available redux packages",
              id: "redux",
              mods: value,
              title: "Redux Mods",
            },
          ],
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    app: {
      catalogUrl: "",
      name: "Hardy MODS",
    },
    categories: [],
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog.categories)) {
    throw httpError(400, "catalog.categories must be an array");
  }

  const ids = new Set();

  for (const category of catalog.categories) {
    if (!category.id || !category.title) {
      throw httpError(400, "Each category needs id and title");
    }

    if (!Array.isArray(category.mods)) {
      throw httpError(400, `Category ${category.id} mods must be an array`);
    }

    for (const mod of category.mods) {
      if (!mod.id || !mod.name || !mod.version || !mod.downloadUrl) {
        throw httpError(400, "Each mod needs id, name, version and downloadUrl");
      }

      if (ids.has(mod.id)) {
        throw httpError(400, `Duplicate mod id: ${mod.id}`);
      }

      ids.add(mod.id);
      validateHttpUrl(mod.downloadUrl, `Invalid downloadUrl for ${mod.id}`);

      if (mod.rpfPatches !== undefined) {
        if (!Array.isArray(mod.rpfPatches)) {
          throw httpError(400, `rpfPatches for ${mod.id} must be an array`);
        }

        for (const patch of mod.rpfPatches) {
          if (!patch?.rpfPath || !patch?.internalPath || !patch?.file) {
            throw httpError(400, `Each RPF patch for ${mod.id} needs rpfPath, internalPath and file`);
          }
        }
      }
    }
  }
}

function validateLatestManifest(manifest) {
  if (!manifest.version || !manifest.platforms?.["windows-x86_64"]) {
    throw httpError(400, "latest.json needs version and platforms.windows-x86_64");
  }

  const platform = manifest.platforms["windows-x86_64"];

  if (!platform.url || !platform.signature) {
    throw httpError(400, "latest.json platform needs url and signature");
  }

  validateHttpUrl(platform.url, "Invalid installer URL");
}

function validateHttpUrl(value, message) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
  } catch {
    throw httpError(400, message);
  }
}

async function readJsonFile(env, repo, path) {
  const response = await github(env, `/repos/${repo}/contents/${encodeURIComponentPath(path)}`);

  if (response.status === 404) {
    throw httpError(404, `${path} not found`);
  }

  if (!response.ok) {
    throw httpError(response.status, `GitHub read failed for ${path}`);
  }

  const file = await response.json();
  return JSON.parse(base64ToText(file.content || ""));
}

async function writeJsonFile(env, repo, path, value, message) {
  const encodedPath = encodeURIComponentPath(path);
  let sha;

  const current = await github(env, `/repos/${repo}/contents/${encodedPath}`);

  if (current.ok) {
    sha = (await current.json()).sha;
  } else if (current.status !== 404) {
    throw httpError(current.status, `GitHub SHA read failed for ${path}`);
  }

  const body = {
    branch: env.GITHUB_BRANCH || "main",
    content: textToBase64(`${JSON.stringify(value, null, 2)}\n`),
    message,
    ...(sha ? { sha } : {}),
  };

  const response = await github(env, `/repos/${repo}/contents/${encodedPath}`, {
    body: JSON.stringify(body),
    method: "PUT",
  });

  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `GitHub write failed: ${text}`);
  }

  return response.json();
}

async function github(env, path, init = {}) {
  requireEnv(env, ["GITHUB_TOKEN"]);

  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "majestic-redux-manager",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

async function signSession(user, env) {
  requireEnv(env, ["SESSION_SECRET"]);

  const payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(payloadPart, env.SESSION_SECRET);

  return `${payloadPart}.${signature}`;
}

async function verifySession(token, env) {
  requireEnv(env, ["SESSION_SECRET"]);

  const [payloadPart, signature] = String(token).split(".");

  if (!payloadPart || !signature) {
    throw httpError(401, "Invalid session");
  }

  const expected = await hmac(payloadPart, env.SESSION_SECRET);

  if (signature !== expected) {
    throw httpError(401, "Invalid session signature");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw httpError(401, "Session expired");
  }

  return payload;
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlFromBytes(new Uint8Array(signature));
}

function readSessionToken(request) {
  const auth = request.headers.get("Authorization") || "";

  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }

  return parseCookies(request.headers.get("Cookie")).hm_session;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Invalid JSON body");
  }
}

function json(request, env, body, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
  });
}

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowed = new Set(
    String(
      env.FRONTEND_ORIGIN ||
        "http://localhost:8080,http://127.0.0.1:8080,http://tauri.localhost,tauri://localhost",
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const isTauriOrigin = ["http://tauri.localhost", "tauri://localhost"].includes(requestOrigin);
  const origin =
    allowed.has(requestOrigin) || isTauriOrigin
      ? requestOrigin
      : Array.from(allowed)[0] || requestOrigin;

  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function cookie(name, value, { maxAge }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${maxAge}`,
  ];

  return parts.join("; ");
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function ownerId(env) {
  return env.OWNER_DISCORD_ID || DEFAULT_OWNER_ID;
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw httpError(500, `Missing environment variables: ${missing.join(", ")}`);
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function encodeURIComponentPath(path) {
  return String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToText(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(text) {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return base64ToText(padded);
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
