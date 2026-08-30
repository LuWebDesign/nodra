#[tauri::command]
fn initial_project_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|argument| argument.to_lowercase().ends_with(".kond"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![initial_project_path])
        .run(tauri::generate_context!())
        .expect("error while running Kond Design");
}
