#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};

pub const MAX_QUEUED_JOBS: usize = 3;

#[derive(Clone)]
pub struct PendingTranslationRequest {
    pub document_id: String,
    pub pdf_path: String,
    pub output_dir: String,
    pub cache_key: String,
    pub source_lang: String,
    pub target_lang: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub output_mode: String,
    pub figure_translation: bool,
    pub skip_reference_pages: bool,
    pub force_refresh: bool,
}

#[derive(Clone)]
pub struct ManagedJobSnapshot {
    pub request: PendingTranslationRequest,
    pub engine_job_id: Option<String>,
    pub cancel_requested: bool,
}

struct ManagedJob {
    request: PendingTranslationRequest,
    engine_job_id: Option<String>,
    cancel_requested: bool,
}

#[derive(Default)]
pub struct JobRegistry {
    active_job_id: Option<String>,
    queue: VecDeque<String>,
    queued_ids: HashSet<String>,
    cache_key_index: HashMap<String, String>,
    jobs: HashMap<String, ManagedJob>,
    worker_running: bool,
}

impl JobRegistry {
    pub fn queue_len(&self) -> usize {
        self.queue.len()
    }

    pub fn active_job_id(&self) -> Option<&str> {
        self.active_job_id.as_deref()
    }

    pub fn inflight_job_for_cache_key(&self, cache_key: &str) -> Option<String> {
        self.cache_key_index.get(cache_key).cloned()
    }

    pub fn remove_cache_key_mapping(&mut self, cache_key: &str, job_id: &str) {
        if self
            .cache_key_index
            .get(cache_key)
            .is_some_and(|value| value == job_id)
        {
            self.cache_key_index.remove(cache_key);
        }
    }

    pub fn register(&mut self, job_id: String, request: PendingTranslationRequest) {
        self.cache_key_index
            .insert(request.cache_key.clone(), job_id.clone());
        self.queued_ids.insert(job_id.clone());
        self.queue.push_back(job_id.clone());
        self.jobs.insert(
            job_id,
            ManagedJob {
                request,
                engine_job_id: None,
                cancel_requested: false,
            },
        );
    }

    pub fn try_mark_worker_running(&mut self) -> bool {
        if self.worker_running {
            return false;
        }

        self.worker_running = true;
        true
    }

    pub fn mark_worker_idle(&mut self) {
        self.worker_running = false;
    }

    pub fn dequeue_next(&mut self) -> Option<String> {
        while let Some(job_id) = self.queue.pop_front() {
            self.queued_ids.remove(&job_id);
            if self.jobs.contains_key(&job_id) {
                self.active_job_id = Some(job_id.clone());
                return Some(job_id);
            }
        }

        self.active_job_id = None;
        None
    }

    pub fn snapshot(&self, job_id: &str) -> Option<ManagedJobSnapshot> {
        self.jobs.get(job_id).map(|job| ManagedJobSnapshot {
            request: job.request.clone(),
            engine_job_id: job.engine_job_id.clone(),
            cancel_requested: job.cancel_requested,
        })
    }

    pub fn set_engine_job_id(&mut self, job_id: &str, engine_job_id: Option<String>) {
        if let Some(job) = self.jobs.get_mut(job_id) {
            job.engine_job_id = engine_job_id;
        }
    }

    pub fn cancel_queued(&mut self, job_id: &str) -> bool {
        if !self.queued_ids.remove(job_id) {
            return false;
        }

        self.queue.retain(|queued_id| queued_id != job_id);

        if let Some(job) = self.jobs.remove(job_id) {
            self.remove_cache_key_mapping(&job.request.cache_key, job_id);
        }

        true
    }

    pub fn mark_cancel_requested(&mut self, job_id: &str) -> Option<Option<String>> {
        self.jobs.get_mut(job_id).map(|job| {
            job.cancel_requested = true;
            job.engine_job_id.clone()
        })
    }

    pub fn finish(&mut self, job_id: &str) {
        if self.active_job_id.as_deref() == Some(job_id) {
            self.active_job_id = None;
        }

        if let Some(job) = self.jobs.remove(job_id) {
            self.remove_cache_key_mapping(&job.request.cache_key, job_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{JobRegistry, PendingTranslationRequest};

    fn sample_request(cache_key: &str) -> PendingTranslationRequest {
        PendingTranslationRequest {
            document_id: "doc-1".to_string(),
            pdf_path: "/tmp/a.pdf".to_string(),
            output_dir: "/tmp/out".to_string(),
            cache_key: cache_key.to_string(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: "sk-test".to_string(),
            base_url: None,
            output_mode: "bilingual".to_string(),
            figure_translation: true,
            skip_reference_pages: true,
            force_refresh: false,
        }
    }

    #[test]
    fn cancel_queued_job_removes_cache_key_mapping() {
        let mut registry = JobRegistry::default();
        registry.register("job-1".to_string(), sample_request("cache-1"));

        assert_eq!(
            registry.inflight_job_for_cache_key("cache-1").as_deref(),
            Some("job-1")
        );
        assert!(registry.cancel_queued("job-1"));
        assert!(registry.inflight_job_for_cache_key("cache-1").is_none());
    }
}
