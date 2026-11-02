//! 19-b: supervise the local Heybe service (which in turn owns the FastClaw gateway).
//!
//! - Random port (service binds 127.0.0.1:0 and reports it on a READY line).
//! - Random 256-bit startup token, handed to the UI only via the `service_info` command.
//! - Health check + restart with backoff (0.5 s .. 8 s, so a crash is back within 10 s).
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
const READY_TIMEOUT: Duration = Duration::from_secs(45);
const HEALTH_EVERY: Duration = Duration::from_secs(2);
const HEALTH_FAILS: u32 = 3;
const STABLE_AFTER: Duration = Duration::from_secs(30);

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
}

struct Inner {
    status: Status,
    port: Option<u16>,
    restarts: u32,
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
            inner: Arc::new(Mutex::new(Inner { status: Status::Starting, port: None, restarts: 0 })),
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
        }
    }

    fn set(&self, status: Status, port: Option<u16>) {
        let mut i = self.inner.lock().unwrap();
        i.status = status;
        i.port = port;
    }

    fn spawn_once(&self, cmd: &str) -> Result<(Running, u16), String> {
        let mut child = Command::new("/bin/sh")
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
            .map_err(|e| format!("spawn failed: {e}"))?;
        let pgid = child.id() as i32;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(port) = parse_ready(&line) {
                        let _ = tx.send(port);
                        sent = true;
                    }
                }
                // keep draining so the child never blocks on a full pipe
            }
        });
        let running = Running { child, pgid, _stdin: stdin };
        match rx.recv_timeout(READY_TIMEOUT) {
            Ok(port) => Ok((running, port)),
            Err(_) => {
                running.stop();
                Err("service did not report READY".into())
            }
        }
    }

    pub fn start(&self) {
        let me = self.clone();
        thread::spawn(move || me.run());
    }

    fn run(&self) {
        let Some(cmd) = service_command() else {
            eprintln!("heybe: no HEYBE_SERVICE_CMD set and no bundled service (19-h)");
            self.set(Status::Failed, None);
            return;
        };
        let mut attempt: u32 = 0;
        while !self.shutdown.load(Ordering::SeqCst) {
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
                            fails = if health_ok(port) { 0 } else { fails + 1 };
                        }
                        if dead || fails >= HEALTH_FAILS {
                            eprintln!("heybe: service {}; restarting", if dead { "exited" } else { "unhealthy" });
                            if let Some(r) = self.current.lock().unwrap().take() {
                                r.stop();
                            }
                            break;
                        }
                    }
                    if started.elapsed() > STABLE_AFTER {
                        attempt = 0;
                    }
                }
                Err(e) => eprintln!("heybe: {e}"),
            }
            if self.shutdown.load(Ordering::SeqCst) {
                return;
            }
            {
                let mut i = self.inner.lock().unwrap();
                i.status = Status::Reconnecting;
                i.port = None;
                i.restarts += 1;
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
    fn backoff_within_10s() {
        let total: Duration = (0..3).map(backoff).sum();
        assert!(backoff(10) <= Duration::from_secs(8));
        assert!(total < Duration::from_secs(10));
    }

    #[test]
    fn token_is_random_hex() {
        let a = random_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_token());
    }
}
