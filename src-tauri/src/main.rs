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

            // T3.1.2: 启动时后台缓存补全任务（不阻塞主线程）
            let bg_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = background_fill_title_cache(bg_state).await {
                    eprintln!("标题翻译缓存补全任务失败: {}", err);
                }
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
            // J. 翻译 Provider 配置与翻译 (6 个)
            ipc::translation_settings::list_translation_provider_configs,
            ipc::translation_settings::save_translation_provider_key,
            ipc::translation_settings::set_active_translation_provider,
            ipc::translation_settings::update_translation_provider_config,
            ipc::translation_settings::test_translation_connection,
            ipc::translation_settings::translate_text,
            // K. 标题翻译缓存 (2 个)
            ipc::title_translation::get_title_translation,
            ipc::title_translation::batch_translate_titles,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

/// T3.1.2: 后台标题翻译缓存补全
/// 启动时自动检测 Zotero → 收集所有文献标题 → 查缓存缺失 → 过滤英文 → 串行翻译
async fn background_fill_title_cache(
    state: app_state::AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::str::FromStr;

    // 延迟 3 秒启动，等待应用初始化和 UI 加载完成
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    // 1. 检查翻译 API 是否已配置
    let active_record = {
        let connection = state.storage.connection();
        storage::translation_provider_settings::get_active(&connection)?
    };
    let active_record = match active_record {
        Some(r) => r,
        None => {
            eprintln!("[标题缓存补全] 翻译 API 未配置，跳过");
            return Ok(());
        }
    };
    let provider = models::ProviderId::from_str(&active_record.provider)?;

    // 验证 API Key 是否存在
    let config = match ipc::translation_settings::resolve_translation_runtime_config(
        &state, provider,
    ) {
        Ok(c) => c,
        Err(_) => {
            eprintln!("[标题缓存补全] 翻译 API Key 未配置，跳过");
            return Ok(());
        }
    };

    // 2. 检测 Zotero
    let connector = match zotero_connector::ZoteroConnector::detect() {
        Ok(c) => c,
        Err(_) => {
            eprintln!("[标题缓存补全] Zotero 未检测到，跳过");
            return Ok(());
        }
    };

    // 3. 分页获取所有 Zotero 文献标题
    let mut all_titles: Vec<String> = Vec::new();
    let mut offset = 0u32;
    let page_limit = 200u32;
    loop {
        let page = connector.fetch_items(None, offset, page_limit)?;
        for item in &page.items {
            if !item.title.is_empty() && item.title != "Untitled" {
                all_titles.push(item.title.clone());
            }
        }
        offset += page_limit;
        if offset >= page.total {
            break;
        }
    }

    if all_titles.is_empty() {
        eprintln!("[标题缓存补全] 无文献标题，跳过");
        return Ok(());
    }

    // 4. 查缓存缺失
    let hashes: Vec<String> = all_titles
        .iter()
        .map(|t| storage::title_translations::hash_title(t))
        .collect();
    let cached = {
        let connection = state.storage.connection();
        storage::title_translations::batch_get(&connection, &hashes)?
    };
    let cached_set: std::collections::HashSet<String> =
        cached.into_iter().map(|r| r.title_hash).collect();

    let uncached: Vec<&String> = all_titles
        .iter()
        .zip(hashes.iter())
        .filter(|(_, hash)| !cached_set.contains(hash.as_str()))
        .map(|(title, _)| title)
        .collect();

    // 5. 过滤英文标题
    let english_uncached: Vec<&String> = uncached
        .into_iter()
        .filter(|t| is_likely_english(t))
        .collect();

    if english_uncached.is_empty() {
        eprintln!(
            "[标题缓存补全] 完成：{} 个标题全部已有缓存或非英文",
            all_titles.len()
        );
        return Ok(());
    }

    eprintln!(
        "[标题缓存补全] 开始翻译 {} 个英文标题（共 {} 个文献）",
        english_uncached.len(),
        all_titles.len()
    );

    // 6. 串行限速翻译（1 req/s）
    let client = reqwest::Client::new();
    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for (i, title) in english_uncached.iter().enumerate() {
        // 限速
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        let prompt = format!(
            "请将以下英文论文标题翻译为中文，只输出翻译结果，不要解释：\n\n{}",
            title
        );

        let request = ipc::translation_settings::build_translation_chat_request(
            &client, &config, &prompt,
        );
        let response = match request
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                eprintln!("[标题缓存补全] 请求失败 ({}): {}", title, err);
                fail_count += 1;
                continue;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            eprintln!(
                "[标题缓存补全] API 错误 ({}): {} - {}",
                title, status, body
            );
            fail_count += 1;
            // 如果连续失败 3 次以上，提前退出避免浪费资源
            if fail_count >= 3 && success_count == 0 {
                eprintln!("[标题缓存补全] 连续失败 3 次，提前终止");
                break;
            }
            continue;
        }

        let body: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(err) => {
                eprintln!(
                    "[标题缓存补全] 响应解析失败 ({}): {}",
                    title, err
                );
                fail_count += 1;
                continue;
            }
        };

        if let Some(translated) =
            ipc::translation_settings::extract_chat_response_text(provider, &body)
        {
            let translated = translated.trim().to_string();
            if !translated.is_empty() {
                let hash = storage::title_translations::hash_title(title);
                let now = chrono::Utc::now().to_rfc3339();
                let connection = state.storage.connection();
                if let Err(err) = storage::title_translations::insert(
                    &connection,
                    &hash,
                    title,
                    &translated,
                    config.provider.as_str(),
                    &config.model,
                    &now,
                ) {
                    eprintln!(
                        "[标题缓存补全] 缓存写入失败 ({}): {}",
                        title, err
                    );
                } else {
                    success_count += 1;
                }
            }
        }
    }

    eprintln!(
        "[标题缓存补全] 完成：成功 {} 个，失败 {} 个",
        success_count, fail_count
    );
    Ok(())
}

/// 简单判断标题是否为英文（ASCII 字母占比 ≥ 50%）
fn is_likely_english(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let total_chars = text.chars().count();
    let ascii_alpha_count = text.chars().filter(|c| c.is_ascii_alphabetic()).count();
    ascii_alpha_count as f64 / total_chars as f64 >= 0.5
}
