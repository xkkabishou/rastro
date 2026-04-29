// translation_jobs 表仓储
#![allow(dead_code)]

use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// translation_jobs 表记录
#[derive(Debug, Clone)]
pub struct TranslationJobRecord {
    pub job_id: String,
    pub document_id: String,
    pub engine_job_id: Option<String>,
    pub cache_key: String,
    pub provider: String,
    pub model: String,
    pub source_lang: String,
    pub target_lang: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// 新建翻译任务参数
#[derive(Debug, Clone)]
pub struct CreateTranslationJobParams {
    pub document_id: String,
    pub engine_job_id: Option<String>,
    pub cache_key: String,
    pub provider: String,
    pub model: String,
    pub source_lang: String,
    pub target_lang: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub created_at: String,
}

pub fn map_job_row(row: &Row<'_>) -> rusqlite::Result<TranslationJobRecord> {
    Ok(TranslationJobRecord {
        job_id: row.get("job_id")?,
        document_id: row.get("document_id")?,
        engine_job_id: row.get("engine_job_id")?,
        cache_key: row.get("cache_key")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        source_lang: row.get("source_lang")?,
        target_lang: row.get("target_lang")?,
        status: row.get("status")?,
        stage: row.get("stage")?,
        progress: row.get("progress")?,
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

/// 创建翻译任务
pub fn create(
    connection: &Connection,
    params: &CreateTranslationJobParams,
) -> rusqlite::Result<TranslationJobRecord> {
    let job_id = Uuid::new_v4().to_string();

    connection.execute(
        "INSERT INTO translation_jobs (
            job_id,
            document_id,
            engine_job_id,
            cache_key,
            provider,
            model,
            source_lang,
            target_lang,
            status,
            stage,
            progress,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            job_id,
            params.document_id,
            params.engine_job_id,
            params.cache_key,
            params.provider,
            params.model,
            params.source_lang,
            params.target_lang,
            params.status,
            params.stage,
            params.progress,
            params.created_at,
        ],
    )?;

    get_by_id(connection, &job_id)
        .map(|record| record.expect("inserted translation job should be queryable immediately"))
}

/// 查询单个翻译任务
pub fn get_by_id(
    connection: &Connection,
    job_id: &str,
) -> rusqlite::Result<Option<TranslationJobRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_jobs WHERE job_id = ?1",
            params![job_id],
            map_job_row,
        )
        .optional()
}

/// 更新引擎侧 job_id
pub fn set_engine_job_id(
    connection: &Connection,
    job_id: &str,
    engine_job_id: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE translation_jobs
         SET engine_job_id = ?1
         WHERE job_id = ?2",
        params![engine_job_id, job_id],
    )?;
    Ok(())
}

/// 更新翻译任务状态
#[allow(clippy::too_many_arguments)]
pub fn update_status(
    connection: &Connection,
    job_id: &str,
    status: &str,
    stage: &str,
    progress: f64,
    error_code: Option<&str>,
    error_message: Option<&str>,
    started_at: Option<&str>,
    finished_at: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE translation_jobs
         SET status = ?1,
             stage = ?2,
             progress = ?3,
             error_code = ?4,
             error_message = ?5,
             started_at = COALESCE(?6, started_at),
             finished_at = ?7
         WHERE job_id = ?8",
        params![
            status,
            stage,
            progress,
            error_code,
            error_message,
            started_at,
            finished_at,
            job_id,
        ],
    )?;
    Ok(())
}

/// 启动自愈：将应用退出/引擎崩溃遗留的超时 running 任务标记为 failed。
pub fn mark_stale_running_as_failed(
    connection: &Connection,
    cutoff_iso: &str,
    finished_at: &str,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE translation_jobs
         SET status = 'failed',
             stage = 'failed',
             progress = 0.0,
             error_code = 'ENGINE_INTERRUPTED',
             error_message = '应用重启后检测到翻译任务超时未完成，请重新发起翻译',
             finished_at = ?2
         WHERE status = 'running'
           AND COALESCE(started_at, created_at) < ?1",
        params![cutoff_iso, finished_at],
    )
}

/// 查询文档最近的完成态翻译任务
/// provider/model 过滤推入 SQL WHERE 子句，避免将全部已完成任务读入内存后再过滤
pub fn find_latest_completed_for_document(
    connection: &Connection,
    document_id: &str,
    provider: Option<&str>,
    model: Option<&str>,
) -> rusqlite::Result<Option<TranslationJobRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_jobs
             WHERE document_id = ?1
               AND status = 'completed'
               AND (?2 IS NULL OR provider = ?2)
               AND (?3 IS NULL OR model = ?3)
             ORDER BY finished_at DESC, created_at DESC
             LIMIT 1",
            params![document_id, provider, model],
            map_job_row,
        )
        .optional()
}

/// 查询指定 cache_key 最近的任务
pub fn find_latest_by_cache_key(
    connection: &Connection,
    cache_key: &str,
) -> rusqlite::Result<Option<TranslationJobRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_jobs
             WHERE cache_key = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![cache_key],
            map_job_row,
        )
        .optional()
}

/// 查询指定 cache_key 最近的完成态任务
pub fn find_latest_completed_by_cache_key(
    connection: &Connection,
    cache_key: &str,
) -> rusqlite::Result<Option<TranslationJobRecord>> {
    connection
        .query_row(
            "SELECT * FROM translation_jobs
             WHERE cache_key = ?1
               AND status = 'completed'
             ORDER BY finished_at DESC, created_at DESC
             LIMIT 1",
            params![cache_key],
            map_job_row,
        )
        .optional()
}

/// 列出全部已完成的翻译任务
pub fn list_completed(connection: &Connection) -> rusqlite::Result<Vec<TranslationJobRecord>> {
    let mut statement = connection.prepare(
        "SELECT * FROM translation_jobs
         WHERE status = 'completed'
         ORDER BY finished_at ASC, created_at ASC",
    )?;

    let rows = statement.query_map([], map_job_row)?;
    rows.collect()
}

/// 删除翻译任务（其产物索引会随外键级联删除）
pub fn delete_by_id(connection: &Connection, job_id: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM translation_jobs WHERE job_id = ?1",
        params![job_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use crate::{
        models::DocumentSourceType,
        storage::{documents, Storage},
    };

    use super::{create, get_by_id, mark_stale_running_as_failed, CreateTranslationJobParams};

    #[test]
    fn mark_stale_running_as_failed_only_recovers_timeout_running_jobs() {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let now = Utc::now();
        let old_timestamp = (now - Duration::hours(2)).to_rfc3339();
        let fresh_timestamp = now.to_rfc3339();

        let connection = storage.connection();
        let old_doc = documents::upsert(
            &connection,
            &documents::UpsertDocumentParams {
                file_path: "/tmp/old.pdf".to_string(),
                file_sha256: "sha-old-running".to_string(),
                title: "Old".to_string(),
                page_count: 1,
                source_type: DocumentSourceType::Local,
                zotero_item_key: None,
                timestamp: old_timestamp.clone(),
            },
        )
        .expect("old document should insert");
        let fresh_doc = documents::upsert(
            &connection,
            &documents::UpsertDocumentParams {
                file_path: "/tmp/fresh.pdf".to_string(),
                file_sha256: "sha-fresh-running".to_string(),
                title: "Fresh".to_string(),
                page_count: 1,
                source_type: DocumentSourceType::Local,
                zotero_item_key: None,
                timestamp: fresh_timestamp.clone(),
            },
        )
        .expect("fresh document should insert");

        let old_job = create(
            &connection,
            &CreateTranslationJobParams {
                document_id: old_doc.document_id,
                engine_job_id: Some("engine-old".to_string()),
                cache_key: "cache-old-running".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4o-mini".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                status: "running".to_string(),
                stage: "translating".to_string(),
                progress: 0.5,
                created_at: old_timestamp.clone(),
            },
        )
        .expect("old job should insert");
        let fresh_job = create(
            &connection,
            &CreateTranslationJobParams {
                document_id: fresh_doc.document_id,
                engine_job_id: Some("engine-fresh".to_string()),
                cache_key: "cache-fresh-running".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4o-mini".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                status: "running".to_string(),
                stage: "translating".to_string(),
                progress: 0.2,
                created_at: fresh_timestamp.clone(),
            },
        )
        .expect("fresh job should insert");

        let cutoff = (now - Duration::minutes(30)).to_rfc3339();
        let recovered = mark_stale_running_as_failed(&connection, &cutoff, &fresh_timestamp)
            .expect("recovery update should succeed");

        assert_eq!(recovered, 1);
        assert_eq!(
            get_by_id(&connection, &old_job.job_id)
                .unwrap()
                .unwrap()
                .status,
            "failed"
        );
        assert_eq!(
            get_by_id(&connection, &fresh_job.job_id)
                .unwrap()
                .unwrap()
                .status,
            "running"
        );
    }
}
