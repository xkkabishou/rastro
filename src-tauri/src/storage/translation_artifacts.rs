// translation_artifacts 表仓储
#![allow(dead_code)]

use rusqlite::{params, Connection, Row};
use uuid::Uuid;

/// translation_artifacts 表记录
#[derive(Debug, Clone)]
pub struct TranslationArtifactRecord {
    pub artifact_id: String,
    pub job_id: String,
    pub document_id: String,
    pub artifact_kind: String,
    pub file_path: String,
    pub file_sha256: String,
    pub file_size_bytes: u64,
    pub created_at: String,
}

/// 新建翻译产物参数
#[derive(Debug, Clone)]
pub struct CreateTranslationArtifactParams {
    pub job_id: String,
    pub document_id: String,
    pub artifact_kind: String,
    pub file_path: String,
    pub file_sha256: String,
    pub file_size_bytes: u64,
    pub created_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<TranslationArtifactRecord> {
    Ok(TranslationArtifactRecord {
        artifact_id: row.get("artifact_id")?,
        job_id: row.get("job_id")?,
        document_id: row.get("document_id")?,
        artifact_kind: row.get("artifact_kind")?,
        file_path: row.get("file_path")?,
        file_sha256: row.get("file_sha256")?,
        file_size_bytes: row.get("file_size_bytes")?,
        created_at: row.get("created_at")?,
    })
}

/// 创建翻译产物记录
pub fn create(
    connection: &Connection,
    params: &CreateTranslationArtifactParams,
) -> rusqlite::Result<TranslationArtifactRecord> {
    let artifact_id = Uuid::new_v4().to_string();

    connection.execute(
        "INSERT INTO translation_artifacts (
            artifact_id,
            job_id,
            document_id,
            artifact_kind,
            file_path,
            file_sha256,
            file_size_bytes,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            artifact_id,
            params.job_id,
            params.document_id,
            params.artifact_kind,
            params.file_path,
            params.file_sha256,
            params.file_size_bytes,
            params.created_at,
        ],
    )?;

    let mut statement =
        connection.prepare("SELECT * FROM translation_artifacts WHERE artifact_id = ?1")?;
    statement.query_row(params![artifact_id], map_row)
}

/// 列出指定 job 的全部产物
pub fn list_by_job(
    connection: &Connection,
    job_id: &str,
) -> rusqlite::Result<Vec<TranslationArtifactRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM translation_artifacts
         WHERE job_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = statement.query_map(params![job_id], map_row)?;
    rows.collect()
}
