// Rastro 后端入口
// 注册所有 25 个 #[tauri::command] 到 Tauri Builder
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_integration;
mod app_state;
mod artifact_aggregator;
mod errors;
mod ipc;
mod keychain;
mod models;
mod notebooklm_manager;
mod storage;
mod translation_manager;
mod zotero_connector;

use tauri::{Emitter, Manager};

fn main() {
    if let Err(e) = run_app() {
        eprintln!("Rastro 启动失败: {}", e);
        std::process::exit(1);
    }
}

fn run_app() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = app_state::AppState::initialize()?;

            // R3-H1: 注入翻译事件发射器，将 translation_manager 的回调桥接到 Tauri 前端事件
            let handle = app.handle().clone();
            state.translation_manager.set_event_emitter(move |event_name, document_id, job_id| {
                let _ = handle.emit(
                    event_name,
                    serde_json::json!({
                        "documentId": document_id,
                        "jobId": job_id,
                    }),
                );
            });

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // A. 文档与应用状态 / 文档管理
            ipc::document::get_backend_health,
            ipc::document::open_document,
            ipc::document::list_recent_documents,
            ipc::document::get_document_snapshot,
            ipc::document::list_document_artifacts,
            ipc::document::remove_recent_document,
            ipc::document::toggle_document_favorite,
            ipc::document::reveal_in_finder,
            // B. Translation Engine 生命周期 (3 个)
            ipc::translation::ensure_translation_engine,
            ipc::translation::shutdown_translation_engine,
            ipc::translation::get_translation_engine_status,
            // C. 翻译任务 (4 个)
            ipc::translation::request_translation,
            ipc::translation::get_translation_job,
            ipc::translation::cancel_translation,
            ipc::translation::load_cached_translation,
            ipc::translation::delete_translation_cache,
            // D. AI 问答与总结 (8 个)
            ipc::ai::ask_ai,
            ipc::ai::cancel_ai_stream,
            ipc::ai::generate_summary,
            ipc::ai::get_document_summary,
            ipc::ai::save_document_summary,
            ipc::ai::delete_document_summary,
            ipc::ai::list_chat_sessions,
            ipc::ai::get_chat_messages,
            // E. Provider 配置与凭据 (7 个)
            ipc::settings::list_provider_configs,
            ipc::settings::save_provider_key,
            ipc::settings::remove_provider_key,
            ipc::settings::set_active_provider,
            ipc::settings::test_provider_connection,
            ipc::settings::update_provider_config,
            ipc::settings::fetch_available_models,
            // F. 使用统计 (1 个)
            ipc::settings::get_usage_stats,
            // G. 缓存统计与清理 (2 个)
            ipc::settings::get_cache_stats,
            ipc::settings::clear_all_translation_cache,
            // H. 自定义提示词 (3 个)
            ipc::settings::get_custom_prompt,
            ipc::settings::save_custom_prompt,
            ipc::settings::reset_custom_prompt,
            // G. Zotero 集成 (5 个)
            ipc::zotero::detect_zotero_library,
            ipc::zotero::fetch_zotero_items,
            ipc::zotero::fetch_zotero_collections,
            ipc::zotero::fetch_zotero_collection_items,
            ipc::zotero::open_zotero_attachment,
            // H. NotebookLM 集成 (10 个)
            ipc::notebooklm::notebooklm_get_status,
            ipc::notebooklm::notebooklm_begin_login,
            ipc::notebooklm::notebooklm_open_external,
            ipc::notebooklm::notebooklm_logout,
            ipc::notebooklm::notebooklm_list_notebooks,
            ipc::notebooklm::notebooklm_create_notebook,
            ipc::notebooklm::notebooklm_attach_current_pdf,
            ipc::notebooklm::notebooklm_generate_artifact,
            ipc::notebooklm::notebooklm_get_task,
            ipc::notebooklm::notebooklm_list_artifacts,
            ipc::notebooklm::notebooklm_download_artifact,
            // I. 标注 (5 个)
            ipc::annotations::save_annotation,
            ipc::annotations::update_annotation,
            ipc::annotations::delete_annotation,
            ipc::annotations::list_annotations,
            ipc::annotations::list_annotations_by_page,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
