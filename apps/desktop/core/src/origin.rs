//! The web host origin the app talks to, checked once when the owner types it.
//!
//! The desktop app is a client of the web host (for example
//! `https://raphie.tailnet.ts.net` or `http://127.0.0.1:4321` for the test
//! fixture), never of the runtime on port 4316. Plain HTTP is only accepted
//! on loopback: a bearer token must not cross a network unencrypted.

use std::fmt;

use url::Url;

/// A validated `scheme://host[:port]` with no path, query or credentials.
///
/// Holding an `Origin` proves the check ran, so the rest of the code never
/// re-validates strings. This "parse, don't validate" newtype is a common Rust
/// pattern: the constructor is the only way in.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Origin {
    /// Normalised form, e.g. `https://raphie.example.ts.net`.
    serialized: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OriginError {
    #[error("Enter an address such as https://raphie.your-tailnet.ts.net.")]
    Invalid,
    #[error("Use https://, or http:// only for 127.0.0.1 or localhost.")]
    InsecureRemote,
    #[error("Enter only the address, without a path, query or user name.")]
    NotAnOrigin,
}

impl Origin {
    pub fn parse(input: &str) -> Result<Origin, OriginError> {
        let url = Url::parse(input.trim()).map_err(|_| OriginError::Invalid)?;
        let host = url.host_str().ok_or(OriginError::Invalid)?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !matches!(url.path(), "" | "/")
        {
            return Err(OriginError::NotAnOrigin);
        }
        match url.scheme() {
            "https" => {}
            "http" if is_loopback(host) => {}
            "http" => return Err(OriginError::InsecureRemote),
            _ => return Err(OriginError::Invalid),
        }
        Ok(Origin {
            serialized: url.origin().ascii_serialization(),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.serialized
    }

    /// An absolute URL for a path on this origin. `path` must start with `/`.
    pub fn url(&self, path: &str) -> String {
        debug_assert!(path.starts_with('/'), "paths are absolute: {path}");
        format!("{}{}", self.serialized, path)
    }

    /// True when `url` points at this exact origin (same scheme, host and port).
    pub fn owns(&self, url: &str) -> bool {
        Url::parse(url).is_ok_and(|u| u.origin().ascii_serialization() == self.serialized)
    }
}

impl fmt::Display for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.serialized)
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_loopback_http() {
        assert_eq!(
            Origin::parse("https://raphie.tail1234.ts.net/")
                .unwrap()
                .as_str(),
            "https://raphie.tail1234.ts.net"
        );
        assert_eq!(
            Origin::parse(" http://127.0.0.1:4321 ").unwrap().as_str(),
            "http://127.0.0.1:4321"
        );
        assert!(Origin::parse("http://localhost:4320").is_ok());
        assert!(Origin::parse("http://[::1]:4320").is_ok());
    }

    #[test]
    fn rejects_plain_http_off_loopback() {
        assert_eq!(
            Origin::parse("http://raphie.tail1234.ts.net"),
            Err(OriginError::InsecureRemote)
        );
        assert_eq!(
            Origin::parse("http://192.168.1.4:4320"),
            Err(OriginError::InsecureRemote)
        );
    }

    #[test]
    fn rejects_paths_credentials_and_junk() {
        assert_eq!(
            Origin::parse("https://h/api"),
            Err(OriginError::NotAnOrigin)
        );
        assert_eq!(
            Origin::parse("https://u:p@h"),
            Err(OriginError::NotAnOrigin)
        );
        assert_eq!(
            Origin::parse("https://h/?x=1"),
            Err(OriginError::NotAnOrigin)
        );
        assert_eq!(Origin::parse("raphie"), Err(OriginError::Invalid));
        assert_eq!(Origin::parse("ftp://h"), Err(OriginError::Invalid));
    }

    #[test]
    fn owns_only_the_same_origin() {
        let origin = Origin::parse("https://raphie.example").unwrap();
        assert!(origin.owns("https://raphie.example/device?user_code=ABCD"));
        assert!(!origin.owns("https://evil.example/device"));
        assert!(!origin.owns("http://raphie.example/device"));
        assert!(!origin.owns("https://raphie.example:8443/device"));
    }
}
