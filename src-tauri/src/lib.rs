use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{copy, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use walkdir::WalkDir;
use zip::ZipArchive;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModItem {
    id: String,
    name: String,
    version: String,
    description: String,
    size: String,
    image: Option<String>,
    download_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct Category {
    id: String,
    title: String,
    description: String,
    image: Option<String>,
    mods: Vec<ModItem>,
}

#[derive(Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct InstalledMod {
    version: String,
    files: Vec<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AppState {
    gta_path: String,
    system_path: String,
    installed_redux: HashMap<String, InstalledMod>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    progress: u64,
    step: String,
}

fn emit_progress(app: &tauri::AppHandle, progress: u64, step: &str) {
    let _ = app.emit(
        "install-progress",
        ProgressPayload {
            progress,
            step: step.to_string(),
        },
    );
}

fn default_app_root() -> Result<PathBuf, String> {
    let root = dirs::data_dir()
        .ok_or("Не удалось найти AppData")?
        .join("HardyMODS");

    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    Ok(root)
}

fn default_state_path() -> Result<PathBuf, String> {
    Ok(default_app_root()?.join("state.json"))
}

fn load_state_file() -> AppState {
    let default_path = match default_state_path() {
        Ok(path) => path,
        Err(_) => return AppState::default(),
    };

    if !default_path.exists() {
        return AppState::default();
    }

    let text = fs::read_to_string(&default_path).unwrap_or_default();
    let default_state: AppState = serde_json::from_str(&text).unwrap_or_default();

    if default_state.system_path.trim().is_empty() {
        return default_state;
    }

    let custom_state_path = PathBuf::from(&default_state.system_path).join("state.json");

    if custom_state_path.exists() {
        if let Ok(custom_text) = fs::read_to_string(&custom_state_path) {
            if let Ok(custom_state) = serde_json::from_str::<AppState>(&custom_text) {
                return custom_state;
            }
        }
    }

    default_state
}

fn app_root() -> Result<PathBuf, String> {
    let state = load_state_file();

    if !state.system_path.trim().is_empty() {
        let custom = PathBuf::from(&state.system_path);
        fs::create_dir_all(&custom).map_err(|e| e.to_string())?;
        return Ok(custom);
    }

    default_app_root()
}

fn state_path() -> Result<PathBuf, String> {
    Ok(app_root()?.join("state.json"))
}

fn save_state_file(state: &AppState) -> Result<(), String> {
    let default_path = default_state_path()?;

    if let Some(parent) = default_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&default_path, &text).map_err(|e| e.to_string())?;

    if !state.system_path.trim().is_empty() {
        let custom_root = PathBuf::from(&state.system_path);
        fs::create_dir_all(&custom_root).map_err(|e| e.to_string())?;

        let custom_state_path = custom_root.join("state.json");
        fs::write(custom_state_path, text).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn validate_gta_path(gta_path: &str) -> Result<PathBuf, String> {
    let clean_path = gta_path.trim();

    if clean_path.is_empty() {
        return Err("Укажи папку GTA V".to_string());
    }

    let gta_dir = PathBuf::from(clean_path);

    if !gta_dir.join("GTA5.exe").exists() {
        return Err("Неверная папка GTA V: GTA5.exe не найден".to_string());
    }

    Ok(gta_dir)
}

fn validate_system_path(system_path: &str) -> Result<PathBuf, String> {
    let clean_path = system_path.trim();

    if clean_path.is_empty() {
        return Err("Укажи папку для system files".to_string());
    }

    Ok(PathBuf::from(clean_path))
}

fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);

    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(format!("Небезопасный путь в manifest: {}", relative));
    }

    Ok(base.join(relative_path))
}

fn parse_catalog(text: &str) -> Result<Vec<Category>, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;

    if let Ok(categories) = serde_json::from_value::<Vec<Category>>(value.clone()) {
        return Ok(categories);
    }

    if let Some(categories) = value.get("categories") {
        return serde_json::from_value::<Vec<Category>>(categories.clone())
            .map_err(|e| e.to_string());
    }

    if let Some(mods) = value.get("mods") {
        let mods =
            serde_json::from_value::<Vec<ModItem>>(mods.clone()).map_err(|e| e.to_string())?;

        return Ok(vec![Category {
            id: "redux".to_string(),
            title: "Redux Mods".to_string(),
            description: "Available redux packages".to_string(),
            image: None,
            mods,
        }]);
    }

    let mods = serde_json::from_value::<Vec<ModItem>>(value).map_err(|e| e.to_string())?;

    Ok(vec![Category {
        id: "redux".to_string(),
        title: "Redux Mods".to_string(),
        description: "Available redux packages".to_string(),
        image: None,
        mods,
    }])
}

fn reconcile_installed_state(mut state: AppState) -> AppState {
    if state.gta_path.trim().is_empty() {
        return state;
    }

    let gta_dir = PathBuf::from(&state.gta_path);

    if !gta_dir.join("GTA5.exe").exists() {
        return state;
    }

    state
        .installed_redux
        .retain(|_, installed| is_mod_really_installed(&gta_dir, &installed.files));

    state
}

#[tauri::command]
fn load_app_state() -> Result<AppState, String> {
    let state = load_state_file();
    let reconciled = reconcile_installed_state(state.clone());

    if reconciled != state {
        save_state_file(&reconciled)?;
    }

    Ok(reconciled)
}

#[tauri::command]
fn save_gta_path(gta_path: String) -> Result<AppState, String> {
    let gta_dir = validate_gta_path(&gta_path)?;
    let mut state = load_state_file();

    state.gta_path = gta_dir.to_string_lossy().to_string();

    save_state_file(&state)?;

    Ok(state)
}

#[tauri::command]
fn save_system_path(system_path: String) -> Result<AppState, String> {
    let system_dir = validate_system_path(&system_path)?;
    fs::create_dir_all(&system_dir).map_err(|e| e.to_string())?;

    let mut state = load_state_file();
    state.system_path = system_dir.to_string_lossy().to_string();

    save_state_file(&state)?;

    Ok(state)
}

#[tauri::command]
fn detect_gta() -> Result<String, String> {
    let possible_paths = vec![
        r"C:\Program Files\Rockstar Games\Grand Theft Auto V",
        r"C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V",
        r"C:\Program Files\Steam\steamapps\common\Grand Theft Auto V",
        r"C:\Program Files\Epic Games\GTAV",
        r"C:\Program Files (x86)\Epic Games\GTAV",
        r"D:\SteamLibrary\steamapps\common\Grand Theft Auto V",
        r"E:\SteamLibrary\steamapps\common\Grand Theft Auto V",
    ];

    for path in possible_paths {
        if Path::new(path).join("GTA5.exe").exists() {
            let mut state = load_state_file();
            state.gta_path = path.to_string();

            save_state_file(&state)?;

            return Ok(path.to_string());
        }
    }

    Err("GTA V не найдена".to_string())
}

#[tauri::command]
fn is_gta_running() -> Result<bool, String> {
    let output = Command::new("tasklist")
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();

    Ok(text.contains("gta5.exe") || text.contains("playgtav.exe") || text.contains("ragemp_v.exe"))
}

#[tauri::command]
async fn load_redux_list(json_url: String) -> Result<Vec<Category>, String> {
    let response = reqwest::get(&json_url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка загрузки списка: {}", response.status()));
    }

    let text = response.text().await.map_err(|e| e.to_string())?;

    parse_catalog(&text)
}

fn copy_dir_all_with_manifest(
    src: impl AsRef<Path>,
    dst: impl AsRef<Path>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;

    let mut installed_files = vec![];

    for entry in WalkDir::new(src.as_ref()) {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();

        let relative = source_path
            .strip_prefix(src.as_ref())
            .map_err(|e| e.to_string())?;

        let target_path = dst.as_ref().join(relative);

        if source_path.is_dir() {
            fs::create_dir_all(&target_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            fs::copy(source_path, &target_path).map_err(|e| e.to_string())?;
            installed_files.push(relative.to_string_lossy().to_string());
        }
    }

    Ok(installed_files)
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> Result<(), String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;

    for entry in WalkDir::new(src.as_ref()) {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();

        let relative = source_path
            .strip_prefix(src.as_ref())
            .map_err(|e| e.to_string())?;

        let target_path = dst.as_ref().join(relative);

        if source_path.is_dir() {
            fs::create_dir_all(&target_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            fs::copy(source_path, target_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn find_real_install_root(extract_path: &Path) -> PathBuf {
    let direct_markers = vec!["mods", "update", "x64", "reshade-shaders"];

    for marker in &direct_markers {
        if extract_path.join(marker).exists() {
            return extract_path.to_path_buf();
        }
    }

    let mut dirs = vec![];

    if let Ok(entries) = fs::read_dir(extract_path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                dirs.push(entry.path());
            }
        }
    }

    if dirs.len() == 1 {
        let only = dirs[0].clone();

        for marker in &direct_markers {
            if only.join(marker).exists() {
                return only;
            }
        }

        return only;
    }

    extract_path.to_path_buf()
}

fn backup_existing_files(
    install_root: &Path,
    gta_dir: &Path,
    backup_dir: &Path,
) -> Result<(), String> {
    if backup_dir.exists() {
        fs::remove_dir_all(backup_dir).ok();
    }

    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;

    for entry in WalkDir::new(install_root) {
        let entry = entry.map_err(|e| e.to_string())?;

        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(install_root)
                .map_err(|e| e.to_string())?;

            let gta_file = gta_dir.join(relative);

            if gta_file.exists() {
                let backup_file = backup_dir.join(relative);

                if let Some(parent) = backup_file.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }

                fs::copy(&gta_file, backup_file).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

fn is_mod_really_installed(gta_path: &Path, files: &[String]) -> bool {
    if files.is_empty() {
        return false;
    }

    for file in files {
        let path = match safe_join(gta_path, file) {
            Ok(path) => path,
            Err(_) => return false,
        };

        if !path.exists() {
            return false;
        }
    }

    true
}

async fn download_file_stream(
    app: &tauri::AppHandle,
    url: &str,
    zip_path: &Path,
) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(url).map_err(|e| e.to_string())?;

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Download URL должен быть http/https".to_string());
    }

    let response = reqwest::get(parsed_url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка скачивания: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(zip_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;

        file.write_all(&chunk).await.map_err(|e| e.to_string())?;

        downloaded += chunk.len() as u64;

        if total > 0 {
            let progress = ((downloaded as f64 / total as f64) * 100.0) as u64;

            emit_progress(app, progress.min(100), "Downloading");
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;

    Ok(())
}

fn install_zip_blocking(
    redux_id: String,
    redux_version: String,
    gta_path: String,
    zip_path: PathBuf,
) -> Result<AppState, String> {
    let gta_dir = validate_gta_path(&gta_path)?;

    let root = app_root()?;
    let temp_dir = root.join("temp");
    let backup_dir = root.join("backups").join(&redux_id);

    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let extract_path = temp_dir.join(&redux_id);

    if extract_path.exists() {
        fs::remove_dir_all(&extract_path).ok();
    }

    fs::create_dir_all(&extract_path).map_err(|e| e.to_string())?;

    let zip_file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| e.to_string())?;

    archive.extract(&extract_path).map_err(|e| e.to_string())?;

    let install_root = find_real_install_root(&extract_path);

    backup_existing_files(&install_root, &gta_dir, &backup_dir)?;

    let installed_files = copy_dir_all_with_manifest(&install_root, &gta_dir)?;

    if installed_files.is_empty() {
        return Err("Файлы не установились".to_string());
    }

    if !is_mod_really_installed(&gta_dir, &installed_files) {
        return Err("Установка не завершилась".to_string());
    }

    let mut state = load_state_file();

    state.gta_path = gta_dir.to_string_lossy().to_string();

    state.installed_redux.insert(
        redux_id,
        InstalledMod {
            version: redux_version,
            files: installed_files,
        },
    );

    save_state_file(&state)?;

    let _ = fs::remove_dir_all(&extract_path);
    let _ = fs::remove_file(&zip_path);

    Ok(state)
}

#[tauri::command]
async fn install_redux(
    app: tauri::AppHandle,
    redux_id: String,
    redux_version: String,
    download_url: String,
    gta_path: String,
) -> Result<AppState, String> {
    emit_progress(&app, 5, "Preparing");

    if is_gta_running()? {
        return Err("Закрой GTA V перед установкой".to_string());
    }

    let gta_dir = validate_gta_path(&gta_path)?;

    let state = load_state_file();

    if let Some(installed) = state.installed_redux.get(&redux_id) {
        if installed.version == redux_version && is_mod_really_installed(&gta_dir, &installed.files)
        {
            return Err("Этот мод уже установлен".to_string());
        }
    }

    let root = app_root()?;
    let downloads_dir = root.join("downloads");

    fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;

    let zip_path = downloads_dir.join(format!("{}.zip", redux_id));

    emit_progress(&app, 10, "Downloading");

    download_file_stream(&app, &download_url, &zip_path).await?;

    emit_progress(&app, 75, "Installing");

    let state = tauri::async_runtime::spawn_blocking(move || {
        install_zip_blocking(redux_id, redux_version, gta_path, zip_path)
    })
    .await
    .map_err(|e| e.to_string())??;

    emit_progress(&app, 100, "Done");

    Ok(state)
}

#[tauri::command]
async fn restore_backup(redux_id: String, gta_path: String) -> Result<AppState, String> {
    if is_gta_running()? {
        return Err("Закрой GTA V перед восстановлением".to_string());
    }

    let state = tauri::async_runtime::spawn_blocking(move || -> Result<AppState, String> {
        let gta_dir = validate_gta_path(&gta_path)?;

        let root = app_root()?;
        let backup_dir = root.join("backups").join(&redux_id);

        let mut state = load_state_file();

        if let Some(installed) = state.installed_redux.get(&redux_id) {
            for file in &installed.files {
                let installed_file = safe_join(&gta_dir, file)?;

                if installed_file.exists() {
                    fs::remove_file(installed_file).ok();
                }
            }
        }

        if backup_dir.exists() {
            copy_dir_all(&backup_dir, &gta_dir)?;
        }

        state.installed_redux.remove(&redux_id);
        save_state_file(&state)?;

        Ok(state)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(state)
}

#[tauri::command]
async fn unlock_rpf_file(app: tauri::AppHandle, rpf_path: String) -> Result<String, String> {
    let rpf_file = PathBuf::from(&rpf_path);

    if !rpf_file.exists() {
        return Err("RPF файл не найден".to_string());
    }

    let extension = rpf_file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension != "rpf" {
        return Err("Выбери именно .rpf файл".to_string());
    }

    let parent_folder = rpf_file
        .parent()
        .ok_or("Не удалось получить папку RPF")?
        .to_path_buf();

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    let source_unlocker_dir = resource_dir.join("resources").join("rpf-unlocker");

    let runtime_unlocker_dir = app_root()?.join("rpf-unlocker-runtime");

    if runtime_unlocker_dir.exists() {
        fs::remove_dir_all(&runtime_unlocker_dir).ok();
    }

    fs::create_dir_all(&runtime_unlocker_dir).map_err(|e| e.to_string())?;

    copy_dir_all(&source_unlocker_dir, &runtime_unlocker_dir)?;

    let unlocker_exe = runtime_unlocker_dir.join("rpf_unlock_tool.exe");

    let folder_input = parent_folder.to_string_lossy().to_string();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut child = Command::new(&unlocker_exe)
            .current_dir(&runtime_unlocker_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        if let Some(stdin) = child.stdin.as_mut() {
            let input = format!("{}\nexit\n", folder_input);

            stdin
                .write_all(input.as_bytes())
                .map_err(|e| e.to_string())?;
        }

        let output = child.wait_with_output().map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok("RPF файл успешно unlock".to_string())
}

fn rpf_explorer_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    let exe = resource_dir
        .join("resources")
        .join("rpf-explorer")
        .join("HardyRpfExplorer.exe");

    if !exe.exists() {
        return Err(format!("HardyRpfExplorer.exe не найден: {}", exe.display()));
    }

    Ok(exe)
}

#[tauri::command]
async fn list_rpf_file(app: tauri::AppHandle, rpf_path: String) -> Result<Vec<String>, String> {
    let exe = rpf_explorer_exe(&app)?;

    let output = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let output = Command::new(exe)
            .arg("list")
            .arg(rpf_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        let lines = stdout
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<String>>();

        Ok(lines)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(output)
}

#[tauri::command]
async fn extract_rpf_file(
    app: tauri::AppHandle,
    rpf_path: String,
    internal_path: String,
    output_path: String,
) -> Result<String, String> {
    let exe = rpf_explorer_exe(&app)?;

    let output = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let output = Command::new(exe)
            .arg("extract")
            .arg(rpf_path)
            .arg(internal_path)
            .arg(output_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(output)
}

#[tauri::command]
async fn replace_rpf_file(
    app: tauri::AppHandle,
    rpf_path: String,
    internal_path: String,
    new_file_path: String,
) -> Result<String, String> {
    let exe = rpf_explorer_exe(&app)?;

    let output = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let output = Command::new(exe)
            .arg("replace")
            .arg(rpf_path)
            .arg(internal_path)
            .arg(new_file_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(output)
}

#[tauri::command]
async fn download_and_run_update(url: String) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Update URL должен быть http/https".to_string());
    }

    let root = app_root()?;
    let updates_dir = root.join("updates");

    fs::create_dir_all(&updates_dir).map_err(|e| e.to_string())?;

    let installer_path = updates_dir.join(format!(
        "HardyMODS_Update_{}_{}.exe",
        chrono::Utc::now().timestamp_millis(),
        std::process::id()
    ));

    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(parsed_url).send().map_err(|e| e.to_string())?;

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if content_type.contains("text/html") {
        return Err("GitHub вернул HTML вместо EXE".into());
    }

    let mut dest = File::create(&installer_path).map_err(|e| e.to_string())?;

    let content = response.bytes().map_err(|e| e.to_string())?;

    let mut reader = content.as_ref();

    copy(&mut reader, &mut dest).map_err(|e| e.to_string())?;

    drop(dest);

    Command::new(&installer_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    std::process::exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_gta_path,
            save_system_path,
            detect_gta,
            is_gta_running,
            load_redux_list,
            install_redux,
            restore_backup,
            unlock_rpf_file,
            list_rpf_file,
            extract_rpf_file,
            replace_rpf_file,
            download_and_run_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
