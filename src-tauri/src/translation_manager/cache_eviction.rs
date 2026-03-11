use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use crate::{
    errors::AppError,
    storage::{documents, translation_artifacts, translation_jobs, Storage},
};

pub const MAX_CACHE_SIZE_BYTES: u64 = 500 * 1024 * 1024;

#[derive(Debug, Clone)]
struct CacheCandidate {
    job_id: String,
    last_opened_at: String,
    recency_marker: String,
    total_size_bytes: u64,
    artifact_paths: Vec<PathBuf>,
    cache_dirs: Vec<PathBuf>,
}

pub fn evict_if_needed_excluding(
    storage: &Storage,
    protected_job_id: Option<&str>,
) -> Result<(), AppError> {
    evict_if_needed_with_limit(storage, protected_job_id, MAX_CACHE_SIZE_BYTES)
}

fn evict_if_needed_with_limit(
    storage: &Storage,
    protected_job_id: Option<&str>,
    max_cache_size_bytes: u64,
) -> Result<(), AppError> {
    let candidates = load_candidates(storage)?;
    let mut current_size = candidates
        .iter()
        .map(|candidate| candidate.total_size_bytes)
        .sum::<u64>();

    if current_size <= max_cache_size_bytes {
        return Ok(());
    }

    for candidate in candidates {
        if current_size <= max_cache_size_bytes {
            break;
        }

        if protected_job_id.is_some_and(|job_id| job_id == candidate.job_id.as_str()) {
            continue;
        }

        evict_candidate(storage, &candidate)?;
        current_size = current_size.saturating_sub(candidate.total_size_bytes);
    }

    Ok(())
}

fn load_candidates(storage: &Storage) -> Result<Vec<CacheCandidate>, AppError> {
    let connection = storage.connection();
    let jobs = translation_jobs::list_completed(&connection)?;
    let mut candidates = Vec::with_capacity(jobs.len());

    for job in jobs {
        let Some(document) = documents::get_by_id(&connection, &job.document_id)? else {
            continue;
        };
        let artifacts = translation_artifacts::list_by_job(&connection, &job.job_id)?;
        if artifacts.is_empty() {
            continue;
        }

        let artifact_paths = artifacts
            .iter()
            .map(|artifact| PathBuf::from(&artifact.file_path))
            .collect::<Vec<_>>();
        let cache_dirs = unique_parent_dirs(&artifact_paths);
        let total_size_bytes = artifacts
            .iter()
            .map(|artifact| artifact.file_size_bytes)
            .sum();
        let recency_marker = job.finished_at.clone().unwrap_or(job.created_at.clone());

        candidates.push(CacheCandidate {
            job_id: job.job_id,
            last_opened_at: document.last_opened_at,
            recency_marker,
            total_size_bytes,
            artifact_paths,
            cache_dirs,
        });
    }

    candidates.sort_by(|left, right| {
        left.last_opened_at
            .cmp(&right.last_opened_at)
            .then_with(|| left.recency_marker.cmp(&right.recency_marker))
    });

    Ok(candidates)
}

fn unique_parent_dirs(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut directories = Vec::new();

    for path in paths {
        let Some(parent) = path.parent() else {
            continue;
        };
        let parent = parent.to_path_buf();
        if !directories
            .iter()
            .any(|existing: &PathBuf| existing == &parent)
        {
            directories.push(parent);
        }
    }

    directories
}

fn evict_candidate(storage: &Storage, candidate: &CacheCandidate) -> Result<(), AppError> {
    if candidate.cache_dirs.is_empty() {
        for artifact_path in &candidate.artifact_paths {
            remove_file_if_exists(artifact_path)?;
        }
    } else {
        for cache_dir in &candidate.cache_dirs {
            remove_dir_if_exists(cache_dir)?;
            if let Some(document_dir) = cache_dir.parent() {
                remove_dir_if_empty(document_dir)?;
            }
        }
    }

    let connection = storage.connection();
    translation_jobs::delete_by_id(&connection, &candidate.job_id)?;
    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotADirectory => remove_file_if_exists(path),
        Err(error) => Err(AppError::from(error)),
    }
}

fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error)),
    }
}

fn remove_dir_if_empty(path: &Path) -> Result<(), AppError> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(AppError::from(error)),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use chrono::Utc;

    use crate::{
        models::{ArtifactKind, DocumentSourceType},
        storage::{documents, translation_artifacts, translation_jobs, Storage},
    };

    use super::evict_if_needed_with_limit;

    #[test]
    fn evicts_oldest_completed_cache_first() {
        let storage = Storage::new_in_memory().expect("in-memory storage should initialize");
        let base_dir = temp_dir("cache-eviction-test");
        let old_pdf = write_cache_artifact(&base_dir, "sha-old", "cache-old", "translated.pdf", 6);
        let new_pdf = write_cache_artifact(&base_dir, "sha-new", "cache-new", "translated.pdf", 5);

        let old_job_id = seed_completed_job(
            &storage,
            "/tmp/old.pdf",
            "sha-old",
            "2026-01-01T00:00:00Z",
            &old_pdf,
        );
        let new_job_id = seed_completed_job(
            &storage,
            "/tmp/new.pdf",
            "sha-new",
            "2026-03-11T00:00:00Z",
            &new_pdf,
        );

        evict_if_needed_with_limit(&storage, None, 8).expect("eviction should succeed");

        assert!(!old_pdf.exists(), "oldest cache artifact should be removed");
        assert!(
            new_pdf.exists(),
            "newest cache artifact should be preserved"
        );

        let connection = storage.connection();
        assert!(
            translation_jobs::get_by_id(&connection, &old_job_id)
                .expect("old job lookup")
                .is_none(),
            "oldest job should be deleted from storage"
        );
        assert!(
            translation_jobs::get_by_id(&connection, &new_job_id)
                .expect("new job lookup")
                .is_some(),
            "newest job should remain in storage"
        );
    }

    fn seed_completed_job(
        storage: &Storage,
        file_path: &str,
        file_sha256: &str,
        last_opened_at: &str,
        artifact_path: &Path,
    ) -> String {
        let timestamp = Utc::now().to_rfc3339();

        let document_id = {
            let connection = storage.connection();
            let document = documents::upsert(
                &connection,
                &documents::UpsertDocumentParams {
                    file_path: file_path.to_string(),
                    file_sha256: file_sha256.to_string(),
                    title: file_sha256.to_string(),
                    page_count: 1,
                    source_type: DocumentSourceType::Local,
                    zotero_item_key: None,
                    timestamp: last_opened_at.to_string(),
                },
            )
            .expect("document should insert");
            document.document_id
        };

        let job = {
            let connection = storage.connection();
            translation_jobs::create(
                &connection,
                &translation_jobs::CreateTranslationJobParams {
                    document_id: document_id.clone(),
                    engine_job_id: Some(format!("engine-{file_sha256}")),
                    cache_key: format!("cache-{file_sha256}"),
                    provider: "openai".to_string(),
                    model: "gpt-4o-mini".to_string(),
                    source_lang: "en".to_string(),
                    target_lang: "zh-CN".to_string(),
                    status: "queued".to_string(),
                    stage: "queued".to_string(),
                    progress: 0.0,
                    created_at: timestamp.clone(),
                },
            )
            .expect("job should insert")
        };

        {
            let connection = storage.connection();
            translation_jobs::update_status(
                &connection,
                &job.job_id,
                "completed",
                "completed",
                1.0,
                None,
                None,
                Some(&timestamp),
                Some(&timestamp),
            )
            .expect("job should mark completed");
            translation_artifacts::create(
                &connection,
                &translation_artifacts::CreateTranslationArtifactParams {
                    job_id: job.job_id.clone(),
                    document_id,
                    artifact_kind: ArtifactKind::TranslatedPdf.as_str().to_string(),
                    file_path: artifact_path.to_string_lossy().to_string(),
                    file_sha256: format!("sha-{file_sha256}"),
                    file_size_bytes: fs::metadata(artifact_path)
                        .expect("artifact metadata")
                        .len(),
                    created_at: timestamp,
                },
            )
            .expect("artifact should insert");
        }

        job.job_id
    }

    fn write_cache_artifact(
        base_dir: &Path,
        document_sha: &str,
        cache_key: &str,
        filename: &str,
        size: usize,
    ) -> PathBuf {
        let path = base_dir.join(document_sha).join(cache_key).join(filename);
        fs::create_dir_all(path.parent().expect("artifact dir should exist"))
            .expect("cache artifact dir should exist");
        fs::write(&path, vec![b'a'; size]).expect("artifact should write");
        path
    }

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be monotonic enough")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("temp dir should exist");
        dir
    }
}
