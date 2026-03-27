use std::{
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::{
    errors::{AppError, AppErrorCode},
    ipc::translation::TranslationJobDto,
    models::ArtifactKind,
    storage::{translation_artifacts, translation_jobs, Storage},
};

use super::http_client::EngineJobResult;

#[derive(Clone)]
pub struct CacheKeyInput {
    pub document_sha256: String,
    pub provider: String,
    pub model: String,
    pub source_lang: String,
    pub target_lang: String,
    pub output_mode: String,
    pub figure_translation: bool,
    pub skip_reference_pages: bool,
    pub base_url: Option<String>,
    pub custom_prompt: Option<String>,
}

#[derive(Clone)]
pub struct TranslationArtifactIndex {
    cache_root: PathBuf,
}

impl TranslationArtifactIndex {
    pub fn new(data_dir: &Path) -> Result<Self, AppError> {
        let cache_root = data_dir.join("cache").join("translations");
        fs::create_dir_all(&cache_root)?;
        Ok(Self { cache_root })
    }

    pub fn compute_cache_key(&self, input: &CacheKeyInput) -> String {
        let mut hasher = Sha256::new();
        for segment in [
            input.document_sha256.as_str(),
            input.provider.as_str(),
            input.model.as_str(),
            input.source_lang.as_str(),
            input.target_lang.as_str(),
            input.output_mode.as_str(),
            if input.figure_translation {
                "figure:1"
            } else {
                "figure:0"
            },
            if input.skip_reference_pages {
                "skip_ref:1"
            } else {
                "skip_ref:0"
            },
            input.base_url.as_deref().unwrap_or_default(),
            input.custom_prompt.as_deref().unwrap_or_default(),
        ] {
            hasher.update(segment.as_bytes());
            hasher.update(b"\0");
        }

        format!("sha256:{:x}", hasher.finalize())
    }

    pub fn output_dir(&self, document_sha256: &str, cache_key: &str) -> PathBuf {
        self.cache_root
            .join(document_sha256)
            .join(cache_key.replace(':', "-"))
    }

    pub fn dto_from_record_basic(
        &self,
        record: translation_jobs::TranslationJobRecord,
    ) -> TranslationJobDto {
        build_job_dto(record, None, None, None)
    }

    pub fn dto_from_record_if_completed(
        &self,
        storage: &Storage,
        record: translation_jobs::TranslationJobRecord,
    ) -> Result<TranslationJobDto, AppError> {
        if record.status == "completed" {
            return self.dto_from_record(storage, record);
        }

        Ok(self.dto_from_record_basic(record))
    }

    pub fn dto_from_record(
        &self,
        storage: &Storage,
        record: translation_jobs::TranslationJobRecord,
    ) -> Result<TranslationJobDto, AppError> {
        let artifacts = {
            let connection = storage.connection();
            translation_artifacts::list_by_job(&connection, &record.job_id)?
        };

        let translated_pdf_path = artifact_path(&artifacts, ArtifactKind::TranslatedPdf.as_str());
        let bilingual_pdf_path = artifact_path(&artifacts, ArtifactKind::BilingualPdf.as_str());
        let figure_report_path = artifact_path(&artifacts, ArtifactKind::FigureReport.as_str());

        Ok(build_job_dto(
            record,
            translated_pdf_path,
            bilingual_pdf_path,
            figure_report_path,
        ))
    }

    pub fn validate_completed_record(
        &self,
        storage: &Storage,
        record: &translation_jobs::TranslationJobRecord,
    ) -> Result<(), AppError> {
        let artifacts = {
            let connection = storage.connection();
            translation_artifacts::list_by_job(&connection, &record.job_id)?
        };

        if artifacts.is_empty() {
            return Err(AppError::new(
                AppErrorCode::CacheCorrupted,
                "翻译缓存缺少产物索引，无法恢复",
                false,
            )
            .with_detail("jobId", record.job_id.clone()));
        }

        for artifact in artifacts {
            let path = Path::new(&artifact.file_path);
            if !path.is_absolute() || !path.exists() {
                return Err(AppError::new(
                    AppErrorCode::CacheCorrupted,
                    "翻译缓存产物缺失或路径非法，需要重新生成",
                    false,
                )
                .with_detail("jobId", record.job_id.clone())
                .with_detail("artifactKind", artifact.artifact_kind)
                .with_detail("artifactPath", artifact.file_path));
            }
        }

        Ok(())
    }

    pub fn persist_result(
        &self,
        storage: &Storage,
        job_id: &str,
        document_id: &str,
        result: &EngineJobResult,
        timestamp: &str,
    ) -> Result<(), AppError> {
        for (kind, path) in [
            (
                ArtifactKind::TranslatedPdf,
                result.translated_pdf_path.as_deref(),
            ),
            (
                ArtifactKind::BilingualPdf,
                result.bilingual_pdf_path.as_deref(),
            ),
            (
                ArtifactKind::FigureReport,
                result.figure_report_path.as_deref(),
            ),
            (ArtifactKind::Manifest, result.manifest_path.as_deref()),
        ] {
            let Some(path) = path else {
                continue;
            };

            let artifact_path = Path::new(path);
            if !artifact_path.is_absolute() || !artifact_path.exists() {
                return Err(AppError::new(
                    AppErrorCode::TranslationFailed,
                    "translation-engine 返回了非法产物路径",
                    false,
                )
                .with_detail("artifactKind", kind.as_str())
                .with_detail("artifactPath", path.to_string()));
            }

            let metadata = fs::metadata(artifact_path)?;
            let file_sha256 = compute_sha256(artifact_path)?;

            let connection = storage.connection();
            translation_artifacts::create(
                &connection,
                &translation_artifacts::CreateTranslationArtifactParams {
                    job_id: job_id.to_string(),
                    document_id: document_id.to_string(),
                    artifact_kind: kind.as_str().to_string(),
                    file_path: path.to_string(),
                    file_sha256,
                    file_size_bytes: metadata.len(),
                    created_at: timestamp.to_string(),
                },
            )?;
        }

        Ok(())
    }
}

fn artifact_path(
    artifacts: &[translation_artifacts::TranslationArtifactRecord],
    kind: &str,
) -> Option<String> {
    artifacts
        .iter()
        .find(|artifact| artifact.artifact_kind == kind)
        .map(|artifact| artifact.file_path.clone())
}

fn build_job_dto(
    record: translation_jobs::TranslationJobRecord,
    translated_pdf_path: Option<String>,
    bilingual_pdf_path: Option<String>,
    figure_report_path: Option<String>,
) -> TranslationJobDto {
    TranslationJobDto {
        job_id: record.job_id,
        document_id: record.document_id,
        engine_job_id: record.engine_job_id,
        status: record.status,
        stage: record.stage,
        progress: normalize_progress(record.progress),
        provider: record.provider,
        model: record.model,
        translated_pdf_path,
        bilingual_pdf_path,
        figure_report_path,
        error_code: record.error_code,
        error_message: record.error_message,
        created_at: record.created_at,
        started_at: record.started_at,
        finished_at: record.finished_at,
    }
}

fn compute_sha256(path: &Path) -> Result<String, AppError> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

pub fn normalize_progress(progress: f64) -> f64 {
    if progress.is_nan() {
        return 0.0;
    }

    if progress > 1.0 {
        return (progress / 100.0).clamp(0.0, 1.0);
    }

    progress.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use chrono::Utc;

    use crate::{
        errors::AppErrorCode,
        models::DocumentSourceType,
        storage::{documents, translation_jobs, Storage},
        translation_manager::http_client::EngineJobResult,
    };

    use super::{normalize_progress, CacheKeyInput, TranslationArtifactIndex};

    #[test]
    fn cache_key_changes_when_model_changes() {
        let index = TranslationArtifactIndex::new(std::path::Path::new("/tmp"))
            .expect("cache root should initialize");
        let first = index.compute_cache_key(&CacheKeyInput {
            document_sha256: "sha-doc".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4.1-mini".to_string(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            output_mode: "bilingual".to_string(),
            figure_translation: true,
            skip_reference_pages: true,
            base_url: None,
            custom_prompt: None,
        });
        let second = index.compute_cache_key(&CacheKeyInput {
            model: "gpt-4.1".to_string(),
            ..CacheKeyInput {
                document_sha256: "sha-doc".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4.1-mini".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                output_mode: "bilingual".to_string(),
                figure_translation: true,
                skip_reference_pages: true,
                base_url: None,
                custom_prompt: None,
            }
        });

        assert_ne!(first, second);
    }

    #[test]
    fn normalize_progress_accepts_engine_percent_values() {
        assert!((normalize_progress(56.0) - 0.56).abs() < f64::EPSILON);
        assert!((normalize_progress(0.56) - 0.56).abs() < f64::EPSILON);
    }

    #[test]
    fn validate_completed_record_reports_cache_corruption_when_artifacts_are_missing() {
        let storage = Storage::new_in_memory().unwrap();
        let record = seed_completed_job(&storage);
        let cache_root = temp_dir("artifact-index-validate");
        let index = TranslationArtifactIndex::new(&cache_root).unwrap();

        let error = index
            .validate_completed_record(&storage, &record)
            .expect_err("missing artifact index should be treated as corruption");

        assert_eq!(error.code, AppErrorCode::CacheCorrupted);
        assert_eq!(
            error.details.as_ref().unwrap()["jobId"],
            serde_json::json!(record.job_id)
        );
    }

    #[test]
    fn persist_result_rejects_nonexistent_relative_artifact_paths() {
        let storage = Storage::new_in_memory().unwrap();
        let record = seed_completed_job(&storage);
        let cache_root = temp_dir("artifact-index-persist");
        let index = TranslationArtifactIndex::new(&cache_root).unwrap();

        let error = index
            .persist_result(
                &storage,
                &record.job_id,
                &record.document_id,
                &EngineJobResult {
                    translated_pdf_path: Some("translated.pdf".to_string()),
                    bilingual_pdf_path: None,
                    figure_report_path: None,
                    manifest_path: None,
                },
                "2026-03-11T10:00:00Z",
            )
            .expect_err("relative artifact path should be rejected");

        assert_eq!(error.code, AppErrorCode::TranslationFailed);
        assert_eq!(
            error.details.as_ref().unwrap()["artifactKind"],
            serde_json::json!("translated_pdf")
        );
    }

    fn seed_completed_job(storage: &Storage) -> translation_jobs::TranslationJobRecord {
        let timestamp = Utc::now().to_rfc3339();
        let document_id = {
            let connection = storage.connection();
            documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: "/tmp/demo.pdf".to_string(),
                    file_sha256: "sha-demo".to_string(),
                    title: "Demo".to_string(),
                    page_count: 3,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: timestamp.clone(),
                },
            )
            .unwrap()
            .document_id
        };

        let connection = storage.connection();
        translation_jobs::create(
            &connection,
            &translation_jobs::CreateTranslationJobParams {
                document_id,
                engine_job_id: Some("engine-1".to_string()),
                cache_key: "sha256:cache".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4o-mini".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                status: "completed".to_string(),
                stage: "completed".to_string(),
                progress: 1.0,
                created_at: timestamp,
            },
        )
        .unwrap()
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
