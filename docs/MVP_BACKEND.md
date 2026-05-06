# Majestic Redux Manager MVP backend

Frontend is ready as a Lovable/Vite UI. The next step is wrapping it with Tauri and adding native commands.

## Required Tauri commands

1. `detect_gta()`
- Check common GTA V paths.
- Check Windows Registry for Rockstar, Steam and Epic installs.
- Return the detected folder or null.

2. `install_redux(redux, gta_path)`
- Download zip from `downloadUrl`.
- Extract to temp folder.
- Create backup for files that will be replaced.
- Copy extracted files into GTA V folder.
- Save installed version to local app data.

3. `restore_backup(backup_id)`
- Restore previously backed up files.
- Mark redux as not installed or restored.

4. `check_app_update()`
- Use Tauri updater with GitHub Releases.

## Local files

Suggested app data folder:

```txt
%APPDATA%/MajesticReduxManager/
```

Files:

```txt
settings.json
installed.json
backups/
temp/
```

`installed.json` example:

```json
{
  "installedRedux": {
    "id": "majestic-redux",
    "version": "1.1.0"
  }
}
```

## Redux zip rule

Each redux zip should contain files relative to GTA V root.

Example:

```txt
redux.zip
  update/update.rpf
  x64/audio/sfx/...
  mods/update/...
```

The installer should copy these paths directly into the selected GTA V folder after backup.
