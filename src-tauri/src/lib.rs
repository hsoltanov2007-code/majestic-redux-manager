use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor},
    path::{Path, PathBuf},
    process::Command,
};

use walkdir::WalkDir;
use zip::ZipArchive;

#[derive(Serialize, Deserialize)]
struct ReduxItem {
    id: String,
    name: String,
    version: String,
    description: String,
    size: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
}

#[tauri::command]
fn detect_gta() -> Result<String, String> {
    let possible_paths = vec![
        r"C:\Program Files\Rockstar Games\Grand Theft Auto V",
        r"C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V",
        r"D:\SteamLibrary\steamapps\common\Grand Theft Auto V",
        r"E:\SteamLibrary\steamapps\common\Grand Theft Auto V",
    ];

    for path in possible_paths {
        let gta_exe = Path::new(path).join("GTA5.exe");

        if gta_exe.exists() {
            return Ok(path.to_string());
        }
    }

    Err("GTA V не найдена".into())
}

#[tauri::command]
fn is_gta_running() -> Result<bool, String> {
    let output = Command::new("tasklist")
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();

    Ok(
        text.contains("gta5.exe")
            || text.contains("playgtav.exe")
            || text.contains("ragemp_v.exe"),
    )
}

#[tauri::command]
fn load_redux_list(json_url: String) -> Result<Vec<ReduxItem>, String> {
    let response = reqwest::blocking::get(&json_url)
        .map_err(|e| e.to_string())?;

    let text = response.text().map_err(|e| e.to_string())?;

    let items: Vec<ReduxItem> =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;

    Ok(items)
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> Result<(), String> {
    fs::create_dir_all(&dst).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;

        if ty.is_dir() {
            copy_dir_all(
                entry.path(),
                dst.as_ref().join(entry.file_name()),
            )?;
        } else {
            fs::copy(
                entry.path(),
                dst.as_ref().join(entry.file_name()),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn install_redux(
    redux_id: String,
    download_url: String,
    gta_path: String,
) -> Result<String, String> {
    let output = Command::new("tasklist")
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();

    if text.contains("gta5.exe")
        || text.contains("playgtav.exe")
        || text.contains("ragemp_v.exe")
    {
        return Err(
            "GTA V сейчас запущена. Закрой игру перед установкой."
                .into(),
        );
    }

    let appdata = dirs::data_dir()
        .ok_or("Не удалось найти AppData")?;

    let root = appdata.join("HardyMODS");

    let downloads_dir = root.join("downloads");
    let backups_dir = root.join("backups");
    let temp_dir = root.join("temp");

    fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let zip_path = downloads_dir.join(format!("{}.zip", redux_id));

    let response =
        reqwest::blocking::get(&download_url).map_err(|e| e.to_string())?;

    let bytes = response.bytes().map_err(|e| e.to_string())?;

    fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

    let extract_path = temp_dir.join(&redux_id);

    if extract_path.exists() {
        fs::remove_dir_all(&extract_path).ok();
    }

    fs::create_dir_all(&extract_path).map_err(|e| e.to_string())?;

    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| e.to_string())?;

    archive
        .extract(&extract_path)
        .map_err(|e| e.to_string())?;

    let backup_path = backups_dir.join(&redux_id);

    if backup_path.exists() {
        fs::remove_dir_all(&backup_path).ok();
    }

    fs::create_dir_all(&backup_path).map_err(|e| e.to_string())?;

    for entry in WalkDir::new(&extract_path) {
        let entry = entry.map_err(|e| e.to_string())?;

        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(&extract_path)
                .map_err(|e| e.to_string())?;

            let gta_file = PathBuf::from(&gta_path).join(relative);

            if gta_file.exists() {
                let backup_file = backup_path.join(relative);

                if let Some(parent) = backup_file.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| e.to_string())?;
                }

                fs::copy(&gta_file, &backup_file)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    copy_dir_all(&extract_path, &gta_path)?;

    Ok("Redux успешно установлен".into())
}

#[tauri::command]
fn restore_backup(
    redux_id: String,
    gta_path: String,
) -> Result<String, String> {
    let appdata = dirs::data_dir()
        .ok_or("Не удалось найти AppData")?;

    let backup_path = appdata
        .join("HardyMODS")
        .join("backups")
        .join(&redux_id);

    if !backup_path.exists() {
        return Err("Backup не найден".into());
    }

    copy_dir_all(&backup_path, &gta_path)?;

    Ok("Backup успешно восстановлен".into())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            detect_gta,
            is_gta_running,
            load_redux_list,
            install_redux,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}