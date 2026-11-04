//! 19-b: supervise the local Heybe service (which in turn owns the FastClaw gateway).
//!
//! - Random port (service binds 127.0.0.1:0 and reports it on a READY line).
//! - Random 256-bit startup token, handed to the UI only via the `service_info` command.
//! - Health check + restart with backoff (0.5 s .. 8 s, so a crash is back within 10 s).
//!   Health is only judged after the READY line, with a grace period until the first OK.
//! - The service reports startup failures as `HEYBE_SERVICE_ERROR {"code","message","retryable"}`.
//!   Non-retryable ones (port taken / foreign or mismatched FastClaw) stop the loop at once;
//!   otherwise we give up after MAX_START_FAILURES unstable runs in a row. Both end in
//!   `failed` with a readable `error` for the UI instead of restarting forever.
//! - The service runs in its own process group; quit kills the whole group (service,
//!   pnpm/tsx wrappers, gateway) so nothing is left behind (19-c).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

const READY_PREFIX: &str = "HEYBE_SERVICE_READY ";
const ERROR_PREFIX: &str = "HEYBE_SERVICE_ERROR ";
/// Service start (pnpm + tsx) + FastClaw gateway READY (30 s in the service) must fit in here.
const READY_TIMEOUT_DEFAULT: Duration = Duration::from_secs(60);
const HEALTH_EVERY: Duration = Duration::from_secs(2);
const HEALTH_FAILS: u32 = 3;
/// Before the first OK health check, failures only count after this long.
const HEALTH_GRACE: Duration = Duration::from_secs(10);
const STABLE_AFTER: Duration = Duration::from_secs(30);
/// Give up after this many unstable runs (failed start, or died within STABLE_AFTER) in a row.
pub const MAX_START_FAILURES: u32 = 5;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Starting,
    Ready,
    Reconnecting,
    Failed,
}

#[derive(Clone, Serialize)]
pub struct ServiceInfo {
    pub status: Status,
    pub url: Option<String>,
    pub token: String,
    pub restarts: u32,
    /// Readable reason when status is `failed` (or the last restart reason otherwise).
    pub error: Option<String>,
}

struct Inner {
    status: Status,
    port: Option<u16>,
    restarts: u32,
    error: Option<String>,
}

/// One line of interest on the service's stdout.
#[derive(Debug, PartialEq)]
pub enum ServiceLine {
    Ready(u16),
    Error { code: String, message: String, retryable: bool },
}

#[derive(Debug, PartialEq)]
pub struct StartError {
    pub message: String,
    pub retryable: bool,
}

enum Event {
    Line(ServiceLine),
    Eof,
}

#[derive(Clone)]
pub struct Supervisor {
    token: Arc<String>,
    inner: Arc<Mutex<Inner>>,
    shutdown: Arc<AtomicBool>,
    current: Arc<Mutex<Option<Running>>>,
}

struct Running {
    child: Child,
    pgid: i32,
    _stdin: Option<ChildStdin>,
}

/// Where the service keeps tasks and chat turns (#19 part 2: closing the window or quitting must
/// not lose them). `HEYBE_TASK_DB` from the environment wins; otherwise
/// `~/Library/Application Support/Heybe/heybe-tasks.db`, directory created 0700.
pub fn task_db_path(env_value: Option<&str>, home: Option<&str>) -> Option<std::path::PathBuf> {
    if let Some(v) = env_value.map(str::trim).filter(|v| !v.is_empty()) {
        return Some(std::path::PathBuf::from(v));
    }
    let home = home.map(str::trim).filter(|h| h.starts_with('/'))?;
    Some(std::path::Path::new(home).join("Library/Application Support/Heybe/heybe-tasks.db"))
}

fn ensure_private_dir(db: &std::path::Path) -> bool {
    use std::os::unix::fs::DirBuilderExt;
    match db.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => {
            std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).is_ok()
        }
        _ => true,
    }
}

fn random_token() -> String {
    let mut buf = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .expect("read /dev/urandom");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// `HEYBE_SERVICE_CMD` (shell command) or, in dev builds, `pnpm -C <repo>/services/task-manager start`.
fn service_command() -> Option<String> {
    if let Ok(cmd) = std::env::var("HEYBE_SERVICE_CMD") {
        if !cmd.trim().is_empty() {
            return Some(cmd);
        }
    }
    if cfg!(debug_assertions) {
        let repo = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
        return Some(format!("exec pnpm --silent -C '{repo}/services/task-manager' start"));
    }
    None // release sidecar bundling is 19-h
}

pub fn parse_ready(line: &str) -> Option<u16> {
    let json = line.strip_prefix(READY_PREFIX)?;
    let v: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let port = v.get("port")?.as_u64()?;
    u16::try_from(port).ok().filter(|p| *p > 0)
}

pub fn parse_line(line: &str) -> Option<ServiceLine> {
    if let Some(port) = parse_ready(line) {
        return Some(ServiceLine::Ready(port));
    }
    let json = line.strip_prefix(ERROR_PREFIX)?;
    let v: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let message = v.get("message")?.as_str()?.chars().take(600).collect::<String>();
    Some(ServiceLine::Error {
        code: v.get("code").and_then(|c| c.as_str()).unwrap_or("E_SERVICE_START").to_string(),
        message,
        retryable: v.get("retryable").and_then(|r| r.as_bool()).unwrap_or(true),
    })
}

/// `HEYBE_SERVICE_READY_TIMEOUT_MS` (milliseconds, > 0) or the default.
pub fn ready_timeout(raw: Option<&str>) -> Duration {
    raw.and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .map(Duration::from_millis)
        .unwrap_or(READY_TIMEOUT_DEFAULT)
}

/// Does a failed health check count? Not before the first OK, until the grace period is over.
pub fn health_failure_counts(ever_ok: bool, since_ready: Duration) -> bool {
    ever_ok || since_ready >= HEALTH_GRACE
}

/// Stop restarting after this many unstable runs in a row.
pub fn give_up(consecutive_failures: u32) -> bool {
    consecutive_failures >= MAX_START_FAILURES
}

/// Backoff before restart attempt `n` (0-based): 0.5, 1, 2, 4, 8, 8, ... seconds.
pub fn backoff(n: u32) -> Duration {
    Duration::from_millis(500u64.saturating_mul(1u64 << n.min(4)))
}

fn health_ok(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    if s.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut head = [0u8; 12];
    s.read_exact(&mut head).is_ok() && head.starts_with(b"HTTP/1.1 200")
}

fn kill_group(pgid: i32, signal: &str) {
    let _ = Command::new("/bin/kill")
        .args([signal, "--", &format!("-{pgid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

impl Running {
    /// SIGTERM the group, wait up to 4 s, then SIGKILL the group.
    fn stop(mut self) {
        self._stdin.take();
        kill_group(self.pgid, "-TERM");
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        // Even if the leader exited, stragglers (gateway) may remain in the group.
        thread::sleep(Duration::from_millis(300));
        kill_group(self.pgid, "-KILL");
        let _ = self.child.wait();
    }
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            token: Arc::new(random_token()),
            inner: Arc::new(Mutex::new(Inner { status: Status::Starting, port: None, restarts: 0, error: None })),
            shutdown: Arc::new(AtomicBool::new(false)),
            current: Arc::new(Mutex::new(None)),
        }
    }

    pub fn info(&self) -> ServiceInfo {
        let i = self.inner.lock().unwrap();
        ServiceInfo {
            status: i.status.clone(),
            url: i.port.filter(|_| i.status == Status::Ready).map(|p| format!("http://127.0.0.1:{p}")),
            token: self.token.to_string(),
            restarts: i.restarts,
            error: i.error.clone(),
        }
    }

    fn set(&self, status: Status, port: Option<u16>) {
        let mut i = self.inner.lock().unwrap();
        if status == Status::Ready {
            i.error = None;
        }
        i.status = status;
        i.port = port;
    }

    fn fail(&self, message: String) {
        eprintln!("heybe: {message}");
        let mut i = self.inner.lock().unwrap();
        i.status = Status::Failed;
        i.port = None;
        i.error = Some(message);
    }

    fn spawn_once(&self, cmd: &str) -> Result<(Running, u16), StartError> {
        let mut command = Command::new("/bin/sh");
        let db = task_db_path(std::env::var("HEYBE_TASK_DB").ok().as_deref(), std::env::var("HOME").ok().as_deref());
        match db {
            Some(path) if ensure_private_dir(&path) => {
                command.env("HEYBE_TASK_DB", path);
            }
            // No usable location: the service falls back to an in-memory DB (lost on quit).
            _ => eprintln!("heybe: no writable HEYBE_TASK_DB location; chat history is kept in memory only"),
        }
        let mut child = command
            .arg("-c")
            .arg(cmd)
            .env("HEYBE_SERVICE_TOKEN", self.token.as_str())
            .env("HEYBE_SERVICE_PORT", "0")
            .env("HEYBE_SERVICE_WATCH_STDIN", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .process_group(0)
            .spawn()
            .map_err(|e| StartError { message: format!("本地服务启动失败：{e}"), retryable: true })?;
        let pgid = child.id() as i32;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(ev) = parse_line(&line) {
                        let _ = tx.send(Event::Line(ev));
                        sent = true;
                    }
                }
                // keep draining so the child never blocks on a full pipe
            }
            let _ = tx.send(Event::Eof);
        });
        let running = Running { child, pgid, _stdin: stdin };
        let timeout = ready_timeout(std::env::var("HEYBE_SERVICE_READY_TIMEOUT_MS").ok().as_deref());
        match rx.recv_timeout(timeout) {
            Ok(Event::Line(ServiceLine::Ready(port))) => Ok((running, port)),
            Ok(Event::Line(ServiceLine::Error { code, message, retryable })) => {
                running.stop();
                Err(StartError { message: format!("{message}（{code}）"), retryable })
            }
            Ok(Event::Eof) => {
                running.stop();
                Err(StartError { message: "本地服务没打出 READY 就退出了（详见终端输出）".into(), retryable: true })
            }
            Err(_) => {
                running.stop();
                Err(StartError {
                    message: format!("service did not report READY：本地服务 {} 秒内没有就绪", timeout.as_secs()),
                    retryable: true,
                })
            }
        }
    }

    pub fn start(&self) {
        let me = self.clone();
        thread::spawn(move || me.run());
    }

    fn run(&self) {
        let Some(cmd) = service_command() else {
            self.fail("no HEYBE_SERVICE_CMD set and no bundled service (19-h)".into());
            return;
        };
        let mut attempt: u32 = 0;
        let mut failures: u32 = 0;
        while !self.shutdown.load(Ordering::SeqCst) {
            let mut stable = false;
            let last_error: String;
            match self.spawn_once(&cmd) {
                Ok((running, port)) => {
                    if self.shutdown.load(Ordering::SeqCst) {
                        running.stop();
                        return;
                    }
                    let started = Instant::now();
                    *self.current.lock().unwrap() = Some(running);
                    eprintln!("heybe: service ready on 127.0.0.1:{port}");
                    self.set(Status::Ready, Some(port));
                    let mut fails = 0;
                    let mut ever_ok = false;
                    let mut last_check = Instant::now();
                    loop {
                        thread::sleep(Duration::from_millis(200));
                        if self.shutdown.load(Ordering::SeqCst) {
                            return;
                        }
                        let dead = match self.current.lock().unwrap().as_mut() {
                            Some(r) => matches!(r.child.try_wait(), Ok(Some(_))),
                            None => return,
                        };
                        if !dead && last_check.elapsed() >= HEALTH_EVERY {
                            last_check = Instant::now();
                            if health_ok(port) {
                                ever_ok = true;
                                fails = 0;
                            } else if health_failure_counts(ever_ok, started.elapsed()) {
                                fails += 1;
                            }
                        }
                        if dead || fails >= HEALTH_FAILS {
                            eprintln!("heybe: service {}; restarting", if dead { "exited" } else { "unhealthy" });
                            if let Some(r) = self.current.lock().unwrap().take() {
                                r.stop();
                            }
                            break;
                        }
                    }
                    last_error = if fails >= HEALTH_FAILS {
                        format!("本地服务健康检查连续 {HEALTH_FAILS} 次失败")
                    } else {
                        "本地服务意外退出".to_string()
                    };
                    if started.elapsed() > STABLE_AFTER {
                        attempt = 0;
                        stable = true;
                    }
                }
                Err(e) => {
                    if !e.retryable {
                        // Port taken / foreign or mismatched FastClaw: restarting cannot help.
                        self.fail(e.message);
                        return;
                    }
                    eprintln!("heybe: {}", e.message);
                    last_error = e.message;
                }
            }
            if self.shutdown.load(Ordering::SeqCst) {
                return;
            }
            failures = if stable { 0 } else { failures + 1 };
            if give_up(failures) {
                self.fail(format!("本地服务连续 {failures} 次启动失败，已停止重试：{last_error}。请查看终端输出后退出重开 Heybe"));
                return;
            }
            {
                let mut i = self.inner.lock().unwrap();
                i.status = Status::Reconnecting;
                i.port = None;
                i.restarts += 1;
                i.error = Some(last_error);
            }
            thread::sleep(backoff(attempt));
            attempt += 1;
        }
    }

    /// Quit: stop the service group (service + gateway). Blocks up to ~5 s.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(r) = self.current.lock().unwrap().take() {
            r.stop();
        }
        self.set(Status::Failed, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_line() {
        assert_eq!(parse_ready("HEYBE_SERVICE_READY {\"port\":4123}"), Some(4123));
        assert_eq!(parse_ready("HEYBE_SERVICE_READY {\"port\":0}"), None);
        assert_eq!(parse_ready("noise"), None);
    }

    #[test]
    fn error_line() {
        let l = r#"HEYBE_SERVICE_ERROR {"code":"E_FC_FOREIGN_GATEWAY","message":"端口 18963 上已经有","retryable":false}"#;
        assert_eq!(
            parse_line(l),
            Some(ServiceLine::Error {
                code: "E_FC_FOREIGN_GATEWAY".into(),
                message: "端口 18963 上已经有".into(),
                retryable: false
            })
        );
        assert_eq!(parse_line("HEYBE_SERVICE_READY {\"port\":4123}"), Some(ServiceLine::Ready(4123)));
        assert_eq!(parse_line("HEYBE_SERVICE_ERROR not json"), None);
        // missing retryable defaults to retry
        assert!(matches!(
            parse_line(r#"HEYBE_SERVICE_ERROR {"message":"x"}"#),
            Some(ServiceLine::Error { retryable: true, .. })
        ));
    }

    #[test]
    fn ready_timeout_env() {
        assert_eq!(ready_timeout(None), READY_TIMEOUT_DEFAULT);
        assert_eq!(ready_timeout(Some("1500")), Duration::from_millis(1500));
        assert_eq!(ready_timeout(Some("0")), READY_TIMEOUT_DEFAULT);
        assert_eq!(ready_timeout(Some("abc")), READY_TIMEOUT_DEFAULT);
        // must leave room for the service's own 30 s gateway READY wait
        assert!(READY_TIMEOUT_DEFAULT > Duration::from_secs(30));
    }

    #[test]
    fn health_grace_before_first_ok() {
        assert!(!health_failure_counts(false, Duration::from_secs(2)));
        assert!(health_failure_counts(false, HEALTH_GRACE));
        assert!(health_failure_counts(true, Duration::from_secs(1)));
    }

    #[test]
    fn gives_up_after_n() {
        assert!(!give_up(MAX_START_FAILURES - 1));
        assert!(give_up(MAX_START_FAILURES));
    }

    #[test]
    fn backoff_within_10s() {
        let total: Duration = (0..3).map(backoff).sum();
        assert!(backoff(10) <= Duration::from_secs(8));
        assert!(total < Duration::from_secs(10));
    }

    #[test]
    fn task_db_location() {
        assert_eq!(
            task_db_path(None, Some("/Users/a")).unwrap(),
            std::path::PathBuf::from("/Users/a/Library/Application Support/Heybe/heybe-tasks.db")
        );
        assert_eq!(task_db_path(Some(" /tmp/x.db "), Some("/Users/a")).unwrap(), std::path::PathBuf::from("/tmp/x.db"));
        assert_eq!(task_db_path(Some(""), None), None);
        assert_eq!(task_db_path(None, Some("relative")), None);
    }

    #[test]
    fn private_dir_is_0700() {
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("heybe-db-test-{}", std::process::id()));
        let db = base.join("a/b/heybe-tasks.db");
        assert!(ensure_private_dir(&db));
        let mode = std::fs::metadata(db.parent().unwrap()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn token_is_random_hex() {
        let a = random_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_token());
    }
}
