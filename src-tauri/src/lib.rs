use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{copy, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::UNIX_EPOCH,
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
    #[serde(
        default,
        alias = "download_url",
        alias = "url",
        alias = "zipUrl",
        alias = "zip_url"
    )]
    download_url: String,
    #[serde(default, alias = "rpf_patches")]
    rpf_patches: Option<Vec<RpfPatch>>,
    #[serde(default, alias = "modVariants", alias = "mod_variants")]
    variants: Option<Vec<ModVariant>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModVariant {
    #[serde(default)]
    id: String,
    #[serde(default, alias = "label", alias = "title")]
    name: String,
    #[serde(
        default,
        alias = "download_url",
        alias = "url",
        alias = "zipUrl",
        alias = "zip_url"
    )]
    download_url: String,
    #[serde(default, alias = "rpf_patches")]
    rpf_patches: Option<Vec<RpfPatch>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RpfPatch {
    file: String,
    #[serde(alias = "internal_path")]
    internal_path: String,
    #[serde(alias = "rpf_path")]
    rpf_path: String,
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
struct InstalledFileFingerprint {
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    modified: u64,
}

#[derive(Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct InstalledMod {
    version: String,
    files: Vec<String>,
    #[serde(default)]
    fingerprints: Vec<InstalledFileFingerprint>,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RpfArchiveEntry {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
    attributes: String,
    keywords: String,
    raw: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppRuntimeInfo {
    version: String,
    exe_path: String,
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
        .retain(|_, installed| is_mod_really_installed(&gta_dir, installed));

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
    excluded_files: &HashSet<String>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;

    let mut installed_files = vec![];

    for entry in WalkDir::new(src.as_ref()) {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();

        let relative = source_path
            .strip_prefix(src.as_ref())
            .map_err(|e| e.to_string())?;

        let relative_key = normalize_relative_key(relative);
        let target_path = dst.as_ref().join(relative);

        if source_path.is_dir() {
            fs::create_dir_all(&target_path).map_err(|e| e.to_string())?;
        } else {
            if excluded_files.contains(&relative_key) {
                continue;
            }

            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            fs::copy(source_path, &target_path).map_err(|e| e.to_string())?;
            installed_files.push(relative.to_string_lossy().to_string());
        }
    }

    Ok(installed_files)
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    focus_main_window(&app);
}

fn normalize_relative_key(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
        .replace('\\', "/")
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

fn has_install_markers(path: &Path) -> bool {
    ["mods", "update", "x64", "reshade-shaders"]
        .iter()
        .any(|marker| path.join(marker).exists())
}

fn patch_source_path(
    extract_path: &Path,
    install_root: &Path,
    patch_file: &str,
) -> Result<PathBuf, String> {
    let from_extract = safe_join(extract_path, patch_file)?;

    if from_extract.exists() {
        return Ok(from_extract);
    }

    let from_install_root = safe_join(install_root, patch_file)?;

    if from_install_root.exists() {
        return Ok(from_install_root);
    }

    Err(format!(
        "RPF patch source file not found in zip: {}",
        patch_file
    ))
}

fn excluded_patch_files(install_root: &Path, patch_sources: &[PathBuf]) -> HashSet<String> {
    patch_sources
        .iter()
        .filter_map(|path| path.strip_prefix(install_root).ok())
        .map(normalize_relative_key)
        .collect()
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

fn validate_relative_text_path(path: &str, label: &str) -> Result<(), String> {
    let clean = path.trim();

    if clean.is_empty() {
        return Err(format!("{} is empty", label));
    }

    let normalized = clean.replace('\\', "/");

    if normalized.starts_with('/') || normalized.contains("../") || normalized == ".." {
        return Err(format!("Unsafe {}: {}", label, path));
    }

    Ok(())
}

fn backup_one_file(source: &Path, gta_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    let relative = source.strip_prefix(gta_dir).map_err(|e| e.to_string())?;
    let backup_file = backup_dir.join(relative);

    if backup_file.exists() {
        return Ok(());
    }

    if let Some(parent) = backup_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::copy(source, backup_file).map_err(|e| e.to_string())?;

    Ok(())
}

fn restore_installed_mod(
    gta_dir: &Path,
    backup_dir: &Path,
    installed: &InstalledMod,
) -> Result<(), String> {
    for file in &installed.files {
        let installed_file = safe_join(gta_dir, file)?;

        if installed_file.is_dir() {
            fs::remove_dir_all(installed_file).ok();
        } else if installed_file.exists() {
            fs::remove_file(installed_file).ok();
        }
    }

    if backup_dir.exists() {
        copy_dir_all(backup_dir, gta_dir)?;
    }

    Ok(())
}

fn resolve_rpf_path(gta_dir: &Path, rpf_path: &str) -> Result<(PathBuf, String), String> {
    let direct = safe_join(gta_dir, rpf_path)?;

    if direct.exists() {
        return Ok((direct, rpf_path.replace('\\', "/")));
    }

    let normalized = rpf_path.replace('\\', "/");

    if !normalized.starts_with("mods/") {
        let with_mods = format!("mods/{}", normalized);
        let candidate = safe_join(gta_dir, &with_mods)?;

        if candidate.exists() {
            return Ok((candidate, with_mods));
        }
    }

    Err(format!("RPF file not found: {}", rpf_path))
}

fn split_rpf_patch_path(patch: &RpfPatch) -> RpfPatch {
    let normalized = patch.rpf_path.replace('\\', "/");

    if let Some(index) = normalized.to_lowercase().find(".rpf/") {
        let split_at = index + ".rpf".len();
        let rpf_path = normalized[..split_at].to_string();
        let internal_tail = normalized[split_at + 1..].to_string();

        return RpfPatch {
            file: patch.file.clone(),
            internal_path: if patch.internal_path.trim().is_empty() {
                internal_tail
            } else {
                patch.internal_path.clone()
            },
            rpf_path,
        };
    }

    patch.clone()
}

fn apply_rpf_patches(
    explorer_exe: &Path,
    extract_path: &Path,
    install_root: &Path,
    gta_dir: &Path,
    backup_dir: &Path,
    patches: &[RpfPatch],
) -> Result<Vec<String>, String> {
    let mut patched_rpfs = vec![];
    let mut seen_rpfs = HashSet::new();

    for patch in patches {
        let patch = split_rpf_patch_path(patch);
        validate_relative_text_path(&patch.rpf_path, "rpfPath")?;
        validate_relative_text_path(&patch.file, "file")?;

        let (rpf_path, installed_rpf_path) = resolve_rpf_path(gta_dir, &patch.rpf_path)?;
        let source_path = patch_source_path(extract_path, install_root, &patch.file)?;
        let internal_path =
            resolve_rpf_internal_path(explorer_exe, &rpf_path, &patch.internal_path, &source_path)?;

        backup_one_file(&rpf_path, gta_dir, backup_dir)?;

        let output = Command::new(explorer_exe)
            .arg("replace")
            .arg(&rpf_path)
            .arg(&internal_path)
            .arg(&source_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        if seen_rpfs.insert(installed_rpf_path.clone()) {
            patched_rpfs.push(installed_rpf_path);
        }
    }

    Ok(patched_rpfs)
}

fn files_exist(gta_path: &Path, files: &[String]) -> bool {
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

fn metadata_modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn fingerprint_installed_file(
    gta_path: &Path,
    relative_path: &str,
) -> Result<InstalledFileFingerprint, String> {
    let path = safe_join(gta_path, relative_path)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;

    Ok(InstalledFileFingerprint {
        path: relative_path.replace('\\', "/"),
        size: metadata.len(),
        modified: metadata_modified_ms(&metadata),
    })
}

fn build_file_fingerprints(
    gta_path: &Path,
    files: &[String],
) -> Result<Vec<InstalledFileFingerprint>, String> {
    files
        .iter()
        .map(|file| fingerprint_installed_file(gta_path, file))
        .collect()
}

fn fingerprint_matches(gta_path: &Path, fingerprint: &InstalledFileFingerprint) -> bool {
    let path = match safe_join(gta_path, &fingerprint.path) {
        Ok(path) => path,
        Err(_) => return false,
    };

    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };

    metadata.len() == fingerprint.size && metadata_modified_ms(&metadata) == fingerprint.modified
}

fn is_rpf_manifest(files: &[String]) -> bool {
    files
        .iter()
        .any(|file| file.to_lowercase().ends_with(".rpf"))
}

fn is_mod_really_installed(gta_path: &Path, installed: &InstalledMod) -> bool {
    if !installed.fingerprints.is_empty() {
        return installed
            .fingerprints
            .iter()
            .all(|fingerprint| fingerprint_matches(gta_path, fingerprint));
    }

    if is_rpf_manifest(&installed.files) {
        return false;
    }

    files_exist(gta_path, &installed.files)
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
    rpf_patches: Vec<RpfPatch>,
    explorer_exe: PathBuf,
) -> Result<AppState, String> {
    let gta_dir = validate_gta_path(&gta_path)?;

    let root = app_root()?;
    let temp_dir = root.join("temp");
    let backup_dir = root.join("backups").join(&redux_id);
    let mut state = load_state_file();

    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    if let Some(previous) = state.installed_redux.remove(&redux_id) {
        restore_installed_mod(&gta_dir, &backup_dir, &previous)?;
        save_state_file(&state)?;
    }

    let extract_path = temp_dir.join(&redux_id);

    if extract_path.exists() {
        fs::remove_dir_all(&extract_path).ok();
    }

    fs::create_dir_all(&extract_path).map_err(|e| e.to_string())?;

    let zip_file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| e.to_string())?;

    archive.extract(&extract_path).map_err(|e| e.to_string())?;

    let install_root = find_real_install_root(&extract_path);
    let patch_sources = rpf_patches
        .iter()
        .map(|patch| patch_source_path(&extract_path, &install_root, &patch.file))
        .collect::<Result<Vec<_>, _>>()?;
    let excluded_files = excluded_patch_files(&install_root, &patch_sources);

    let mut installed_files = vec![];

    if rpf_patches.is_empty() || has_install_markers(&install_root) {
        backup_existing_files(&install_root, &gta_dir, &backup_dir)?;
        installed_files = copy_dir_all_with_manifest(&install_root, &gta_dir, &excluded_files)?;
    }

    let patched_rpfs = apply_rpf_patches(
        &explorer_exe,
        &extract_path,
        &install_root,
        &gta_dir,
        &backup_dir,
        &rpf_patches,
    )?;

    for rpf_path in patched_rpfs {
        if !installed_files.contains(&rpf_path) {
            installed_files.push(rpf_path);
        }
    }

    if installed_files.is_empty() && rpf_patches.is_empty() {
        return Err("Файлы не установились".to_string());
    }

    if !files_exist(&gta_dir, &installed_files) {
        return Err("Установка не завершилась".to_string());
    }

    let fingerprints = build_file_fingerprints(&gta_dir, &installed_files)?;

    state.gta_path = gta_dir.to_string_lossy().to_string();

    state.installed_redux.insert(
        redux_id,
        InstalledMod {
            version: redux_version,
            files: installed_files,
            fingerprints,
        },
    );

    state = reconcile_installed_state(state);

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
    rpf_patches: Vec<RpfPatch>,
) -> Result<AppState, String> {
    emit_progress(&app, 5, "Preparing");

    if is_gta_running()? {
        return Err("Закрой GTA V перед установкой".to_string());
    }

    validate_gta_path(&gta_path)?;

    let root = app_root()?;
    let downloads_dir = root.join("downloads");

    fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;

    let zip_path = downloads_dir.join(format!("{}.zip", redux_id));

    emit_progress(&app, 10, "Downloading");

    download_file_stream(&app, &download_url, &zip_path).await?;

    emit_progress(&app, 75, "Installing");

    let explorer_exe = rpf_explorer_exe(&app)?;

    let state = tauri::async_runtime::spawn_blocking(move || {
        install_zip_blocking(
            redux_id,
            redux_version,
            gta_path,
            zip_path,
            rpf_patches,
            explorer_exe,
        )
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
            restore_installed_mod(&gta_dir, &backup_dir, installed)?;
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

fn clean_rpf_entry_path(raw: &str) -> String {
    raw.replace("[FILE]", "")
        .replace("[DIR]", "")
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string()
}

fn rpf_entry_name(path: &str) -> String {
    path.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn parse_rpf_entry(raw: &str) -> Option<RpfArchiveEntry> {
    let has_file_marker = raw.contains("[FILE]");
    let has_dir_marker = raw.contains("[DIR]");

    if !has_file_marker && !has_dir_marker {
        return None;
    }

    let clean = clean_rpf_entry_path(raw);

    if clean.is_empty() {
        return None;
    }

    let is_dir = has_dir_marker || raw.trim_end().ends_with('/');
    let kind = if is_dir { "folder" } else { "file" }.to_string();

    Some(RpfArchiveEntry {
        name: rpf_entry_name(&clean),
        path: clean,
        kind,
        size: None,
        attributes: String::new(),
        keywords: String::new(),
        raw: raw.to_string(),
    })
}

fn clean_rpf_tool_error(stdout: &str, stderr: &str) -> String {
    let combined = format!("{}\n{}", stdout, stderr);
    let lower = combined.to_lowercase();

    if lower.contains("object reference not set") {
        return "Hardy RPF не смог прочитать структуру архива. Попробуй открыть копию из mods/update/update.rpf или нажми разблокировку RPF.".to_string();
    }

    if lower.contains("rpf not found") {
        return "RPF файл не найден или путь не передался в RPF helper.".to_string();
    }

    let details = combined
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.eq_ignore_ascii_case("RPF OPENED"))
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    if details.is_empty() {
        "RPF не удалось прочитать: helper не вернул список файлов.".to_string()
    } else {
        format!("RPF не удалось прочитать: {}", details)
    }
}

fn parse_rpf_list_output(stdout: &str) -> Vec<RpfArchiveEntry> {
    stdout
        .lines()
        .filter_map(parse_rpf_entry)
        .collect::<Vec<_>>()
}

fn powershell_quote_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn list_rpf_entries_blocking(exe: &Path, rpf_path: &Path) -> Result<Vec<RpfArchiveEntry>, String> {
    if !rpf_path.exists() {
        return Err(format!("RPF файл не найден: {}", rpf_path.display()));
    }

    let attempts = [
        ("папка helper", exe.parent()),
        ("обычный запуск", None),
        ("папка архива", rpf_path.parent()),
    ];
    let mut errors = vec![];

    for (label, current_dir) in attempts {
        let mut command = Command::new(exe);
        command.arg("list").arg(rpf_path);

        if let Some(dir) = current_dir {
            command.current_dir(dir);
        }

        let output = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let entries = parse_rpf_list_output(&stdout);

        if !entries.is_empty() {
            return Ok(entries);
        }

        errors.push(format!(
            "{}: {} код {}",
            label,
            clean_rpf_tool_error(&stdout, &stderr),
            output.status.code().unwrap_or(-1)
        ));
    }

    let cmd_line = format!(
        "\"{}\" list \"{}\"",
        exe.to_string_lossy(),
        rpf_path.to_string_lossy()
    );
    let cmd_output = Command::new("cmd.exe")
        .arg("/C")
        .arg(&cmd_line)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    let cmd_stdout = String::from_utf8_lossy(&cmd_output.stdout);
    let cmd_stderr = String::from_utf8_lossy(&cmd_output.stderr);
    let cmd_entries = parse_rpf_list_output(&cmd_stdout);

    if !cmd_entries.is_empty() {
        return Ok(cmd_entries);
    }

    errors.push(format!(
        "cmd.exe: {} код {}",
        clean_rpf_tool_error(&cmd_stdout, &cmd_stderr),
        cmd_output.status.code().unwrap_or(-1)
    ));

    let ps_command = format!(
        "& {} list {}",
        powershell_quote_path(exe),
        powershell_quote_path(rpf_path)
    );
    let ps_output = Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(&ps_command)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    let ps_stdout = String::from_utf8_lossy(&ps_output.stdout);
    let ps_stderr = String::from_utf8_lossy(&ps_output.stderr);
    let ps_entries = parse_rpf_list_output(&ps_stdout);

    if !ps_entries.is_empty() {
        return Ok(ps_entries);
    }

    errors.push(format!(
        "powershell.exe: {} код {}",
        clean_rpf_tool_error(&ps_stdout, &ps_stderr),
        ps_output.status.code().unwrap_or(-1)
    ));

    Err(format!(
        "RPF helper не вернул список файлов для {}. {}",
        rpf_path.display(),
        errors.join(" | ")
    ))
}

#[tauri::command]
fn resolve_default_update_rpf(app: tauri::AppHandle, gta_path: String) -> Result<String, String> {
    let gta_dir = validate_gta_path(&gta_path)?;
    let exe = rpf_explorer_exe(&app)?;
    let candidates = [
        gta_dir.join("mods").join("update").join("update.rpf"),
        gta_dir.join("update").join("update.rpf"),
    ];
    let mut existing = vec![];
    let mut errors = vec![];

    for candidate in candidates {
        if candidate.exists() {
            existing.push(candidate);
        }
    }

    if existing.is_empty() {
        return Err(
            "update.rpf не найден в GTA V. Проверь путь к GTA или выбери RPF вручную.".to_string(),
        );
    }

    for candidate in existing {
        match list_rpf_entries_blocking(&exe, &candidate) {
            Ok(entries) if !entries.is_empty() => {
                return Ok(candidate.to_string_lossy().to_string());
            }
            Ok(_) => errors.push(format!("{}: список файлов пустой", candidate.display())),
            Err(err) => errors.push(format!("{}: {}", candidate.display(), err)),
        }
    }

    Err(format!(
        "Ни один update.rpf не прочитался автоматически. {}",
        errors.join(" | ")
    ))
}

#[tauri::command]
fn app_runtime_info(app: tauri::AppHandle) -> Result<AppRuntimeInfo, String> {
    let exe_path = std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(AppRuntimeInfo {
        version: app.package_info().version.to_string(),
        exe_path,
    })
}

fn resolve_rpf_internal_path(
    explorer_exe: &Path,
    rpf_path: &Path,
    requested_path: &str,
    source_file: &Path,
) -> Result<String, String> {
    let requested = requested_path.trim().replace('\\', "/");

    if !requested.is_empty() {
        validate_relative_text_path(&requested, "internalPath")?;
        return Ok(requested);
    }

    let target_name = source_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Не удалось получить имя файла для автопоиска внутри RPF")?
        .to_lowercase();

    let mut matches = list_rpf_entries_blocking(explorer_exe, rpf_path)?
        .into_iter()
        .filter(|entry| entry.kind == "file" && entry.name.to_lowercase() == target_name)
        .map(|entry| entry.path)
        .collect::<Vec<_>>();

    matches.sort();
    matches.dedup();

    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!(
            "В RPF не найден файл {}. Укажи путь внутри архива вручную.",
            target_name
        )),
        _ => Err(format!(
            "В RPF найдено несколько файлов {}: {}. Укажи точный путь внутри архива.",
            target_name,
            matches
                .iter()
                .take(6)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

#[tauri::command]
async fn list_rpf_file(
    app: tauri::AppHandle,
    rpf_path: String,
) -> Result<Vec<RpfArchiveEntry>, String> {
    let exe = rpf_explorer_exe(&app)?;

    let output =
        tauri::async_runtime::spawn_blocking(move || -> Result<Vec<RpfArchiveEntry>, String> {
            list_rpf_entries_blocking(&exe, &PathBuf::from(rpf_path))
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
        let rpf_file = PathBuf::from(&rpf_path);
        let new_file = PathBuf::from(&new_file_path);
        let resolved_internal_path =
            resolve_rpf_internal_path(&exe, &rpf_file, &internal_path, &new_file)?;

        let output = Command::new(exe)
            .arg("replace")
            .arg(rpf_file)
            .arg(&resolved_internal_path)
            .arg(new_file)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        Ok(if stdout.trim().is_empty() {
            format!("Файл заменён: {}", resolved_internal_path)
        } else {
            stdout
        })
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
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
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
            app_runtime_info,
            resolve_default_update_rpf,
            install_redux,
            restore_backup,
            unlock_rpf_file,
            list_rpf_file,
            extract_rpf_file,
            replace_rpf_file,
            download_and_run_update,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
