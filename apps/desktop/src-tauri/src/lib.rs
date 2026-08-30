#[tauri::command]
fn initial_project_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|argument| argument.to_lowercase().ends_with(".kond"))
}

#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| format!("No se pudo escribir {path}: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![initial_project_path, write_project_file])
        .run(tauri::generate_context!())
        .expect("error while running Kond Design");
}
