// 标题翻译缓存 IPC Commands
// T3.1.1: get_title_translation + batch_translate_titles
use std::collections::HashMap;
use std::str::FromStr;

use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    errors::{AppError, AppErrorCode},
    models::ProviderId,
    storage::{title_translations, translation_provider_settings},
};

use super::translation_settings::{
    build_translation_chat_request, extract_chat_response_text, resolve_translation_runtime_config,
};

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/// 单个标题翻译查询结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleTranslationDto {
    pub original_title: String,
    pub translated_title: Option<String>,
}

/// 批量翻译结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTranslateTitlesResult {
    /// 原始标题 → 翻译结果（无翻译的标题不包含在内）
    pub results: HashMap<String, String>,
    /// 跳过的标题数量（非英文或已缓存）
    pub skipped: usize,
    /// 实际翻译的标题数量
    pub translated: usize,
}

// ---------------------------------------------------------------------------
// 英文检测
// ---------------------------------------------------------------------------

/// 简单判断标题是否为英文（ASCII 字母占比 ≥ 50%）
fn is_likely_english(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let total_chars = text.chars().count();
    let ascii_alpha_count = text.chars().filter(|c| c.is_ascii_alphabetic()).count();
    // ASCII 字母占比 ≥ 50% 视为英文
    ascii_alpha_count as f64 / total_chars as f64 >= 0.5
}

// ---------------------------------------------------------------------------
// IPC Commands
// ---------------------------------------------------------------------------

/// 查询单个标题的缓存翻译
#[tauri::command]
pub fn get_title_translation(
    state: State<'_, AppState>,
    title: String,
) -> Result<TitleTranslationDto, AppError> {
    let hash = title_translations::hash_title(&title);
    let record = {
        let connection = state.storage.connection();
        title_translations::get_by_hash(&connection, &hash)?
    };

    Ok(TitleTranslationDto {
        original_title: title,
        translated_title: record.map(|r| r.translated_title),
    })
}

/// 批量翻译标题（缓存优先 + 串行限速 1 req/s）
#[tauri::command]
pub async fn batch_translate_titles(
    state: State<'_, AppState>,
    titles: Vec<String>,
) -> Result<BatchTranslateTitlesResult, AppError> {
    if titles.is_empty() {
        return Ok(BatchTranslateTitlesResult {
            results: HashMap::new(),
            skipped: 0,
            translated: 0,
        });
    }

    // 1. 收集所有已缓存的翻译
    let hashes: Vec<String> = titles
        .iter()
        .map(|t| title_translations::hash_title(t))
        .collect();
    // SQLite 同步 IO，走 spawn_blocking 避免阻塞 tokio worker
    let cached_records = {
        let storage = state.storage.clone();
        let hashes_for_query = hashes.clone();
        tokio::task::spawn_blocking(move || -> Result<_, AppError> {
            let connection = storage.connection();
            Ok(title_translations::batch_get(
                &connection,
                &hashes_for_query,
            )?)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??
    };

    let mut results: HashMap<String, String> = HashMap::new();
    let cached_hash_set: HashMap<String, String> = cached_records
        .into_iter()
        .map(|r| (r.title_hash.clone(), r.translated_title))
        .collect();

    // 填入已缓存的结果
    let mut uncached_titles: Vec<String> = Vec::new();
    for (title, hash) in titles.iter().zip(hashes.iter()) {
        if let Some(translated) = cached_hash_set.get(hash) {
            results.insert(title.clone(), translated.clone());
        } else {
            uncached_titles.push(title.clone());
        }
    }

    // 2. 过滤非英文标题
    let english_titles: Vec<String> = uncached_titles
        .iter()
        .filter(|t| is_likely_english(t))
        .cloned()
        .collect();
    let skipped = uncached_titles.len() - english_titles.len();

    // 3. 如果没有需要翻译的标题，直接返回
    if english_titles.is_empty() {
        return Ok(BatchTranslateTitlesResult {
            results,
            skipped: skipped + cached_hash_set.len(),
            translated: 0,
        });
    }

    // 4. 读取活跃翻译配置 (SQLite 走 spawn_blocking)
    let active_record = {
        let storage = state.storage.clone();
        tokio::task::spawn_blocking(move || -> Result<_, AppError> {
            let connection = storage.connection();
            Ok(translation_provider_settings::get_active(&connection)?)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??
    }
    .ok_or_else(|| {
        AppError::new(
            AppErrorCode::ProviderNotConfigured,
            "请先在设置中配置翻译 API",
            false,
        )
    })?;

    let provider = ProviderId::from_str(&active_record.provider)?;
    // resolve_translation_runtime_config 内部读 SQLite + Keychain，走 spawn_blocking
    let config = {
        let app_state = (*state).clone();
        tokio::task::spawn_blocking(move || -> Result<_, AppError> {
            resolve_translation_runtime_config(&app_state, provider)
        })
        .await
        .map_err(|join_err| AppError::internal(format!("数据库任务异常退出: {join_err}")))??
    };

    // 5. 串行限速翻译（1 req/s）
    let client = reqwest::Client::new();
    let mut translated_count = 0usize;

    for (i, title) in english_titles.iter().enumerate() {
        // 限速：除第一个外，每次请求前等待 1 秒
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        let prompt = format!(
            "请将以下英文论文标题翻译为中文，只输出翻译结果，不要解释：\n\n{}",
            title
        );

        let request = build_translation_chat_request(&client, &config, &prompt);
        let response = match request
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                eprintln!("标题翻译请求失败 ({}): {}", title, err);
                continue; // 跳过失败的标题，继续下一个
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            eprintln!("标题翻译 API 返回错误 ({}): {} - {}", title, status, body);
            continue;
        }

        let body: serde_json::Value = match response.json().await {
            Ok(v) => v,
            Err(err) => {
                eprintln!("标题翻译响应解析失败 ({}): {}", title, err);
                continue;
            }
        };

        if let Some(translated) = extract_chat_response_text(provider, &body) {
            let translated = translated.trim().to_string();
            if !translated.is_empty() {
                // 写入缓存 (SQLite 走 spawn_blocking)
                let hash = title_translations::hash_title(title);
                let now = chrono::Utc::now().to_rfc3339();
                let storage = state.storage.clone();
                let title_for_insert = title.clone();
                let translated_for_insert = translated.clone();
                let provider_str = config.provider.as_str().to_string();
                let model_for_insert = config.model.clone();
                let title_for_log = title.clone();
                let insert_result = tokio::task::spawn_blocking(move || {
                    let connection = storage.connection();
                    title_translations::insert(
                        &connection,
                        &hash,
                        &title_for_insert,
                        &translated_for_insert,
                        &provider_str,
                        &model_for_insert,
                        &now,
                    )
                })
                .await;
                match insert_result {
                    Ok(Ok(_)) => {}
                    Ok(Err(err)) => {
                        eprintln!("标题翻译缓存写入失败 ({}): {}", title_for_log, err);
                    }
                    Err(join_err) => {
                        eprintln!(
                            "标题翻译缓存写入任务异常退出 ({}): {}",
                            title_for_log, join_err
                        );
                    }
                }
                results.insert(title.clone(), translated);
                translated_count += 1;
            }
        }
    }

    Ok(BatchTranslateTitlesResult {
        results,
        skipped,
        translated: translated_count,
    })
}

#[cfg(test)]
mod tests {
    use super::is_likely_english;

    #[test]
    fn english_detection() {
        // 英文标题
        assert!(is_likely_english("Machine Learning in Practice"));
        assert!(is_likely_english("A Survey of Deep Learning Approaches"));
        assert!(is_likely_english("COVID-19 Vaccine Distribution"));

        // 中文标题
        assert!(!is_likely_english("机器学习在实践中的应用"));
        assert!(!is_likely_english("深度学习综述"));

        // 混合（中文为主）
        assert!(!is_likely_english("基于 CNN 的图像分类研究"));

        // 空字符串
        assert!(!is_likely_english(""));
    }
}
