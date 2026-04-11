// L. Obsidian 笔记同步 IPC Commands (4 个)
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Local, Utc};
use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    errors::AppError,
    storage::obsidian_config,
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

/// 根据 summary_type 构造导出到 Obsidian 的最终文件路径
///
/// 规则：
/// - `default`      → `{vault}/{sanitized_title}_总结.md`
/// - `paper-review` → `{vault}/{sanitized_title}_论文评析.md`
/// - 其他未知类型   → `{vault}/{sanitized_title}_总结_{type}.md`（兜底，防止新增 prompt profile 时 panic）
///
/// 设计约束：不再在 vault 路径下硬拼任何子目录（历史硬编码 `文献笔记/{title}/` 已废弃），
/// 直接把文件放在用户配置的 Vault 路径根目录下，由用户自己控制目标目录。
fn build_export_path(vault_path: &str, title: &str, summary_type: &str) -> PathBuf {
    let safe_title = sanitize_filename(title);
    let filename = match summary_type {
        "default" => format!("{}_总结.md", safe_title),
        "paper-review" => format!("{}_论文评析.md", safe_title),
        other => format!("{}_总结_{}.md", safe_title, other),
    };
    Path::new(vault_path).join(filename)
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
///
/// 文件路径规则由 [`build_export_path`] 决定：
/// - `{vault_path}/{title}_总结.md`（默认）
/// - `{vault_path}/{title}_论文评析.md`（paper-review）
/// - `{vault_path}/{title}_总结_{type}.md`（其他未知类型兜底）
///
/// 不再在 vault 下创建子目录——用户配置的 Vault 路径就是最终目标目录。
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
    let file_path = build_export_path(&vault_path, &title, &summary_type);

    // 确保 Vault 目录存在（通常已存在，只是防御性确认）
    if let Some(parent) = file_path.parent() {
        ensure_dir(parent)?;
    }

    let md_content = build_summary_markdown(&title, &content_md, &summary_type, &document_id);
    fs::write(&file_path, md_content).map_err(|e| {
        AppError::internal(format!("写入文件失败: {}", e))
    })?;

    Ok(ExportSummaryResult {
        success: true,
        file_path: file_path.to_string_lossy().to_string(),
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

// ---------------------------------------------------------------------------
// 单元测试
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // sanitize_filename 回归（已有逻辑）
    // -----------------------------------------------------------------------

    #[test]
    fn sanitize_filename_replaces_illegal_chars() {
        // 每个非法字符独立测试，避免数错下划线位数
        for ch in ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'] {
            let input = format!("a{}b", ch);
            assert_eq!(
                sanitize_filename(&input),
                "a_b",
                "字符 {:?} 应该被替换为下划线",
                ch
            );
        }
    }

    #[test]
    fn sanitize_filename_trims_whitespace() {
        assert_eq!(sanitize_filename("  hello world  "), "hello world");
    }

    #[test]
    fn sanitize_filename_truncates_over_80_chars() {
        let long = "a".repeat(120);
        let sanitized = sanitize_filename(&long);
        assert_eq!(sanitized.chars().count(), 80);
    }

    #[test]
    fn sanitize_filename_preserves_chinese() {
        assert_eq!(sanitize_filename("猫儿山黑皮陶"), "猫儿山黑皮陶");
    }

    // -----------------------------------------------------------------------
    // build_export_path：核心路径拼接规则
    // -----------------------------------------------------------------------

    #[test]
    fn build_export_path_default_summary_type() {
        // 默认总结：文件名为 {title}_总结.md
        let path = build_export_path("/tmp/vault", "猫儿山黑皮陶", "default");
        assert_eq!(path, PathBuf::from("/tmp/vault/猫儿山黑皮陶_总结.md"));
    }

    #[test]
    fn build_export_path_paper_review_uses_chinese_alias() {
        // paper-review 类型：使用中文别名"论文评析"
        let path = build_export_path("/tmp/vault", "Black Pottery Analysis", "paper-review");
        assert_eq!(
            path,
            PathBuf::from("/tmp/vault/Black Pottery Analysis_论文评析.md")
        );
    }

    #[test]
    fn build_export_path_unknown_type_falls_back_gracefully() {
        // 未知类型：兜底为 {title}_总结_{type}.md，避免新增 prompt profile 时 panic
        let path = build_export_path("/tmp/vault", "Doc", "future-type");
        assert_eq!(path, PathBuf::from("/tmp/vault/Doc_总结_future-type.md"));
    }

    #[test]
    fn build_export_path_sanitizes_illegal_chars_in_title() {
        // 标题里含 / 和 *：必须被替换，而不是把 / 当成子路径分隔符
        let path = build_export_path("/tmp/vault", "foo/bar*baz", "default");
        assert_eq!(path, PathBuf::from("/tmp/vault/foo_bar_baz_总结.md"));
    }

    #[test]
    fn build_export_path_does_not_add_hardcoded_subdir() {
        // 回归测试：历史 bug 是在 vault 下硬拼 "文献笔记/{title}/"，
        // 修复后不应该再出现这个子目录，也不应该出现"文献笔记"字样（除非用户自己在 vault 路径里已经包含）
        let path = build_export_path("/tmp/vault", "X", "default");
        assert_eq!(path, PathBuf::from("/tmp/vault/X_总结.md"));
        // 明确不应有嵌套子目录
        assert_eq!(path.components().count(), 4); // /, tmp, vault, X_总结.md
    }

    #[test]
    fn build_export_path_user_vault_with_wenxian_suffix_no_duplication() {
        // 回归测试：用户的 vault 路径已经包含"文献笔记"时，不应再被重复拼接
        let path = build_export_path("/Users/alias/笔记/文献笔记", "猫儿山黑皮陶", "default");
        assert_eq!(
            path,
            PathBuf::from("/Users/alias/笔记/文献笔记/猫儿山黑皮陶_总结.md")
        );
        // 双重 "文献笔记" 是之前的 bug 形态，这里必须只出现一次
        let as_str = path.to_string_lossy();
        assert_eq!(as_str.matches("文献笔记").count(), 1);
    }
}
