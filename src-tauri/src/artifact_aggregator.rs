// 文档产物聚合查询
#![allow(dead_code)]

use rusqlite::Connection;
use serde::Serialize;

use crate::{
    errors::{AppError, AppErrorCode},
    storage::{document_summaries, documents, translation_artifacts, translation_jobs},
};

/// 文档产物统一 DTO
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentArtifactDto {
    pub artifact_id: String,
    pub document_id: String,
    pub kind: String,
    pub title: String,
    pub file_path: Option<String>,
    pub content_preview: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub file_size: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

/// 文档产物数量概览
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactCount {
    pub has_translation: bool,
    pub translation_count: u32,
    pub has_summary: bool,
}

impl ArtifactCount {
    /// 返回文档在侧栏中可见的总产物数。
    pub fn total_count(&self) -> u32 {
        self.translation_count + u32::from(self.has_summary)
    }
}

/// 聚合返回文档原件、翻译缓存与 AI 总结。
pub fn list_artifacts_for_document(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<DocumentArtifactDto>, AppError> {
    let document = documents::get_by_id(connection, document_id)?.ok_or_else(|| {
        AppError::new(AppErrorCode::DocumentNotFound, "未找到对应文档记录", false)
    })?;

    let mut artifacts = vec![DocumentArtifactDto {
        artifact_id: format!("original:{}", document.document_id),
        document_id: document.document_id.clone(),
        kind: "original_pdf".to_string(),
        title: document.title.clone(),
        file_path: Some(document.file_path.clone()),
        content_preview: None,
        provider: None,
        model: None,
        file_size: std::fs::metadata(&document.file_path)
            .ok()
            .map(|metadata| metadata.len()),
        created_at: document.created_at.clone(),
        updated_at: document.last_opened_at.clone(),
    }];

    if let Some(job) = translation_jobs::find_latest_completed_for_document(
        connection,
        &document.document_id,
        None,
        None,
    )? {
        for artifact in translation_artifacts::list_by_job(connection, &job.job_id)? {
            if !matches!(
                artifact.artifact_kind.as_str(),
                "translated_pdf" | "bilingual_pdf"
            ) {
                continue;
            }

            artifacts.push(DocumentArtifactDto {
                artifact_id: artifact.artifact_id,
                document_id: artifact.document_id,
                kind: artifact.artifact_kind.clone(),
                title: translation_title(&artifact.artifact_kind).to_string(),
                file_path: Some(artifact.file_path),
                content_preview: None,
                provider: Some(job.provider.clone()),
                model: Some(job.model.clone()),
                file_size: Some(artifact.file_size_bytes),
                created_at: artifact.created_at,
                updated_at: job
                    .finished_at
                    .clone()
                    .unwrap_or_else(|| job.created_at.clone()),
            });
        }
    }

    if let Some(summary) =
        document_summaries::get_by_document_id(connection, &document.document_id)?
    {
        artifacts.push(DocumentArtifactDto {
            artifact_id: summary.summary_id,
            document_id: summary.document_id,
            kind: "ai_summary".to_string(),
            title: "AI 总结".to_string(),
            file_path: None,
            content_preview: Some(summary_preview(&summary.content_md)),
            provider: Some(summary.provider),
            model: Some(summary.model),
            file_size: None,
            created_at: summary.created_at,
            updated_at: summary.updated_at,
        });
    }

    artifacts.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.kind.cmp(&right.kind))
    });

    Ok(artifacts)
}

/// 统计文档的翻译与总结产物数量。
pub fn count_artifacts_for_document(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<ArtifactCount> {
    let translation_count = if let Some(job) =
        translation_jobs::find_latest_completed_for_document(connection, document_id, None, None)?
    {
        let artifacts = translation_artifacts::list_by_job(connection, &job.job_id)?;
        artifacts
            .into_iter()
            .filter(|artifact| {
                matches!(
                    artifact.artifact_kind.as_str(),
                    "translated_pdf" | "bilingual_pdf"
                )
            })
            .count() as u32
    } else {
        0
    };

    let has_summary = document_summaries::get_by_document_id(connection, document_id)?.is_some();

    Ok(ArtifactCount {
        has_translation: translation_count > 0,
        translation_count,
        has_summary,
    })
}

fn translation_title(kind: &str) -> &'static str {
    match kind {
        "translated_pdf" => "翻译 PDF",
        "bilingual_pdf" => "双语对照 PDF",
        _ => "翻译产物",
    }
}

fn summary_preview(content_md: &str) -> String {
    content_md.chars().take(100).collect()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use chrono::Utc;
    use rusqlite::params;

    use crate::{
        models::{ArtifactKind, DocumentSourceType},
        storage::{
            document_summaries, documents, translation_artifacts, translation_jobs, Storage,
        },
    };

    use super::{list_artifacts_for_document, AppErrorCode};

    #[test]
    fn list_artifacts_for_document_aggregates_supported_sources() {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let workspace_dir = temp_dir("artifact-aggregator");
        let original_pdf = workspace_dir.join("paper.pdf");
        let translated_pdf = workspace_dir.join("translated.pdf");
        fs::write(&original_pdf, b"original").unwrap();
        fs::write(&translated_pdf, b"translated").unwrap();
        let timestamp = Utc::now().to_rfc3339();

        let document = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: original_pdf.to_string_lossy().into_owned(),
                    file_sha256: "sha-doc".to_string(),
                    title: "Attention Is All You Need".to_string(),
                    page_count: 10,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap()
        };

        let job = {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document.document_id.clone(),
                    engine_job_id: Some("engine-1".to_string()),
                    cache_key: "cache-1".to_string(),
                    provider: "openai".to_string(),
                    model: "gpt-4o".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "completed".to_string(),
                    stage: "completed".to_string(),
                    progress: 100.0,
                    created_at: timestamp.clone(),
                },
            )
            .unwrap()
        };

        {
            let connection = storage.connection();
            translation_jobs::update_status(
                &connection,
                &job.job_id,
                "completed",
                "completed",
                100.0,
                None,
                None,
                Some(&timestamp),
                Some(&timestamp),
            )
            .unwrap();
            translation_artifacts::create(
                &connection,
                &translation_artifacts::CreateTranslationArtifactParams {
                    job_id: job.job_id.clone(),
                    document_id: document.document_id.clone(),
                    artifact_kind: ArtifactKind::TranslatedPdf.as_str().to_string(),
                    file_path: translated_pdf.to_string_lossy().into_owned(),
                    file_sha256: "sha-translated".to_string(),
                    file_size_bytes: 10,
                    created_at: timestamp.clone(),
                },
            )
            .unwrap();
            document_summaries::upsert_summary(
                &connection,
                &document.document_id,
                &"A".repeat(120),
                "openai",
                "gpt-4o",
            )
            .unwrap();
        }

        let connection = storage.connection();
        let artifacts = list_artifacts_for_document(&connection, &document.document_id).unwrap();
        let kinds = artifacts
            .iter()
            .map(|artifact| artifact.kind.as_str())
            .collect::<Vec<_>>();

        assert!(kinds.contains(&"original_pdf"));
        assert!(kinds.contains(&"translated_pdf"));
        assert!(kinds.contains(&"ai_summary"));

        let summary = artifacts
            .iter()
            .find(|artifact| artifact.kind == "ai_summary")
            .unwrap();
        assert_eq!(summary.provider.as_deref(), Some("openai"));
        assert_eq!(summary.model.as_deref(), Some("gpt-4o"));
        assert_eq!(
            summary.content_preview.as_ref().unwrap().chars().count(),
            100
        );
    }

    #[test]
    fn list_artifacts_for_document_errors_when_document_is_missing() {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let connection = storage.connection();
        let error = list_artifacts_for_document(&connection, "missing").unwrap_err();

        assert_eq!(error.code, AppErrorCode::DocumentNotFound);
    }

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
