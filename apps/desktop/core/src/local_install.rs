//! A Raphie installed for this user on this computer.
//!
//! The installer (`scripts/install.sh`) puts Raphie in `~/.local/lib/raphie`
//! and saves its ports in `.ports` there, as `runtime=24316` and
//! `web=24320` lines. The web port is where this app connects. Reading it
//! lets the app find Raphie on this Mac by itself, whatever port it was
//! installed on.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::origin::Origin;

/// The web port of a new installation (`DEFAULT_PORTS` in
/// `scripts/user-install-ports.ts`).
pub const DEFAULT_WEB_PORT: u16 = 24320;

/// How long to wait for a local Raphie to answer. It is on loopback, so a
/// running one answers at once.
const CHECK_TIMEOUT: Duration = Duration::from_secs(2);

/// `~/.local/lib/raphie/.ports`, where the installer saves the ports.
pub fn ports_file() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".local/lib/raphie/.ports"))
}

/// The address of this user's installed Raphie: the saved web port, or the
/// default one when nothing was saved (or the file can't be read).
pub fn origin_at(ports_file: Option<&Path>) -> Origin {
    let saved = ports_file
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| web_port(&text));
    let port = saved.unwrap_or(DEFAULT_WEB_PORT);
    // A loopback address with a valid port always parses.
    Origin::parse(&format!("http://127.0.0.1:{port}")).expect("a loopback origin")
}

/// The `web=` line of a ports file, when it holds a usable port.
fn web_port(text: &str) -> Option<u16> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("web="))
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
}

/// Whether a Raphie web host answers at `origin`: up, with or without an
/// administrator yet ("ready" or "locked").
pub async fn answers(origin: &Origin) -> bool {
    let Ok(http) = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return false;
    };
    let Ok(response) = http.get(origin.url("/_raphie/health")).send().await else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    #[derive(serde::Deserialize)]
    struct Health {
        status: String,
    }
    response
        .json::<Health>()
        .await
        .is_ok_and(|health| matches!(health.status.as_str(), "ready" | "locked"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_saved_web_port_is_used_and_anything_else_falls_back() {
        let dir = std::env::temp_dir().join(format!("raphie-ports-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(".ports");
        std::fs::write(&file, "runtime=25016\nweb=25020\n").unwrap();
        assert_eq!(origin_at(Some(&file)).as_str(), "http://127.0.0.1:25020");
        // No file, no web line, a privileged or a nonsense port: the default.
        for text in ["runtime=25016\n", "web=80\n", "web=lots\n", "web=70000\n"] {
            std::fs::write(&file, text).unwrap();
            assert_eq!(origin_at(Some(&file)).as_str(), "http://127.0.0.1:24320");
        }
        assert_eq!(
            origin_at(Some(&dir.join("missing"))).as_str(),
            "http://127.0.0.1:24320"
        );
        assert_eq!(origin_at(None).as_str(), "http://127.0.0.1:24320");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
