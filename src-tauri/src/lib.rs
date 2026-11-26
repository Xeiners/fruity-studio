//! Fruity Studio — noyau natif (Tauri 2).
//!
//! Organisation :
//! - `db` / `repo`      : persistance SQLite (migrations, requetes typees)
//! - `media`            : espace de travail des fichiers (copies, deduplication)
//! - `ffmpeg`           : detection, analyse et assemblage video
//! - `secrets`          : cle API Gemini dans le trousseau Windows
//! - `commands`         : commandes exposees au frontend

mod commands;
mod db;
mod error;
mod ffmpeg;
mod media;
mod models;
mod repo;
mod secrets;
mod settings;
mod state;
mod util;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Une seule instance : la base SQLite et l'espace de travail ne sont pas partages.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = state::AppState::initialize(app.handle())
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Personnages
            commands::characters::characters_list,
            commands::characters::character_get,
            commands::characters::character_create,
            commands::characters::character_update,
            commands::characters::character_set_archived,
            commands::characters::character_delete,
            commands::characters::character_set_status,
            commands::characters::character_generation_save,
            commands::characters::character_generation_update_prompt,
            commands::characters::character_generation_activate,
            commands::characters::character_generation_delete,
            commands::characters::character_set_relationships,
            commands::characters::character_set_cover,
            commands::characters::character_import_images,
            commands::characters::character_image_update,
            commands::characters::character_image_replace,
            commands::characters::character_image_delete,
            commands::characters::character_images_reorder,
            commands::characters::references_export,
            // Productions
            commands::productions::productions_list,
            commands::productions::production_get,
            commands::productions::production_create,
            commands::productions::production_update,
            commands::productions::production_replace_story,
            commands::productions::production_delete,
            commands::productions::clip_update,
            commands::productions::clip_import_video,
            commands::productions::clip_remove_video,
            commands::productions::production_analyze_clips,
            // Rendu
            commands::render::production_render,
            commands::render::render_cancel,
            commands::render::render_status,
            // Mediatheque
            commands::media::media_list,
            commands::media::media_import_audio,
            commands::media::media_delete,
            // Gemini
            commands::gemini::gemini_http,
            commands::gemini::gemini_key_status,
            commands::gemini::gemini_key_set,
            commands::gemini::gemini_key_clear,
            // Systeme
            commands::system::app_info,
            commands::system::dashboard_stats,
            commands::system::settings_get,
            commands::system::settings_update,
            commands::system::ffmpeg_detect,
            commands::tools::ffmpeg_install,
            commands::tools::ffmpeg_install_cancel,
            commands::tools::ffmpeg_install_status,
            commands::tools::ffmpeg_uninstall,
            commands::tools::ffmpeg_self_test,
            // Mes reseaux
            commands::networks::network_show,
            commands::networks::network_set_bounds,
            commands::networks::network_hide_all,
            commands::networks::network_reload,
            commands::networks::network_open_external,
            commands::system::reveal_path,
            commands::system::open_path,
            commands::system::export_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de Fruity Studio");
}
