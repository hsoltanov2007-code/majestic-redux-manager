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

      if (route === "GET /download/latest") {
        return redirectLatestInstaller(env);
      }

      if (request.method === "GET" && url.pathname.startsWith("/mod/")) {
        const modId = decodeURIComponent(url.pathname.slice("/mod/".length).split("/")[0] || "");
        return modLandingPage(request, env, modId);
      }

      if (request.method === "GET" && url.pathname.startsWith("/m/")) {
        const modId = decodeURIComponent(url.pathname.slice("/m/".length).split("/")[0] || "");
        return modLandingPage(request, env, modId);
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

      if (route === "POST /api/presence") {
        const user = await requireUser(request, env);
        return json(request, env, await updatePresence(env, user));
      }

      if (route === "POST /api/install-event") {
        const user = await requireUser(request, env);
        const body = await readJson(request);
        return json(request, env, await recordInstallEvent(env, user, body));
      }

      if (route === "GET /api/stats") {
        await requireRole(request, env, "admin");
        return json(request, env, await getAppStats(env));
      }

      if (route === "GET /api/admins") {
        await requireRole(request, env, "owner");
        return json(request, env, await getAdminState(env));
      }

      if (route === "GET /api/users") {
        await requireRole(request, env, "owner");
        return json(request, env, await getOwnerVisibleUsers(env));
      }

      if (route === "GET /api/support/mine") {
        const user = await requireUser(request, env);
        return json(request, env, await getSupportForUser(env, user.id));
      }

      if (route === "POST /api/support") {
        const user = await requireUser(request, env);
        const body = await readJson(request);
        return json(request, env, await createSupportTicket(env, user, body));
      }

      if (route === "GET /api/support") {
        await requireRole(request, env, "admin");
        return json(request, env, await getSupportForAdmin(env));
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/support/")) {
        const user = await requireRole(request, env, "admin");
        const ticketId = decodeURIComponent(
          url.pathname.slice("/api/support/".length).replace(/\/reply$/, ""),
        );

        if (!url.pathname.endsWith("/reply")) {
          return json(request, env, { error: "Not found" }, {}, 404);
        }

        const body = await readJson(request);
        return json(request, env, await replySupportTicket(env, ticketId, body, user));
      }

      if (route === "POST /api/github-token-check") {
        await requireRole(request, env, "owner");
        return json(request, env, await checkGithubToken(env));
      }

      if (route === "POST /api/assets/file") {
        const user = await requireRole(request, env, "admin");
        return json(request, env, await uploadRepoFileAsset(request, env, user));
      }

      if (route === "POST /api/assets/release") {
        const user = await requireRole(request, env, "admin");
        return json(request, env, await uploadReleaseAsset(request, env, user));
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

  try {
    await upsertKnownUser(env, {
      avatar: discordUser.avatar || "",
      id: discordUser.id,
      role: await getRole(discordUser.id, env),
      username: discordUser.username || "",
    });
  } catch {
    // Login must not fail just because the analytics file is temporarily locked.
  }

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

async function modLandingPage(request, env, modId) {
  const cleanModId = sanitizeSlug(modId);

  if (!cleanModId) {
    return publicErrorPage("Мод не найден", "В ссылке нет ID мода.", 404);
  }

  const variantId = sanitizeSlug(new URL(request.url).searchParams.get("variant") || "");
  const mod = await findCatalogMod(env, cleanModId).catch(() => null);
  const title = mod?.name || cleanModId;
  const description = mod?.description || "Открой мод в Hardy MODS или скачай последнюю версию приложения.";
  const image = mod?.image || "";
  const version = mod?.version ? `v${mod.version}` : "latest";
  const size = mod?.size || "Auto install";
  const variantCount = Array.isArray(mod?.variants) ? mod.variants.length : 0;
  const patchCount =
    (Array.isArray(mod?.rpfPatches) ? mod.rpfPatches.length : 0) +
    (Array.isArray(mod?.variants)
      ? mod.variants.reduce((total, variant) => total + (variant.rpfPatches?.length || 0), 0)
      : 0);
  const appUrl = buildAppModUrl(cleanModId, variantId);
  const downloadUrl = `${new URL(request.url).origin}/download/latest`;

  return new Response(
    `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Hardy MODS</title>
    <meta property="og:title" content="${escapeHtml(title)} · Hardy MODS" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
    <style>
      * { box-sizing:border-box; }
      :root { color-scheme:light; }
      body {
        min-height:100vh;
        margin:0;
        overflow-x:hidden;
        background:
          radial-gradient(circle at 16% 18%, rgba(255,255,255,.96), transparent 28rem),
          radial-gradient(circle at 74% 18%, rgba(210,214,220,.72), transparent 34rem),
          linear-gradient(135deg, #fbfbfc 0%, #e8e8eb 46%, #cfd1d5 100%);
        color:#09090b;
        font:16px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body:before {
        content:"";
        position:fixed;
        inset:0;
        pointer-events:none;
        background:
          linear-gradient(90deg, rgba(8,8,10,.045) 1px, transparent 1px),
          linear-gradient(rgba(8,8,10,.04) 1px, transparent 1px);
        background-size:72px 72px;
        mask-image:radial-gradient(circle at center, black, transparent 72%);
      }
      body:after {
        content:"";
        position:fixed;
        inset:auto 0 0 0;
        height:28vh;
        pointer-events:none;
        background:linear-gradient(transparent, rgba(255,255,255,.52));
      }
      .shell {
        position:relative;
        z-index:1;
        min-height:100vh;
        display:grid;
        grid-template-rows:auto 1fr auto;
        padding:22px;
      }
      header {
        width:min(1180px, 100%);
        margin:0 auto;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:16px;
        border:1px solid rgba(10,10,12,.09);
        border-radius:24px;
        background:rgba(255,255,255,.64);
        padding:12px 14px 12px 18px;
        box-shadow:0 20px 70px rgba(20,20,28,.08);
        backdrop-filter:blur(22px);
      }
      .brand { display:flex; align-items:center; gap:12px; font-weight:1000; letter-spacing:.08em; text-transform:uppercase; }
      .brand-mark {
        display:grid;
        place-items:center;
        width:42px;
        height:42px;
        border-radius:15px;
        background:#09090b;
        color:#fff;
        box-shadow:0 16px 38px rgba(0,0,0,.22);
      }
      .header-pill { border:1px solid rgba(10,10,12,.1); border-radius:999px; padding:10px 14px; color:#4b4b52; font-size:13px; font-weight:850; background:rgba(255,255,255,.66); }
      main {
        width:min(1180px, 100%);
        margin:58px auto 42px;
        display:grid;
        grid-template-columns:minmax(0,.92fr) minmax(420px,1.08fr);
        align-items:stretch;
        gap:18px;
      }
      .copy {
        position:relative;
        border:1px solid rgba(10,10,12,.1);
        border-radius:34px;
        background:rgba(255,255,255,.68);
        padding:42px;
        box-shadow:0 34px 100px rgba(24,24,32,.16);
        backdrop-filter:blur(24px);
      }
      .copy:before {
        content:"";
        position:absolute;
        inset:18px auto auto 18px;
        width:80px;
        height:3px;
        border-radius:999px;
        background:#09090b;
        opacity:.9;
      }
      .kicker {
        display:inline-flex;
        gap:10px;
        align-items:center;
        margin:22px 0 20px;
        border:1px solid rgba(0,0,0,.12);
        border-radius:999px;
        padding:8px 13px;
        color:#4f5056;
        font-size:12px;
        font-weight:950;
        letter-spacing:.18em;
        text-transform:uppercase;
        background:rgba(255,255,255,.62);
      }
      .kicker:before { content:""; width:7px; height:7px; border-radius:999px; background:#09090b; box-shadow:0 0 18px rgba(0,0,0,.34); }
      h1 { margin:0; max-width:620px; font-size:clamp(42px, 6vw, 82px); line-height:.88; letter-spacing:0; text-transform:uppercase; }
      p { max-width:560px; color:#5b5c63; line-height:1.75; font-size:17px; }
      .badges { display:flex; flex-wrap:wrap; gap:10px; margin:24px 0 0; }
      .badge { border:1px solid rgba(0,0,0,.1); border-radius:999px; background:rgba(255,255,255,.66); padding:9px 12px; color:#303036; font-size:13px; font-weight:900; }
      .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:30px; }
      a { display:inline-flex; align-items:center; justify-content:center; min-height:54px; border-radius:17px; padding:0 22px; font:950 15px system-ui; text-decoration:none; transition:transform .18s ease, box-shadow .18s ease, background .18s ease; }
      a:hover { transform:translateY(-2px); }
      .primary { background:#09090b; color:white; box-shadow:0 22px 54px rgba(0,0,0,.26); }
      .ghost { background:rgba(255,255,255,.8); color:#09090b; border:1px solid rgba(0,0,0,.12); box-shadow:0 14px 40px rgba(0,0,0,.08); }
      .status { margin-top:22px; border:1px solid rgba(0,0,0,.10); border-radius:20px; padding:15px 16px; color:#5b5c63; background:rgba(255,255,255,.66); line-height:1.55; }
      .media-card {
        position:relative;
        min-height:560px;
        overflow:hidden;
        border:1px solid rgba(10,10,12,.1);
        border-radius:34px;
        background:#111;
        box-shadow:0 34px 100px rgba(24,24,32,.18);
      }
      .media-card:before {
        content:"";
        position:absolute;
        inset:0;
        z-index:2;
        background:linear-gradient(90deg, rgba(0,0,0,.28), transparent 42%), linear-gradient(0deg, rgba(0,0,0,.5), transparent 45%);
        pointer-events:none;
      }
      .media-card:after {
        content:"";
        position:absolute;
        inset:18px;
        z-index:3;
        border:1px solid rgba(255,255,255,.26);
        border-radius:26px;
        pointer-events:none;
      }
      .media-card img { width:100%; height:100%; object-fit:cover; filter:saturate(1.1) contrast(1.04); transform:scale(1.015); }
      .fallback { height:100%; min-height:560px; display:grid; place-items:center; color:white; background:linear-gradient(135deg,#08080a,#33343a); font-size:96px; font-weight:1000; letter-spacing:.02em; }
      .media-caption {
        position:absolute;
        z-index:4;
        left:30px;
        right:30px;
        bottom:28px;
        display:flex;
        align-items:end;
        justify-content:space-between;
        gap:18px;
        color:white;
      }
      .caption-title { font-size:28px; font-weight:1000; text-transform:uppercase; text-shadow:0 12px 35px rgba(0,0,0,.75); }
      .caption-chip { border:1px solid rgba(255,255,255,.22); border-radius:999px; background:rgba(0,0,0,.4); padding:10px 13px; font-size:12px; font-weight:950; letter-spacing:.14em; text-transform:uppercase; backdrop-filter:blur(12px); }
      footer { width:min(1180px, 100%); margin:0 auto; color:#73747a; font-size:13px; }
      @media (max-width:900px) {
        .shell { padding:14px; }
        header { border-radius:20px; }
        .header-pill { display:none; }
        main { grid-template-columns:1fr; margin-top:22px; }
        .media-card { min-height:320px; order:-1; }
        .fallback { min-height:320px; }
        .copy { padding:28px; border-radius:28px; }
        .media-caption { left:22px; right:22px; bottom:20px; }
      }
    </style>
    <script>
      const appUrl = ${JSON.stringify(appUrl)};
      window.addEventListener("load", () => {
        const status = document.querySelector(".status");
        setTimeout(() => { window.location.href = appUrl; }, 480);
        setTimeout(() => {
          if (status) status.textContent = "Если приложение не открылось автоматически, скачай Hardy MODS или нажми кнопку открытия еще раз.";
        }, 1800);
      });
    </script>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand"><span class="brand-mark">H</span><span>Hardy MODS</span></div>
        <div class="header-pill">Secure share link · GTA V mods</div>
      </header>
      <main>
        <section class="copy">
          <div class="kicker">Mod share link</div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
          <div class="badges">
            <span class="badge">${escapeHtml(version)}</span>
            <span class="badge">${escapeHtml(size)}</span>
            <span class="badge">${variantCount > 0 ? `${variantCount} variants` : "One click install"}</span>
            <span class="badge">${patchCount > 0 ? `${patchCount} RPF patches` : "Backup ready"}</span>
          </div>
          <div class="actions">
            <a class="primary" href="${escapeHtml(appUrl)}">Открыть в приложении</a>
            <a class="ghost" href="${escapeHtml(downloadUrl)}">Скачать Hardy MODS</a>
          </div>
          <div class="status">Открываю Hardy MODS автоматически...</div>
        </section>
        <aside class="media-card">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" />` : `<div class="fallback">HM</div>`}
          <div class="media-caption">
            <div class="caption-title">${escapeHtml(title)}</div>
            <div class="caption-chip">Hardy Catalog</div>
          </div>
        </aside>
      </main>
      <footer>Hardy MODS is an unofficial fan tool. Open the link only if you trust the shared mod.</footer>
    </div>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "public, max-age=120",
      },
    },
  );
}

async function redirectLatestInstaller(env) {
  const latestUrl = `https://github.com/${env.MANAGER_REPO}/releases/latest/download/${env.LATEST_PATH || "latest.json"}`;

  try {
    const response = await fetch(latestUrl, {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const manifest = await response.json();
      const installerUrl = manifest.platforms?.["windows-x86_64"]?.url;

      if (installerUrl) {
        return new Response(null, {
          headers: { Location: installerUrl },
          status: 302,
        });
      }
    }
  } catch {
    // Fall back to the release page below.
  }

  return new Response(null, {
    headers: { Location: `https://github.com/${env.MANAGER_REPO}/releases/latest` },
    status: 302,
  });
}

async function findCatalogMod(env, modId) {
  const catalog = normalizeCatalogDocument(
    await readJsonFile(env, env.DATA_REPO, env.CATALOG_PATH || "redux.json"),
  );

  for (const category of catalog.categories || []) {
    const mod = (category.mods || []).find((item) => sanitizeSlug(item.id) === modId);

    if (mod) return mod;
  }

  return null;
}

function buildAppModUrl(modId, variantId = "") {
  const appUrl = new URL("hardy-mods://mod");
  appUrl.searchParams.set("mod_id", modId);
  if (variantId) appUrl.searchParams.set("variant_id", variantId);
  return appUrl.toString();
}

function publicErrorPage(title, detail, status = 400) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(
      title,
    )}</title><style>body{background:#f4f4f5;color:#111;font:16px system-ui;padding:40px}main{max-width:640px}</style></head><body><main><h1>${escapeHtml(
      title,
    )}</h1><p>${escapeHtml(detail)}</p></main></body></html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" }, status },
  );
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

async function getKnownUsersState(env) {
  try {
    const state = await readJsonFile(env, env.DATA_REPO, env.USERS_PATH || "admin/users.json");
    return {
      schemaVersion: 1,
      users: Array.isArray(state.users) ? state.users : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      users: [],
    };
  }
}

async function upsertKnownUser(env, user) {
  const state = await getKnownUsersState(env);
  const now = new Date().toISOString();
  const existing = state.users.find((entry) => entry.discordId === user.id);

  if (existing) {
    const next = {
      ...existing,
      avatar: user.avatar || existing.avatar || "",
      lastSeenAt: now,
      role: user.role || existing.role || "viewer",
      username: user.username || existing.username || "",
    };
    const changed =
      next.avatar !== existing.avatar ||
      next.role !== existing.role ||
      next.username !== existing.username ||
      Date.parse(existing.lastSeenAt || "0") < Date.now() - 1000 * 60 * 60 * 6;

    if (!changed) return state;

    Object.assign(existing, next);
  } else {
    state.users.unshift({
      avatar: user.avatar || "",
      createdAt: now,
      discordId: user.id,
      lastSeenAt: now,
      role: user.role || "viewer",
      username: user.username || "",
    });
  }

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.USERS_PATH || "admin/users.json",
    state,
    `Track user ${user.id}`,
  );

  return state;
}

async function getPresenceState(env) {
  try {
    const state = await readJsonFile(
      env,
      env.DATA_REPO,
      env.PRESENCE_PATH || "admin/presence.json",
    );
    return {
      schemaVersion: 1,
      users: state.users && typeof state.users === "object" ? state.users : {},
    };
  } catch {
    return {
      schemaVersion: 1,
      users: {},
    };
  }
}

async function getOwnerVisibleUsers(env) {
  const known = await getKnownUsersState(env);
  const presence = await getPresenceState(env);
  const cutoff = Date.now() - 1000 * 60 * 2.5;
  const usersById = new Map();

  for (const user of known.users || []) {
    if (!user?.discordId) continue;
    usersById.set(user.discordId, {
      avatar: user.avatar || "",
      createdAt: user.createdAt || "",
      discordId: user.discordId,
      lastSeenAt: user.lastSeenAt || "",
      online: false,
      role: user.role || "viewer",
      username: user.username || "",
    });
  }

  for (const [discordId, entry] of Object.entries(presence.users || {})) {
    const seen = Date.parse(entry?.lastSeenAt || "");
    const existing = usersById.get(discordId) || {
      avatar: "",
      createdAt: "",
      discordId,
      lastSeenAt: "",
      online: false,
      role: "viewer",
      username: "",
    };

    usersById.set(discordId, {
      ...existing,
      avatar: entry?.avatar || existing.avatar || "",
      lastSeenAt: entry?.lastSeenAt || existing.lastSeenAt || "",
      online: Number.isFinite(seen) && seen >= cutoff,
      role: entry?.role || existing.role || "viewer",
      username: entry?.username || existing.username || "",
    });
  }

  const users = [...usersById.values()].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return Date.parse(right.lastSeenAt || "0") - Date.parse(left.lastSeenAt || "0");
  });

  return {
    schemaVersion: 1,
    users,
  };
}

async function updatePresence(env, user) {
  const role = await getRole(user.id, env);

  try {
    await upsertKnownUser(env, { ...user, role });
  } catch {
    // Stats can still use presence if the known-user file is busy.
  }

  const state = await getPresenceState(env);
  state.users[user.id] = {
    avatar: user.avatar || "",
    lastSeenAt: new Date().toISOString(),
    role,
    username: user.username || "",
  };

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.PRESENCE_PATH || "admin/presence.json",
    state,
    `Update presence ${user.id}`,
  );

  return getAppStats(env, state);
}

async function getAppStats(env, presenceState) {
  const adminState = await getAdminState(env);
  const knownUsers = await getKnownUsersState(env);
  const presence = presenceState || (await getPresenceState(env));
  const installStats = await getInstallStats(env);
  const cutoff = Date.now() - 1000 * 60 * 2.5;
  const onlineUsers = Object.values(presence.users || {}).filter((entry) => {
    const seen = Date.parse(entry?.lastSeenAt || "");
    return Number.isFinite(seen) && seen >= cutoff;
  });
  const adminsTotal = adminState.admins.length + 1;
  const knownIds = new Set(knownUsers.users.map((user) => user.discordId).filter(Boolean));

  knownIds.add(ownerId(env));
  for (const admin of adminState.admins) {
    knownIds.add(admin.discordId);
  }

  return {
    adminsOnline: onlineUsers.filter((entry) => ["owner", "admin"].includes(entry.role)).length,
    adminsTotal,
    downloadsTotal: installStats.downloadsTotal || 0,
    popularMods: installStats.popularMods || [],
    recentInstalls: installStats.recentInstalls || [],
    totalUsers: knownIds.size,
    usersOnline: onlineUsers.length,
  };
}

async function getInstallStats(env) {
  try {
    const state = await readJsonFile(
      env,
      env.DATA_REPO,
      env.INSTALL_STATS_PATH || "admin/install-stats.json",
    );

    return {
      downloadsTotal: Number(state.downloadsTotal || 0),
      popularMods: Array.isArray(state.popularMods) ? state.popularMods : [],
      recentInstalls: Array.isArray(state.recentInstalls) ? state.recentInstalls : [],
      schemaVersion: 1,
    };
  } catch {
    return {
      downloadsTotal: 0,
      popularMods: [],
      recentInstalls: [],
      schemaVersion: 1,
    };
  }
}

async function recordInstallEvent(env, user, body) {
  const modId = String(body.modId || "").trim();
  const modName = String(body.modName || "").trim();
  const action = String(body.action || "install").trim() === "restore" ? "restore" : "install";

  if (!modId || !modName) {
    throw httpError(400, "Install event needs modId and modName");
  }

  const state = await getInstallStats(env);
  const now = new Date().toISOString();
  const popular = new Map(
    state.popularMods.map((entry) => [
      entry.modId,
      {
        count: Number(entry.count || 0),
        modId: entry.modId,
        modName: entry.modName || entry.modId,
      },
    ]),
  );

  if (action === "install") {
    const current = popular.get(modId) || { count: 0, modId, modName };
    current.count += 1;
    current.modName = modName;
    popular.set(modId, current);
    state.downloadsTotal += 1;
  }

  state.popularMods = [...popular.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 25);
  state.recentInstalls = [
    {
      action,
      modId,
      modName,
      time: now,
      userId: user.id,
      username: user.username || "",
      variantName: String(body.variantName || "").trim(),
      version: String(body.version || "").trim(),
    },
    ...state.recentInstalls,
  ].slice(0, 80);

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.INSTALL_STATS_PATH || "admin/install-stats.json",
    state,
    `Track ${action} ${modId}`,
  );

  return state;
}

async function getSupportState(env) {
  try {
    const state = await readJsonFile(env, env.DATA_REPO, env.SUPPORT_PATH || "admin/support.json");
    return {
      schemaVersion: 1,
      tickets: Array.isArray(state.tickets) ? state.tickets : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      tickets: [],
    };
  }
}

function sortedSupportState(state) {
  return {
    schemaVersion: 1,
    tickets: [...state.tickets].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  };
}

async function getSupportForUser(env, userId) {
  const state = await getSupportState(env);
  return sortedSupportState({
    ...state,
    tickets: state.tickets.filter((ticket) => ticket.userId === userId),
  });
}

async function getSupportForAdmin(env) {
  return sortedSupportState(await getSupportState(env));
}

async function createSupportTicket(env, user, body) {
  const message = String(body.message || "").trim();

  if (message.length < 2) {
    throw httpError(400, "Support message is empty");
  }

  const publicProfile = await publicUser(user, env);
  const state = await getSupportState(env);
  const now = new Date().toISOString();

  state.tickets.unshift({
    createdAt: now,
    id: crypto.randomUUID(),
    message: message.slice(0, 1800),
    replies: [],
    status: "open",
    updatedAt: now,
    userId: user.id,
    username: publicProfile.username || "",
  });
  state.tickets = state.tickets.slice(0, 150);

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.SUPPORT_PATH || "admin/support.json",
    state,
    `Create support ticket ${user.id}`,
  );

  return getSupportForUser(env, user.id);
}

async function replySupportTicket(env, ticketId, body, admin) {
  const message = String(body.message || "").trim();

  if (message.length < 2) {
    throw httpError(400, "Reply message is empty");
  }

  const state = await getSupportState(env);
  const ticket = state.tickets.find((entry) => entry.id === ticketId);

  if (!ticket) {
    throw httpError(404, "Support ticket not found");
  }

  const now = new Date().toISOString();
  ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  ticket.replies.push({
    authorId: admin.id,
    authorName: admin.username || "",
    createdAt: now,
    id: crypto.randomUUID(),
    message: message.slice(0, 1800),
    role: admin.role,
  });
  ticket.status = "answered";
  ticket.updatedAt = now;

  await writeJsonFile(
    env,
    env.DATA_REPO,
    env.SUPPORT_PATH || "admin/support.json",
    state,
    `Reply support ticket ${ticketId}`,
  );

  return getSupportForAdmin(env);
}

async function uploadRepoFileAsset(request, env, user) {
  const url = new URL(request.url);
  const repo = resolveRepo(env, url.searchParams.get("repo") || "data");
  const path = normalizeRepoAssetPath(url.searchParams.get("path") || "");
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  const body = new Uint8Array(await request.arrayBuffer());

  if (body.byteLength === 0) {
    throw httpError(400, "File body is empty");
  }

  if (body.byteLength > 10 * 1024 * 1024) {
    throw httpError(413, "Image/file upload is limited to 10 MB");
  }

  const value = {
    contentType,
    uploadedBy: user.id,
    uploadedAt: new Date().toISOString(),
  };
  const encodedPath = encodeURIComponentPath(path);
  let sha;
  const current = await github(env, `/repos/${repo}/contents/${encodedPath}`);

  if (current.ok) {
    sha = (await current.json()).sha;
  } else if (current.status !== 404) {
    throw httpError(current.status, `GitHub SHA read failed for ${path}`);
  }

  const response = await github(env, `/repos/${repo}/contents/${encodedPath}`, {
    body: JSON.stringify({
      branch: env.GITHUB_BRANCH || "main",
      content: bytesToBase64(body),
      message: `Upload catalog asset ${path} by Discord ${user.id}`,
      ...(sha ? { sha } : {}),
    }),
    method: "PUT",
  });

  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `GitHub asset upload failed: ${text}`);
  }

  return {
    ok: true,
    path,
    repo,
    url: rawGithubUrl(repo, env.GITHUB_BRANCH || "main", path),
    ...value,
  };
}

async function uploadReleaseAsset(request, env, user) {
  const url = new URL(request.url);
  const repo = resolveRepo(env, url.searchParams.get("repo") || "data");
  const tag = sanitizeTag(url.searchParams.get("tag") || "");
  const name = sanitizeAssetName(url.searchParams.get("name") || "");
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  const body = await request.arrayBuffer();

  if (!tag || !name) {
    throw httpError(400, "Release upload needs tag and name");
  }

  if (body.byteLength === 0) {
    throw httpError(400, "Release asset body is empty");
  }

  const release = await ensureRelease(env, repo, tag, user);
  await deleteReleaseAssetIfExists(env, repo, release.id, name);

  const uploadResponse = await githubUpload(
    env,
    `/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      body,
      headers: {
        "Content-Type": contentType,
      },
      method: "POST",
    },
  );

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw httpError(uploadResponse.status, `GitHub release asset upload failed: ${text}`);
  }

  const asset = await uploadResponse.json();

  return {
    assetId: asset.id,
    contentType,
    name: asset.name,
    ok: true,
    repo,
    size: asset.size,
    tag,
    uploadedBy: user.id,
    url: asset.browser_download_url,
  };
}

async function ensureRelease(env, repo, tag, user) {
  const existing = await github(env, `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);

  if (existing.ok) {
    return existing.json();
  }

  if (existing.status !== 404) {
    throw httpError(existing.status, `GitHub release lookup failed for ${tag}`);
  }

  const response = await github(env, `/repos/${repo}/releases`, {
    body: JSON.stringify({
      body: `Assets uploaded from Hardy MODS admin by Discord ${user.id}.`,
      draft: false,
      name: tag,
      prerelease: false,
      tag_name: tag,
      target_commitish: env.GITHUB_BRANCH || "main",
    }),
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `GitHub release create failed: ${text}`);
  }

  return response.json();
}

async function deleteReleaseAssetIfExists(env, repo, releaseId, assetName) {
  const response = await github(env, `/repos/${repo}/releases/${releaseId}/assets?per_page=100`);

  if (!response.ok) {
    const text = await response.text();
    throw httpError(response.status, `GitHub release assets read failed: ${text}`);
  }

  const assets = await response.json();
  const existing = assets.find((asset) => asset.name === assetName);

  if (!existing) return;

  const deleted = await github(env, `/repos/${repo}/releases/assets/${existing.id}`, {
    method: "DELETE",
  });

  if (!deleted.ok && deleted.status !== 404) {
    const text = await deleted.text();
    throw httpError(deleted.status, `GitHub old asset delete failed: ${text}`);
  }
}

function resolveRepo(env, key) {
  if (key === "manager") return env.MANAGER_REPO;
  if (key === "data") return env.DATA_REPO;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(key)) return key;
  throw httpError(400, "Unknown repo target");
}

function normalizeRepoAssetPath(path) {
  const normalized = String(path || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();

  if (!normalized || normalized.includes("..") || normalized.startsWith(".git/")) {
    throw httpError(400, "Bad asset path");
  }

  if (!/^(images|admin\/uploads)\//.test(normalized)) {
    throw httpError(400, "Assets can be uploaded only into images/ or admin/uploads/");
  }

  return normalized;
}

function sanitizeAssetName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, ".")
    .slice(0, 140);
}

function sanitizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function rawGithubUrl(repo, branch, path) {
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
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
          if (!patch?.rpfPath || !patch?.file) {
            throw httpError(
              400,
              `Each RPF patch for ${mod.id} needs rpfPath and file`,
            );
          }
        }
      }

      if (mod.variants !== undefined) {
        if (!Array.isArray(mod.variants)) {
          throw httpError(400, `variants for ${mod.id} must be an array`);
        }

        for (const variant of mod.variants) {
          if (!variant?.id || !variant?.name || !variant?.downloadUrl) {
            throw httpError(400, `Each variant for ${mod.id} needs id, name and downloadUrl`);
          }

          validateHttpUrl(variant.downloadUrl, `Invalid variant downloadUrl for ${mod.id}`);

          if (variant.rpfPatches !== undefined) {
            if (!Array.isArray(variant.rpfPatches)) {
              throw httpError(400, `variant rpfPatches for ${mod.id} must be an array`);
            }

            for (const patch of variant.rpfPatches) {
              if (!patch?.rpfPath || !patch?.file) {
                throw httpError(
                  400,
                  `Each variant RPF patch for ${mod.id} needs rpfPath and file`,
                );
              }
            }
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

async function githubUpload(env, path, init = {}) {
  requireEnv(env, ["GITHUB_TOKEN"]);

  return fetch(`https://uploads.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
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
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

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
