import { invoke } from "@tauri-apps/api/core";
import type { Redux } from "./mockData";

export async function detectGta(): Promise<string> {
  return await invoke("detect_gta");
}

export async function loadReduxList(jsonUrl: string): Promise<Redux[]> {
  return await invoke("load_redux_list", { jsonUrl });
}

export async function installRedux(
  reduxId: string,
  downloadUrl: string,
  gtaPath: string,
): Promise<string> {
  return await invoke("install_redux", {
    reduxId,
    downloadUrl,
    gtaPath,
  });
}

export async function restoreBackup(reduxId: string, gtaPath: string): Promise<string> {
  return await invoke("restore_backup", {
    reduxId,
    gtaPath,
  });
}
