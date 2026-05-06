use serde::{Deserialize, Serialize};
use std::{
    fs,
    io,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReduxItem {
    id: String,
    name: String,
    version: String,
    description: String,
    size: String,
    download_url: String,
}

#[tauri::command]
fn detect_gta() -> Result<String, String> {
    let paths = vec![
        r"C:\Program Files\Rockstar Games\Grand Theft Auto V",
        r"C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V",
        r"C:\Program Files\Steam\steamapps\common\Grand Theft Auto V",
        r"C:\Program Files\Epic Games\GTAV",
        r"C:\Program Files (x86)\Epic Games\GTAV",
        r"D:\SteamLibrary\steamapps\common\Grand Theft Auto V",
        r"D:\Games\Grand Theft Auto V",
        r"E:\SteamLibrary\steamapps\common\Grand Theft Auto V",
        r"E:\Games\Grand Theft Auto V",
    ];

    for path in paths {
        let gta_exe = Path::new(path).join("GTA5.exe");
        if gta_exe.exists() {
            return Ok(path.to_string());
        }
    }

    Err("GTA V не найдена. Укажи папку вручную.".to_string())
}

#[tauri::command]
fn load_redux_list(json_url: String) -> Result<Vec<ReduxItem>, String> {
    let response = reqwest::blocking::get(&json_url)
        .map_err(|e| format!("Не удалось загрузить redux.json: {}", e))?;

    let items: Vec<ReduxItem> = response
        .json()
        .map_err(|e| format!("Ошибка JSON: {}", e))?;

    Ok(items)
}

#[tauri::command]
fn install_redux(
    redux_id: String,
    download_url: String,
    gta_path: String,
) -> Result<String, String> {
    let gta_dir = Path::new(&gta_path);

    if !gta_dir.exists() {
        return Err("Папка GTA V не существует".to_string());
    }

    if !gta_dir.join("GTA5.exe").exists() {
        return Err("В этой папке не найден GTA5.exe".to_string());
    }

    let app_dir = dirs::data_dir()
        .ok_or("Не удалось найти AppData")?
        .join("MajesticReduxManager");

    let temp_dir = app_dir.join("temp").join(&redux_id);
    let backup_dir = app_dir.join("backups").join(&redux_id);

    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let zip_path = temp_dir.join("redux.zip");

    download_file(&download_url, &zip_path)?;
    unzip_file(&zip_path, &temp_dir)?;

    let content_dir = find_install_root(&temp_dir)?;

    backup_files(&content_dir, gta_dir, &backup_dir)?;
    copy_dir_all(&content_dir, gta_dir)?;

    Ok("Redux установлен успешно".to_string())
}

#[tauri::command]
fn restore_backup(redux_id: String, gta_path: String) -> Result<String, String> {
    let gta_dir = Path::new(&gta_path);

    if !gta_dir.exists() {
        return Err("Папка GTA V не существует".to_string());
    }

    let app_dir = dirs::data_dir()
        .ok_or("Не удалось найти AppData")?
        .join("MajesticReduxManager");

    let backup_dir = app_dir.join("backups").join(&redux_id);

    if !backup_dir.exists() {
        return Err("Backup не найден".to_string());
    }

    copy_dir_all(&backup_dir, gta_dir)?;

    Ok("Backup восстановлен".to_string())
}

fn download_file(url: &str, path: &Path) -> Result<(), String> {
    let mut response = reqwest::blocking::get(url)
        .map_err(|e| format!("Ошибка скачивания: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Сервер вернул ошибку: {}", response.status()));
    }

    let mut file = fs::File::create(path)
        .map_err(|e| format!("Не удалось создать файл: {}", e))?;

    io::copy(&mut response, &mut file)
        .map_err(|e| format!("Ошибка записи zip: {}", e))?;

    Ok(())
}

fn unzip_file(zip_path: &Path, output_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = output_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn find_install_root(temp_dir: &Path) -> Result<PathBuf, String> {
    let possible = vec![
        temp_dir.join("redux"),
        temp_dir.join("Redux"),
        temp_dir.join("files"),
        temp_dir.join("Files"),
        temp_dir.join("install"),
        temp_dir.join("Install"),
    ];

    for path in possible {
        if path.exists() {
            return Ok(path);
        }
    }

    Ok(temp_dir.to_path_buf())
}

fn backup_files(source_dir: &Path, gta_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    for entry in walkdir::WalkDir::new(source_dir) {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();

        if source_path.is_file() {
            let relative = source_path.strip_prefix(source_dir).map_err(|e| e.to_string())?;
            let gta_file = gta_dir.join(relative);

            if gta_file.exists() {
                let backup_file = backup_dir.join(relative);

                if let Some(parent) = backup_file.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }

                fs::copy(&gta_file, &backup_file).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(src).map_err(|e| e.to_string())?;
        let target = dst.join(relative);

        if path.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }

            fs::copy(path, target).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_gta,
            load_redux_list,
            install_redux,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}