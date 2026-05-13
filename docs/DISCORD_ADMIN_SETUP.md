# Discord Admin Setup

This project uses a Cloudflare Worker as the secure admin backend.

Do not put Discord or GitHub secrets into the Tauri app. The desktop app is only the UI.

## Roles

- Owner: `1452029134300774414`
- Owner can publish `redux.json`, publish `latest.json`, and add/remove admins.
- Admin can publish `redux.json`.
- Viewer can login but cannot change anything.

## Discord app

1. Open Discord Developer Portal.
2. Create an application.
3. Add this redirect URL:

```txt
https://majestic-redux-manager.mmeam.workers.dev/auth/discord/callback
```

4. Copy `Client ID`.
5. Copy `Client Secret`.
6. Put `Client ID` and redirect URL into:

```txt
admin-worker/wrangler.jsonc
```

## Needed links and codes

- Worker URL: `https://majestic-redux-manager.mmeam.workers.dev`
- Discord Redirect URL: `https://majestic-redux-manager.mmeam.workers.dev/auth/discord/callback`
- Discord Client ID: goes into `admin-worker/wrangler.jsonc`.
- Discord Client Secret: goes only into Wrangler secret `DISCORD_CLIENT_SECRET`.
- GitHub token: fine-grained token with repository contents read/write for both repos.
- Session secret: any long random string for `SESSION_SECRET`.
- Owner Discord ID: `1452029134300774414` is already set.
- Frontend origins: keep local/dev and Tauri origins in `FRONTEND_ORIGIN`.

## GitHub token

Create a fine-grained GitHub token that can write contents for:

```txt
hsoltanov2007-code/majestic-redux-data
hsoltanov2007-code/majestic-redux-manager
```

It needs repository contents read/write.

## Secrets

Run:

```powershell
npx.cmd wrangler secret put DISCORD_CLIENT_SECRET -c admin-worker/wrangler.jsonc
npx.cmd wrangler secret put SESSION_SECRET -c admin-worker/wrangler.jsonc
npx.cmd wrangler secret put GITHUB_TOKEN -c admin-worker/wrangler.jsonc
```

For `SESSION_SECRET`, use a long random string.

## Deploy

```powershell
npm.cmd run admin:deploy
```

Or run:

```txt
scripts/deploy-admin-worker.bat
```

## Login flow

1. Open the app.
2. The first screen is Discord login.
3. Set `Admin API URL` to the Worker URL.
4. Click `Login Discord`.
5. Click `Open Hardy MODS` on the success page, or copy the token manually.
6. If copied manually, paste it into `Discord session token`.
7. Click `Continue`.

After that:

- everyone can enter the app after Discord login;
- owner can add admins by Discord ID;
- admins can publish `redux.json`;
- owner can publish `latest.json`.
- only owner/admin can see the `Admin` button.
