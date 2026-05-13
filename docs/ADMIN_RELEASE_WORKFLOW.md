# Admin and Release Workflow

## Mod catalog

1. Open the app.
2. Login through Discord. See `docs/DISCORD_ADMIN_SETUP.md`.
3. If your Discord role is owner/admin, open `Admin`.
4. Add categories and mods.
5. For each mod, set:
   - `Mod ID`: stable slug, for example `visual-redux`.
   - `Version`: bump this when users should see an update.
   - `Download URL`: direct `.zip` URL from GitHub Releases or your data repo.
6. Click `Publish redux.json`, or export and upload manually.

```txt
https://github.com/hsoltanov2007-code/majestic-redux-data
```

The app currently reads:

```txt
https://raw.githubusercontent.com/hsoltanov2007-code/majestic-redux-data/main/redux.json
```

## redux.json schema v1

New format:

```json
{
  "schemaVersion": 1,
  "app": {
    "name": "Hardy MODS",
    "catalogUrl": "https://raw.githubusercontent.com/hsoltanov2007-code/majestic-redux-data/main/redux.json"
  },
  "updatedAt": "2026-05-13T00:00:00.000Z",
  "categories": [
    {
      "id": "graphics",
      "title": "Graphics",
      "description": "Visual redux packs.",
      "image": "",
      "mods": [
        {
          "id": "light-redux",
          "name": "Light Redux",
          "version": "1.0.0",
          "description": "Light pack.",
          "size": "1.2 GB",
          "image": "",
          "downloadUrl": "https://github.com/your-name/redux-data/releases/download/v1/light-redux.zip"
        }
      ]
    }
  ]
}
```

Backward compatibility is kept. The app still accepts:

```json
[
  {
    "id": "light-redux",
    "name": "Light Redux",
    "version": "1.0.0",
    "description": "Old flat format.",
    "size": "1.2 GB",
    "downloadUrl": "https://github.com/your-name/redux-data/releases/download/v1/light-redux.zip"
  }
]
```

## Mod zip rule

The zip must contain files relative to the GTA V root.

Good:

```txt
update/update.rpf
x64/audio/sfx/...
mods/update/...
```

Bad:

```txt
MyModFolder/update/update.rpf
```

The installer can handle one wrapper folder, but the cleaner format is better.

## App update

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. Build:

```powershell
npm.cmd run tauri:build
```

3. Upload the generated installer and updater signature files to a GitHub Release.
4. Generate `latest.json`:

```powershell
npm.cmd run release:manifest -- --version 0.1.50 --url "https://github.com/hsoltanov2007-code/majestic-redux-manager/releases/download/v0.1.50/Hardy%20MODS_0.1.50_x64-setup.exe" --signature "PASTE_SIGNATURE"
```

5. Upload `latest.json` to the same release.

The app updater checks:

```txt
https://github.com/hsoltanov2007-code/majestic-redux-manager/releases/latest/download/latest.json
```
