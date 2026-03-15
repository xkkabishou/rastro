use std::{
    fs::{self, OpenOptions},
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

use chrono::Utc;
use parking_lot::Mutex as ParkingMutex;
use tokio::{sync::Mutex, time::sleep};

use crate::{
    errors::{AppError, AppErrorCode},
    ipc::translation::TranslationEngineStatus,
};

use super::http_client::{HealthzResponse, TranslationHttpClient};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CIRCUIT_WINDOW: Duration = Duration::from_secs(5 * 60);
const BACKOFF_SEQUENCE: [Duration; 3] = [
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(180),
];

#[derive(Clone)]
pub struct EngineSupervisor {
    inner: Arc<EngineSupervisorInner>,
}

struct EngineSupervisorInner {
    host: String,
    port: u16,
    runtime_dir: PathBuf,
    status: Arc<ParkingMutex<TranslationEngineStatus>>,
    http_client: TranslationHttpClient,
    state: Mutex<EngineSupervisorState>,
}

struct EngineSupervisorState {
    child: Option<Child>,
    breaker: CircuitBreakerState,
    shutting_down: bool,
}

#[derive(Default)]
struct CircuitBreakerState {
    recent_failures: Vec<Instant>,
    open_until: Option<Instant>,
    backoff_index: usize,
}

impl EngineSupervisor {
    pub fn new(
        host: String,
        port: u16,
        data_dir: PathBuf,
        status: Arc<ParkingMutex<TranslationEngineStatus>>,
        http_client: TranslationHttpClient,
    ) -> Result<Self, AppError> {
        let runtime_dir = data_dir.join("runtime");
        fs::create_dir_all(&runtime_dir)?;

        status.lock().port = port;

        Ok(Self {
            inner: Arc::new(EngineSupervisorInner {
                host,
                port,
                runtime_dir,
                status,
                http_client,
                state: Mutex::new(EngineSupervisorState {
                    child: None,
                    breaker: CircuitBreakerState::default(),
                    shutting_down: false,
                }),
            }),
        })
    }

    pub fn port(&self) -> u16 {
        self.inner.port
    }

    pub async fn refresh_status(&self) -> TranslationEngineStatus {
        let _ = self.reap_exited_child(false).await;
        let now = Instant::now();
        let health = match self.inner.http_client.healthz().await {
            Ok(health) if valid_health_signature(&health) => Some(health),
            _ => None,
        };
        let (pid, circuit_breaker_open) = {
            let mut state = self.inner.state.lock().await;
            state.breaker.purge(now);
            (
                state.child.as_ref().map(Child::id),
                state.breaker.is_open(now),
            )
        };

        let status = TranslationEngineStatus {
            running: health.is_some(),
            pid,
            port: self.inner.port,
            engine_version: health
                .as_ref()
                .and_then(|value| value.engine_version.clone()),
            circuit_breaker_open,
            last_health_check: Some(Utc::now().to_rfc3339()),
        };

        self.write_status(status.clone());
        status
    }

    pub async fn ensure_started(&self, force: bool) -> Result<TranslationEngineStatus, AppError> {
        self.reap_exited_child(false).await?;

        if let Ok(health) = self.inner.http_client.healthz().await {
            if valid_health_signature(&health) {
                let status = self.status_from_health(Some(health)).await;
                return Ok(status);
            }
        }

        if self.port_in_use() {
            return Err(AppError::new(
                AppErrorCode::EnginePortConflict,
                format!(
                    "端口 {} 已被未知进程占用，无法启动 translation-engine",
                    self.inner.port
                ),
                false,
            )
            .with_detail("port", self.inner.port));
        }

        {
            let mut state = self.inner.state.lock().await;
            let now = Instant::now();
            state.breaker.purge(now);
            if force {
                state.breaker.reset();
            } else if let Some(open_until) = state.breaker.open_until {
                if open_until > now {
                    let status = TranslationEngineStatus {
                        running: false,
                        pid: state.child.as_ref().map(Child::id),
                        port: self.inner.port,
                        engine_version: None,
                        circuit_breaker_open: true,
                        last_health_check: Some(Utc::now().to_rfc3339()),
                    };
                    self.write_status(status);
                    return Err(AppError::new(
                        AppErrorCode::EngineUnavailable,
                        "translation-engine 当前处于熔断冷却期，请稍后重试或使用 force 覆盖",
                        true,
                    )
                    .with_detail("cooldownUntil", open_until_duration_string(open_until, now)));
                }
            }
        }

        let python = self.preflight_python()?;
        let child = self.spawn_child(&python)?;
        {
            let mut state = self.inner.state.lock().await;
            state.child = Some(child);
            state.shutting_down = false;
        }

        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if let Ok(health) = self.inner.http_client.healthz().await {
                if valid_health_signature(&health) {
                    let status = self.status_from_health(Some(health)).await;
                    let mut state = self.inner.state.lock().await;
                    state.breaker.reset();
                    return Ok(status);
                }
            }

            if Instant::now() >= deadline {
                let _ = self.terminate_tracked_child(false).await;
                self.record_runtime_failure().await;
                let status = TranslationEngineStatus {
                    running: false,
                    pid: None,
                    port: self.inner.port,
                    engine_version: None,
                    circuit_breaker_open: self.is_circuit_open().await,
                    last_health_check: Some(Utc::now().to_rfc3339()),
                };
                self.write_status(status);
                return Err(AppError::new(
                    AppErrorCode::EngineTimeout,
                    "translation-engine 启动超时，15 秒内未通过健康检查",
                    true,
                ));
            }

            sleep(HEALTH_POLL_INTERVAL).await;
        }
    }

    pub async fn shutdown(&self, force: bool) -> Result<TranslationEngineStatus, AppError> {
        self.reap_exited_child(true).await?;

        if matches!(
            self.inner.http_client.healthz().await,
            Ok(ref health) if valid_health_signature(health)
        ) {
            let _ = self.inner.http_client.shutdown(5).await;
        }

        let mut state = self.inner.state.lock().await;
        state.shutting_down = true;
        drop(state);

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.inner.http_client.healthz().await.is_err() {
                let _ = self.terminate_tracked_child(true).await;
                let status = TranslationEngineStatus {
                    running: false,
                    pid: None,
                    port: self.inner.port,
                    engine_version: None,
                    circuit_breaker_open: self.is_circuit_open().await,
                    last_health_check: Some(Utc::now().to_rfc3339()),
                };
                self.write_status(status.clone());
                return Ok(status);
            }

            if self.try_signal_tracked_child(libc::SIGTERM).await? {
                sleep(Duration::from_millis(250)).await;
            } else {
                break;
            }
        }

        if force {
            let _ = self.try_signal_tracked_child(libc::SIGKILL).await?;
            sleep(Duration::from_secs(1)).await;
        }

        let _ = self.terminate_tracked_child(true).await;
        Ok(self.refresh_status().await)
    }

    pub async fn record_runtime_failure(&self) {
        let mut state = self.inner.state.lock().await;
        state.breaker.record(Instant::now());
        let circuit_open = state.breaker.is_open(Instant::now());
        drop(state);

        let mut status = self.inner.status.lock();
        status.running = false;
        status.pid = None;
        status.engine_version = None;
        status.circuit_breaker_open = circuit_open;
        status.last_health_check = Some(Utc::now().to_rfc3339());
    }

    async fn status_from_health(&self, health: Option<HealthzResponse>) -> TranslationEngineStatus {
        let (pid, circuit_breaker_open) = {
            let mut state = self.inner.state.lock().await;
            state.breaker.purge(Instant::now());
            (
                state.child.as_ref().map(Child::id),
                state.breaker.is_open(Instant::now()),
            )
        };

        let status = TranslationEngineStatus {
            running: health.is_some(),
            pid,
            port: self.inner.port,
            engine_version: health.and_then(|value| value.engine_version),
            circuit_breaker_open,
            last_health_check: Some(Utc::now().to_rfc3339()),
        };
        self.write_status(status.clone());
        status
    }

    async fn terminate_tracked_child(&self, expected_shutdown: bool) -> Result<(), AppError> {
        let child = {
            let mut state = self.inner.state.lock().await;
            state.shutting_down = expected_shutdown;
            state.child.take()
        };

        let Some(mut child) = child else {
            self.cleanup_runtime_markers()?;
            return Ok(());
        };

        if child.try_wait()?.is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.cleanup_runtime_markers()?;
        Ok(())
    }

    async fn reap_exited_child(&self, expected_shutdown: bool) -> Result<(), AppError> {
        let mut record_failure = false;
        {
            let mut state = self.inner.state.lock().await;
            if let Some(child) = state.child.as_mut() {
                if child.try_wait()?.is_some() {
                    state.child = None;
                    if !state.shutting_down && !expected_shutdown {
                        record_failure = true;
                    }
                    state.shutting_down = false;
                }
            }
        }

        if record_failure {
            self.cleanup_runtime_markers()?;
            self.record_runtime_failure().await;
        }

        Ok(())
    }

    /// 推断项目根目录（engine_supervisor 所在 crate 的上两级目录）。
    fn project_root(&self) -> PathBuf {
        // data_dir 通常是 <project>/src-tauri/target/... 的运行时路径，
        // 但更可靠的方式是通过 CARGO_MANIFEST_DIR 编译时嵌入。
        // 运行时回退：从 runtime_dir 向上查找包含 antigravity_translate 的目录。
        if let Ok(root) = std::env::var("RASTRO_PROJECT_ROOT") {
            return PathBuf::from(root);
        }
        // 编译期嵌入的 Cargo.toml 所在目录 (src-tauri/)，取其父级即为项目根
        let cargo_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        cargo_dir.parent().unwrap_or(&cargo_dir).to_path_buf()
    }

    fn preflight_python(&self) -> Result<String, AppError> {
        // 优先使用项目内 .venv 的 Python，自动化零配置
        let project_root = self.project_root();
        let venv_python = project_root.join(".venv").join("bin").join("python3");

        let python = if std::env::var("RASTRO_ENGINE_PYTHON").is_ok() {
            std::env::var("RASTRO_ENGINE_PYTHON").unwrap()
        } else if venv_python.exists() {
            venv_python.to_string_lossy().to_string()
        } else {
            "python3".to_string()
        };

        let version_output = Command::new(&python)
            .arg("--version")
            .output()
            .map_err(|_| {
                AppError::new(
                    AppErrorCode::PythonNotFound,
                    "未找到 Python 3 解释器，请先安装 Python 3.12",
                    false,
                )
            })?;

        let version_text = String::from_utf8_lossy(&version_output.stdout)
            .trim()
            .to_string();
        let version_text = if version_text.is_empty() {
            String::from_utf8_lossy(&version_output.stderr)
                .trim()
                .to_string()
        } else {
            version_text
        };

        if !version_output.status.success() {
            return Err(AppError::new(
                AppErrorCode::PythonNotFound,
                "无法执行 Python 解释器，请检查安装与 PATH 配置",
                false,
            )
            .with_detail("python", python.clone()));
        }

        if !version_is_supported(&version_text) {
            return Err(AppError::new(
                AppErrorCode::PythonVersionMismatch,
                format!("需要 Python 3.12+，当前版本为 {version_text}"),
                false,
            )
            .with_detail("python", python.clone()));
        }

        // 使用 PYTHONPATH 检测模块可用性（模块在项目根目录而非 site-packages）
        let pythonpath = project_root.to_string_lossy().to_string();
        for module_name in ["antigravity_translate", "rastro_translation_engine"] {
            let status = Command::new(&python)
                .env("PYTHONPATH", &pythonpath)
                .args(["-c", &format!("import {module_name}")])
                .status();

            match status {
                Ok(status) if status.success() => {}
                _ => {
                    return Err(AppError::new(
                        AppErrorCode::PdfmathtranslateNotInstalled,
                        format!(
                            "缺少翻译运行依赖 {module_name}，请检查项目目录下是否存在该 Python 包"
                        ),
                        false,
                    )
                    .with_detail("python", python.clone())
                    .with_detail("module", module_name.to_string())
                    .with_detail("pythonpath", pythonpath.clone()));
                }
            }
        }

        Ok(python)
    }

    fn spawn_child(&self, python: &str) -> Result<Child, AppError> {
        let stdout_log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.inner.runtime_dir.join("translation-engine.stdout.log"))?;
        let stderr_log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.inner.runtime_dir.join("translation-engine.log"))?;

        // 设置 PYTHONPATH 指向项目根目录，让子进程能找到
        // antigravity_translate 和 rastro_translation_engine
        let project_root = self.project_root();
        let pythonpath = project_root.to_string_lossy().to_string();

        let mut command = Command::new(python);
        command
            .args([
                "-m",
                "rastro_translation_engine",
                "--host",
                &self.inner.host,
                "--port",
                &self.inner.port.to_string(),
            ])
            .env("PYTHONPATH", &pythonpath)
            .env("RASTRO_ENGINE_HOST", &self.inner.host)
            .env("RASTRO_ENGINE_PORT", self.inner.port.to_string())
            .stdout(Stdio::from(stdout_log))
            .stderr(Stdio::from(stderr_log));

        let child = command.spawn().map_err(|error| {
            AppError::new(
                AppErrorCode::EngineUnavailable,
                format!("启动 translation-engine 失败: {error}"),
                true,
            )
            .with_detail("python", python.to_string())
        })?;

        fs::write(
            self.inner.runtime_dir.join("translation-engine.pid"),
            child.id().to_string(),
        )?;
        Ok(child)
    }

    fn port_in_use(&self) -> bool {
        // 不使用 TcpListener::bind 检测，因为 macOS 上 TIME_WAIT 状态的端口
        // 会导致 bind 失败（误判为"被占用"）。
        // 改用 TcpStream::connect_timeout：只有真正在监听的进程才能接受连接。
        // TIME_WAIT 端口虽然 bind 会失败，但 connect 不会成功。
        let addr = std::net::SocketAddr::from((
            self.inner
                .host
                .parse::<std::net::IpAddr>()
                .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            self.inner.port,
        ));
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
    }

    async fn is_circuit_open(&self) -> bool {
        let state = self.inner.state.lock().await;
        state.breaker.is_open(Instant::now())
    }

    async fn try_signal_tracked_child(&self, signal: i32) -> Result<bool, AppError> {
        #[cfg(unix)]
        {
            let pid = {
                let state = self.inner.state.lock().await;
                state.child.as_ref().map(Child::id)
            };

            if let Some(pid) = pid {
                let rc = unsafe { libc::kill(pid as i32, signal) };
                if rc != 0 {
                    return Err(AppError::internal(format!(
                        "向 translation-engine 发送信号失败: {}",
                        std::io::Error::last_os_error()
                    )));
                }
                return Ok(true);
            }
        }

        #[cfg(not(unix))]
        {
            let _ = signal;
        }

        Ok(false)
    }

    fn write_status(&self, status: TranslationEngineStatus) {
        *self.inner.status.lock() = status;
    }

    fn cleanup_runtime_markers(&self) -> Result<(), AppError> {
        let pid_file = self.inner.runtime_dir.join("translation-engine.pid");
        if pid_file.exists() {
            fs::remove_file(pid_file)?;
        }
        Ok(())
    }
}

impl CircuitBreakerState {
    fn purge(&mut self, now: Instant) {
        self.recent_failures
            .retain(|failure| now.duration_since(*failure) <= CIRCUIT_WINDOW);

        if self.open_until.is_some_and(|deadline| deadline <= now) {
            self.open_until = None;
        }
    }

    fn record(&mut self, now: Instant) {
        self.purge(now);
        self.recent_failures.push(now);
        if self.recent_failures.len() >= 3 {
            let backoff = BACKOFF_SEQUENCE[self.backoff_index.min(BACKOFF_SEQUENCE.len() - 1)];
            self.open_until = Some(now + backoff);
            self.backoff_index = (self.backoff_index + 1).min(BACKOFF_SEQUENCE.len() - 1);
            self.recent_failures.clear();
        }
    }

    fn reset(&mut self) {
        self.recent_failures.clear();
        self.open_until = None;
        self.backoff_index = 0;
    }

    fn is_open(&self, now: Instant) -> bool {
        self.open_until.is_some_and(|deadline| deadline > now)
    }
}

fn version_is_supported(version_text: &str) -> bool {
    let version = version_text
        .split_whitespace()
        .find(|part| {
            part.chars()
                .next()
                .is_some_and(|value| value.is_ascii_digit())
        })
        .unwrap_or_default();
    let mut parts = version.split('.');
    let major = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_default();
    let minor = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_default();

    major > 3 || (major == 3 && minor >= 12)
}

fn open_until_duration_string(open_until: Instant, now: Instant) -> String {
    let remaining = open_until.saturating_duration_since(now).as_secs();
    format!("{remaining}s")
}

fn valid_health_signature(health: &HealthzResponse) -> bool {
    matches!(health.service.as_deref(), Some("translation-engine-system"))
        && health.engine_version.is_some()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        net::TcpListener,
        path::PathBuf,
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    use parking_lot::Mutex as ParkingMutex;

    use crate::{
        errors::AppErrorCode,
        ipc::translation::TranslationEngineStatus,
        translation_manager::http_client::{HealthzResponse, TranslationHttpClient},
    };

    use super::{valid_health_signature, version_is_supported, EngineSupervisor};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn python_version_guard_accepts_312_plus() {
        assert!(version_is_supported("Python 3.12.1"));
        assert!(version_is_supported("Python 3.13.0"));
        assert!(!version_is_supported("Python 3.11.9"));
    }

    #[test]
    fn valid_health_signature_requires_expected_service_and_engine_version() {
        assert!(valid_health_signature(&HealthzResponse {
            status: "ok".to_string(),
            service: Some("translation-engine-system".to_string()),
            version: None,
            engine: None,
            engine_version: Some("1.0.0".to_string()),
            python_version: None,
            uptime_seconds: None,
            queue_depth: None,
            active_job_id: None,
            supported_providers: None,
        }));

        assert!(!valid_health_signature(&HealthzResponse {
            status: "ok".to_string(),
            service: Some("other-service".to_string()),
            version: None,
            engine: None,
            engine_version: Some("1.0.0".to_string()),
            python_version: None,
            uptime_seconds: None,
            queue_depth: None,
            active_job_id: None,
            supported_providers: None,
        }));
    }

    #[tokio::test]
    async fn ensure_started_returns_port_conflict_when_port_is_already_bound() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let supervisor = test_supervisor(port);

        let error = supervisor
            .ensure_started(false)
            .await
            .expect_err("bound port should fail fast");

        assert_eq!(error.code, AppErrorCode::EnginePortConflict);
    }

    #[tokio::test]
    async fn ensure_started_respects_open_circuit_breaker() {
        let port = free_port();
        let supervisor = test_supervisor(port);
        supervisor.record_runtime_failure().await;
        supervisor.record_runtime_failure().await;
        supervisor.record_runtime_failure().await;

        let error = supervisor
            .ensure_started(false)
            .await
            .expect_err("open circuit should block engine start");

        assert_eq!(error.code, AppErrorCode::EngineUnavailable);
        assert!(error.retryable);
    }

    #[cfg(unix)]
    #[test]
    fn preflight_python_reports_missing_binary() {
        let _guard = ENV_LOCK.lock().unwrap();
        let supervisor = test_supervisor(free_port());
        let previous = std::env::var_os("RASTRO_ENGINE_PYTHON");
        std::env::set_var("RASTRO_ENGINE_PYTHON", "/tmp/definitely-missing-python");

        let error = supervisor
            .preflight_python()
            .expect_err("missing interpreter should fail");

        restore_env(previous);
        assert_eq!(error.code, AppErrorCode::PythonNotFound);
    }

    #[cfg(unix)]
    #[test]
    fn preflight_python_reports_version_mismatch() {
        let _guard = ENV_LOCK.lock().unwrap();
        let supervisor = test_supervisor(free_port());
        let previous = std::env::var_os("RASTRO_ENGINE_PYTHON");
        let script = write_fake_python(
            "python-version-mismatch",
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python 3.11.9"
  exit 0
fi
exit 0
"#,
        );
        std::env::set_var("RASTRO_ENGINE_PYTHON", &script);

        let error = supervisor
            .preflight_python()
            .expect_err("unsupported version should fail");

        restore_env(previous);
        assert_eq!(error.code, AppErrorCode::PythonVersionMismatch);
    }

    #[cfg(unix)]
    #[test]
    fn preflight_python_reports_missing_translation_modules() {
        let _guard = ENV_LOCK.lock().unwrap();
        let supervisor = test_supervisor(free_port());
        let previous = std::env::var_os("RASTRO_ENGINE_PYTHON");
        let script = write_fake_python(
            "python-missing-module",
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python 3.12.4"
  exit 0
fi
if [ "$1" = "-c" ]; then
  if [ "$2" = "import pdf2zh" ]; then
    exit 0
  fi
  exit 1
fi
exit 0
"#,
        );
        std::env::set_var("RASTRO_ENGINE_PYTHON", &script);

        let error = supervisor
            .preflight_python()
            .expect_err("missing engine module should fail");

        restore_env(previous);
        assert_eq!(error.code, AppErrorCode::PdfmathtranslateNotInstalled);
    }

    fn test_supervisor(port: u16) -> EngineSupervisor {
        let data_dir = temp_dir("engine-supervisor-test");
        let status = Arc::new(ParkingMutex::new(TranslationEngineStatus {
            running: false,
            pid: None,
            port,
            engine_version: None,
            circuit_breaker_open: false,
            last_health_check: None,
        }));
        let http_client = TranslationHttpClient::new("127.0.0.1", port).unwrap();

        EngineSupervisor::new("127.0.0.1".to_string(), port, data_dir, status, http_client).unwrap()
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
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

    #[cfg(unix)]
    fn write_fake_python(prefix: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_dir(prefix).join("python-shim");
        fs::write(&path, body).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    fn restore_env(previous: Option<std::ffi::OsString>) {
        if let Some(value) = previous {
            std::env::set_var("RASTRO_ENGINE_PYTHON", value);
        } else {
            std::env::remove_var("RASTRO_ENGINE_PYTHON");
        }
    }
}
