@echo off
setlocal
cd /d "%~dp0.."

echo Hardy MODS Admin API deploy
echo.
echo Before first deploy, set these secrets:
echo   npx wrangler secret put DISCORD_CLIENT_SECRET -c admin-worker/wrangler.jsonc
echo   npx wrangler secret put SESSION_SECRET -c admin-worker/wrangler.jsonc
echo   npx wrangler secret put GITHUB_TOKEN -c admin-worker/wrangler.jsonc
echo.
echo Also edit admin-worker\wrangler.jsonc:
echo   DISCORD_CLIENT_ID
echo   DISCORD_REDIRECT_URI
echo   FRONTEND_ORIGIN
echo.
pause
npm.cmd run admin:deploy
pause
