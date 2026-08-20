use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Failed attempts allowed from one address before it is locked out.
const MAX_ATTEMPTS: u32 = 5;
/// Base lockout duration; doubles on each subsequent lockout for the address.
const BASE_LOCKOUT: Duration = Duration::from_secs(30);
/// Upper bound on the escalating lockout.
const MAX_LOCKOUT: Duration = Duration::from_secs(15 * 60);
/// Idle period after which an authenticated session is dropped.
pub const SESSION_IDLE: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
struct AttemptRecord {
    failures: u32,
    lockouts: u32,
    locked_until: Option<Instant>,
}

/// Shared application state passed to every WebSocket handler.
pub struct AppState {
    /// The pairing PIN generated at startup.
    pub pin: String,
    /// Failed-attempt bookkeeping, keyed by client address.
    attempts: Mutex<HashMap<String, AttemptRecord>>,
}

impl AppState {
    pub fn new(pin: String) -> Self {
        Self {
            pin,
            attempts: Mutex::new(HashMap::new()),
        }
    }

    /// Time remaining before `address` may attempt again, if locked out.
    pub fn retry_after(&self, address: &str) -> Option<Duration> {
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        let record = attempts.get(address)?;
        let locked_until = record.locked_until?;
        let now = Instant::now();
        if locked_until > now {
            Some(locked_until - now)
        } else {
            // Lockout elapsed — drop the timer but keep the escalation count.
            if let Some(r) = attempts.get_mut(address) {
                r.locked_until = None;
            }
            None
        }
    }

    /// Record a failed attempt.
    ///
    /// Returns the lockout duration just applied, or `None` if attempts remain.
    pub fn record_failure(&self, address: &str) -> Option<Duration> {
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        let record = attempts.entry(address.to_string()).or_default();
        record.failures += 1;

        if record.failures < MAX_ATTEMPTS {
            return None;
        }

        let lockout = BASE_LOCKOUT
            .saturating_mul(2u32.saturating_pow(record.lockouts.min(16)))
            .min(MAX_LOCKOUT);
        record.lockouts += 1;
        record.failures = 0;
        record.locked_until = Some(Instant::now() + lockout);
        Some(lockout)
    }

    /// Clear all failure state for an address after a successful auth.
    pub fn record_success(&self, address: &str) {
        self.attempts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(address);
    }
}

/// Compare two strings without an early exit on the first differing byte, so
/// timing does not reveal how many leading digits were correct.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Number of digits in a generated pairing PIN.
pub const PIN_DIGITS: usize = 6;

/// Generate a zero-padded 6-digit PIN, e.g. "004217".
///
/// Six digits rather than four: combined with attempt throttling this puts an
/// exhaustive search well out of reach for a LAN attacker.
pub fn generate_pin() -> String {
    format!(
        "{:0width$}",
        rand::random_range(0..1_000_000u32),
        width = PIN_DIGITS
    )
}
