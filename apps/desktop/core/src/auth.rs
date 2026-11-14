//! Device sign-in and where its token is kept.
//!
//! Raphie's web host signs native clients in with the OAuth device flow
//! (`docs/authentication.md`, "Connect a native device"): the app asks for a
//! code, the owner approves it in a browser where they are already signed in,
//! and the app polls until it receives its own revocable bearer token.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::origin::Origin;

/// The client id the web host accepts for first-party native devices.
pub const CLIENT_ID: &str = "raphie-native";

/// A bearer token. It is a credential: it never appears in `Debug` output,
/// has no `Display`, and is only read when building a request header.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken(String);

impl AccessToken {
    pub fn new(value: String) -> AccessToken {
        AccessToken(value)
    }

    /// The raw value, for the `Authorization` header and the credential store
    /// only. Keep the call sites few and obvious.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AccessToken(<redacted>)")
    }
}

/// A secret the owner typed, such as a provider's API key, on its way to the
/// host. Like [`AccessToken`] it never appears in `Debug` output, so a
/// command that carries one can be logged or compared in a test safely.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    /// The raw value, for the request body only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// What the owner needs to approve this device.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceCode {
    /// The short code shown on both the device and the approval page.
    pub user_code: String,
    /// The approval page, with the code already filled in.
    pub verification_url: String,
    /// Seconds until the code expires.
    pub expires_in: u64,
}

/// One answer from the token endpoint, already interpreted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DevicePoll {
    /// The owner has not decided yet: poll again after the interval.
    Pending,
    /// Polling too fast: the interval grows by five seconds (RFC 8628 §3.5).
    SlowDown,
    Granted(AccessToken),
    Denied,
    Expired,
}

/// Polling rules. The web host requires at least five seconds between polls;
/// tests shorten this so they do not sleep.
#[derive(Clone, Copy, Debug)]
pub struct DevicePolicy {
    pub min_interval: Duration,
    pub slow_down_step: Duration,
}

impl Default for DevicePolicy {
    fn default() -> DevicePolicy {
        DevicePolicy {
            min_interval: Duration::from_secs(5),
            slow_down_step: Duration::from_secs(5),
        }
    }
}

impl DevicePolicy {
    /// The first wait: the server's interval, but never below the minimum.
    pub fn initial_interval(&self, server_seconds: u64) -> Duration {
        Duration::from_secs(server_seconds).max(self.min_interval)
    }

    /// The wait after an answer.
    pub fn next_interval(&self, current: Duration, answer: &DevicePoll) -> Duration {
        match answer {
            DevicePoll::SlowDown => current + self.slow_down_step,
            _ => current,
        }
    }
}

/// Somewhere to keep one token per origin.
///
/// A trait lets the engine use the OS credential store in the app and an
/// in-memory map in tests. `Send + Sync` because the store is shared with
/// background threads; `&self` (not `&mut self`) because implementations
/// handle their own locking.
pub trait TokenStore: Send + Sync {
    fn load(&self, origin: &Origin) -> Result<Option<AccessToken>, StoreError>;
    fn save(&self, origin: &Origin, token: &AccessToken) -> Result<(), StoreError>;
    fn delete(&self, origin: &Origin) -> Result<(), StoreError>;
}

#[derive(Debug, thiserror::Error)]
#[error("The system credential store is unavailable: {0}")]
pub struct StoreError(pub String);

/// The operating system's credential store: the login Keychain on macOS,
/// Credential Manager on Windows and the Secret Service on Linux.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    pub fn new() -> KeychainStore {
        KeychainStore {
            service: "dev.raphie.desktop".to_owned(),
        }
    }

    fn entry(&self, origin: &Origin) -> Result<keyring::Entry, StoreError> {
        // One entry per origin, so a fixture sign-in never replaces the real one.
        keyring::Entry::new(&self.service, origin.as_str()).map_err(store_error)
    }
}

impl Default for KeychainStore {
    fn default() -> KeychainStore {
        KeychainStore::new()
    }
}

impl TokenStore for KeychainStore {
    fn load(&self, origin: &Origin) -> Result<Option<AccessToken>, StoreError> {
        match self.entry(origin)?.get_password() {
            Ok(value) => Ok(Some(AccessToken::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(store_error(error)),
        }
    }

    fn save(&self, origin: &Origin, token: &AccessToken) -> Result<(), StoreError> {
        self.entry(origin)?
            .set_password(token.expose())
            .map_err(store_error)
    }

    fn delete(&self, origin: &Origin) -> Result<(), StoreError> {
        match self.entry(origin)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(store_error(error)),
        }
    }
}

// The keyring error's text names the platform failure; it never contains the
// secret, which is why it is safe to show.
fn store_error(error: keyring::Error) -> StoreError {
    StoreError(error.to_string())
}

/// An in-memory store for tests and headless runs.
///
/// `Arc<Mutex<..>>`: `Arc` lets clones share one map across threads, and the
/// `Mutex` makes changing it from several threads safe. Cloning the store
/// clones the handle, not the map.
#[derive(Clone, Default)]
pub struct MemoryStore {
    tokens: Arc<Mutex<HashMap<String, AccessToken>>>,
}

impl MemoryStore {
    pub fn new() -> MemoryStore {
        MemoryStore::default()
    }
}

impl TokenStore for MemoryStore {
    fn load(&self, origin: &Origin) -> Result<Option<AccessToken>, StoreError> {
        // `lock()` fails only if another thread panicked while holding the
        // lock; the map is still usable, so take it either way.
        let tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        Ok(tokens.get(origin.as_str()).cloned())
    }

    fn save(&self, origin: &Origin, token: &AccessToken) -> Result<(), StoreError> {
        let mut tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        tokens.insert(origin.as_str().to_owned(), token.clone());
        Ok(())
    }

    fn delete(&self, origin: &Origin) -> Result<(), StoreError> {
        let mut tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        tokens.remove(origin.as_str());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_never_print() {
        let token = AccessToken::new("secret-value".into());
        assert_eq!(format!("{token:?}"), "AccessToken(<redacted>)");
        assert!(!format!("{:?}", Some(token)).contains("secret"));
        let key = Secret::new("sk-secret-value");
        assert_eq!(format!("{key:?}"), "Secret(<redacted>)");
        assert_eq!(key.expose(), "sk-secret-value");
    }

    #[test]
    fn polling_respects_the_minimum_and_slows_down() {
        let policy = DevicePolicy::default();
        assert_eq!(policy.initial_interval(1), Duration::from_secs(5));
        assert_eq!(policy.initial_interval(8), Duration::from_secs(8));
        let slower = policy.next_interval(Duration::from_secs(5), &DevicePoll::SlowDown);
        assert_eq!(slower, Duration::from_secs(10));
        let same = policy.next_interval(slower, &DevicePoll::Pending);
        assert_eq!(same, Duration::from_secs(10));
    }

    #[test]
    fn memory_store_keeps_one_token_per_origin() {
        let store = MemoryStore::new();
        let a = Origin::parse("http://127.0.0.1:4321").unwrap();
        let b = Origin::parse("https://raphie.example").unwrap();
        store.save(&a, &AccessToken::new("one".into())).unwrap();
        assert_eq!(store.load(&b).unwrap(), None);
        assert_eq!(store.load(&a).unwrap().unwrap().expose(), "one");
        store.delete(&a).unwrap();
        assert_eq!(store.load(&a).unwrap(), None);
    }
}
