// L. Obsidian 笔记同步 IPC Commands (5 个)
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Local, Utc};
use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    errors::AppError,
    storage::{chat_messages, chat_sessions, obsidian_config},
};

// ---------------------------------------------------------------------------
// DTO 定义
// ---------------------------------------------------------------------------

/// Obsidian 配置 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianConfigDto {
    pub vault_path: Option<String>,
    pub auto_sync: bool,
}

/// Vault 路径校验结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateVaultResult {
    pub valid: bool,
    pub message: String,
}

/// 总结导出结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummaryResult {
    pub success: bool,
    pub file_path: String,
}

/// 聊天导出结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportChatsResult {
    pub success: bool,
    pub exported_count: usize,
    pub file_paths: Vec<String>,
}

/// 检测到的 Obsidian Vault
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedVault {
    pub path: String,
    pub name: String,
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/// 文件名安全化：替换非法字符 + 截断
fn sanitize_filename(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            '\0' => '_',
            _ => c,
        })
        .collect();

    // 截断为 80 字符
    let trimmed = sanitized.trim();
    if trimmed.chars().count() > 80 {
        trimmed.chars().take(80).collect::<String>().trim_end().to_string()
    } else {
        trimmed.to_string()
    }
}

/// 确保目录存在
fn ensure_dir(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| AppError::internal(
            format!("无法创建目录 {}: {}", path.display(), e),
        ))?;
    }
    Ok(())
}

/// 生成总结文件的 front matter + 内容
fn build_summary_markdown(
    title: &str,
    content_md: &str,
    summary_type: &str,
    document_id: &str,
) -> String {
    let now = Local::now().to_rfc3339();
    format!(
        "---\ntitle: \"{}\"\ntype: summary\nsummary_type: {}\nsource: rastro\nexported_at: {}\ndocument_id: \"{}\"\n---\n\n{}",
        title.replace('"', "\\\""),
        summary_type,
        now,
        document_id,
        content_md,
    )
}

/// 生成聊天记录的 front matter + 内容
fn build_chat_markdown(
    title: &str,
    session_id: &str,
    document_id: &str,
    messages: &[chat_messages::ChatMessageRecord],
) -> String {
    let now = Local::now().to_rfc3339();
    let mut md = format!(
        "---\ntitle: \"{} - 对话记录\"\ntype: chat\nsource: rastro\nsession_id: \"{}\"\nexported_at: {}\ndocument_id: \"{}\"\n---\n\n",
        title.replace('"', "\\\""),
        session_id,
        now,
        document_id,
    );

    for msg in messages {
        let role_label = match msg.role.as_str() {
            "user" => "👤 用户",
            "assistant" => "🤖 AI",
            _ => "📋 系统",
        };
        md.push_str(&format!("## {}\n", role_label));

        // 如果有上下文引用，显示引用块
        if let Some(ref quote) = msg.context_quote {
            if !quote.is_empty() {
                md.push_str(&format!("> {}\n\n", quote.replace('\n', "\n> ")));
            }
        }

        md.push_str(&msg.content_md);
        md.push_str("\n\n---\n\n");
    }

    md
}

/// 获取文献文件夹路径
fn get_literature_dir(vault_path: &str, title: &str) -> PathBuf {
    Path::new(vault_path)
        .join("文献笔记")
        .join(sanitize_filename(title))
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// 获取 Obsidian 配置
#[tauri::command]
pub fn get_obsidian_config(
    state: State<'_, AppState>,
) -> Result<ObsidianConfigDto, AppError> {
    let connection = state.storage.connection();
    let vault_path = obsidian_config::get_vault_path(&connection)?;
    let auto_sync = obsidian_config::get_auto_sync(&connection)?;

    Ok(ObsidianConfigDto {
        vault_path,
        auto_sync,
    })
}

/// 保存 Obsidian 配置
#[tauri::command]
pub fn save_obsidian_config(
    state: State<'_, AppState>,
    vault_path: Option<String>,
    auto_sync: Option<bool>,
) -> Result<ObsidianConfigDto, AppError> {
    let now = Utc::now().to_rfc3339();
    let connection = state.storage.connection();

    if let Some(ref path) = vault_path {
        obsidian_config::upsert(&connection, "vault_path", path, &now)?;
    }
    if let Some(sync) = auto_sync {
        obsidian_config::upsert(
            &connection,
            "auto_sync",
            if sync { "true" } else { "false" },
            &now,
        )?;
    }

    // 返回最新配置
    let current_vault = obsidian_config::get_vault_path(&connection)?;
    let current_sync = obsidian_config::get_auto_sync(&connection)?;

    Ok(ObsidianConfigDto {
        vault_path: current_vault,
        auto_sync: current_sync,
    })
}

/// 校验 Vault 路径
#[tauri::command]
pub fn validate_obsidian_vault(
    vault_path: String,
) -> Result<ValidateVaultResult, AppError> {
    let path = Path::new(&vault_path);

    if !path.exists() {
        return Ok(ValidateVaultResult {
            valid: false,
            message: "路径不存在".to_string(),
        });
    }

    if !path.is_dir() {
        return Ok(ValidateVaultResult {
            valid: false,
            message: "路径不是文件夹".to_string(),
        });
    }

    // 尝试写入测试文件确认写权限
    let test_file = path.join(".rastro_write_test");
    match fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            Ok(ValidateVaultResult {
                valid: true,
                message: "Vault 路径有效".to_string(),
            })
        }
        Err(_) => Ok(ValidateVaultResult {
            valid: false,
            message: "没有写入权限".to_string(),
        }),
    }
}

/// 导出总结到 Obsidian
#[tauri::command]
pub fn export_summary_to_obsidian(
    state: State<'_, AppState>,
    document_id: String,
    title: String,
    content_md: String,
    summary_type: Option<String>,
) -> Result<ExportSummaryResult, AppError> {
    let vault_path = {
        let connection = state.storage.connection();
        obsidian_config::get_vault_path(&connection)?
    };

    let vault_path = vault_path.ok_or_else(|| {
        AppError::internal("Obsidian Vault 路径未配置".to_string())
    })?;

    let summary_type = summary_type.unwrap_or_else(|| "default".to_string());
    let lit_dir = get_literature_dir(&vault_path, &title);
    ensure_dir(&lit_dir)?;

    // 确定文件名：默认总结为"总结.md"，其他类型为"总结-{type}.md"
    let filename = if summary_type == "default" {
        "总结.md".to_string()
    } else {
        format!("总结-{}.md", summary_type)
    };
    let file_path = lit_dir.join(&filename);

    let md_content = build_summary_markdown(&title, &content_md, &summary_type, &document_id);
    fs::write(&file_path, md_content).map_err(|e| {
        AppError::internal(format!("写入文件失败: {}", e))
    })?;

    Ok(ExportSummaryResult {
        success: true,
        file_path: file_path.to_string_lossy().to_string(),
    })
}

/// 批量导出聊天记录到 Obsidian
#[tauri::command]
pub fn export_chats_to_obsidian(
    state: State<'_, AppState>,
    document_id: String,
    title: String,
    session_ids: Vec<String>,
) -> Result<ExportChatsResult, AppError> {
    let vault_path = {
        let connection = state.storage.connection();
        obsidian_config::get_vault_path(&connection)?
    };

    let vault_path = vault_path.ok_or_else(|| {
        AppError::internal("Obsidian Vault 路径未配置".to_string())
    })?;

    let lit_dir = get_literature_dir(&vault_path, &title);
    ensure_dir(&lit_dir)?;

    let mut exported_paths: Vec<String> = Vec::new();

    for session_id in &session_ids {
        // 获取会话信息和消息
        let (session_record, messages) = {
            let connection = state.storage.connection();
            let sessions = chat_sessions::list_by_document(&connection, &document_id)?;
            let session = sessions
                .into_iter()
                .find(|s| s.session_id == *session_id);

            let msgs = chat_messages::list_by_session(&connection, session_id)?;
            (session, msgs)
        };

        if messages.is_empty() {
            continue;
        }

        // 从会话创建时间生成文件名
        let timestamp = session_record
            .as_ref()
            .map(|s| s.created_at.clone())
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        // 简化时间戳为文件名友好格式
        let time_slug = timestamp
            .chars()
            .take(19)
            .map(|c| match c {
                ':' | 'T' => '-',
                _ => c,
            })
            .collect::<String>();

        let filename = format!("对话-{}.md", time_slug);
        let file_path = lit_dir.join(&filename);

        let md_content = build_chat_markdown(&title, session_id, &document_id, &messages);
        fs::write(&file_path, &md_content).map_err(|e| {
            AppError::internal(format!("写入聊天记录失败: {}", e))
        })?;

        exported_paths.push(file_path.to_string_lossy().to_string());
    }

    Ok(ExportChatsResult {
        success: true,
        exported_count: exported_paths.len(),
        file_paths: exported_paths,
    })
}

/// 自动检测本机 Obsidian Vault 列表
/// 读取 ~/Library/Application Support/obsidian/obsidian.json
#[tauri::command]
pub fn detect_obsidian_vaults() -> Result<Vec<DetectedVault>, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::internal("无法获取用户主目录".to_string())
    })?;

    let obsidian_json = home
        .join("Library")
        .join("Application Support")
        .join("obsidian")
        .join("obsidian.json");

    if !obsidian_json.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&obsidian_json).map_err(|e| {
        AppError::internal(format!("读取 Obsidian 配置失败: {}", e))
    })?;

    // 解析 JSON：{ "vaults": { "id": { "path": "...", ... }, ... } }
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        AppError::internal(format!("解析 Obsidian JSON 失败: {}", e))
    })?;

    let mut vaults: Vec<DetectedVault> = Vec::new();

    if let Some(vaults_obj) = json.get("vaults").and_then(|v| v.as_object()) {
        for (_id, vault_info) in vaults_obj {
            if let Some(path) = vault_info.get("path").and_then(|p| p.as_str()) {
                // 从路径提取名称（最后一个路径组件）
                let name = Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string());

                // 只返回路径存在的 vault
                if Path::new(path).exists() {
                    vaults.push(DetectedVault {
                        path: path.to_string(),
                        name,
                    });
                }
            }
        }
    }

    Ok(vaults)
}
