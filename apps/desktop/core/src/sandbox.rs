//! Settings → Sandbox: what a save carries, the checks on what was typed,
//! and the sentences that describe a bot's execution provider.
//!
//! The limits are the runtime's (`saveSandboxSettingsSchema` in
//! `packages/runtime/src/domains/workspaces/infrastructure/
//! sandbox-settings.ts`). The runtime still checks everything itself, and
//! its word is final.

use crate::contracts::{SandboxInfo, SandboxProvider};

/// JavaScript's largest exact integer, the runtime's cap on a disk quota.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// One save of a bot's sandbox settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SandboxUpdate {
    pub provider: SandboxProvider,
    /// The owner accepts that a container can reach services on the Raphie
    /// machine and its local network.
    pub host_network_acknowledged: bool,
    pub idle_minutes: u32,
    /// The container's disk limit in MiB; `None` is no limit.
    pub disk_quota_mib: Option<u64>,
    /// The revision these edits started from. The runtime refuses the save
    /// if the settings changed since.
    pub revision: u64,
}

/// The idle minutes from what was typed: a whole number from 1 to 1440.
pub fn parse_idle_minutes(text: &str) -> Option<u32> {
    // `filter` keeps the number only if it is in range.
    text.trim()
        .parse()
        .ok()
        .filter(|minutes| (1..=1440).contains(minutes))
}

/// The disk quota from what was typed. Empty is no limit (`Some(None)`);
/// anything but a positive whole number is `None`.
pub fn parse_disk_quota(text: &str) -> Option<Option<u64>> {
    let text = text.trim();
    if text.is_empty() {
        return Some(None);
    }
    let quota: u64 = text.parse().ok()?;
    (1..=MAX_SAFE_INTEGER)
        .contains(&quota)
        .then_some(Some(quota))
}

/// A size as the web workspace writes it: "512 B", "1.5 KiB", "2.0 MiB".
pub fn bytes(count: u64) -> String {
    // Sizes here are far below 2^53, so the conversion is exact.
    #[allow(clippy::cast_precision_loss)]
    let exact = count as f64;
    if count < 1024 {
        format!("{count} B")
    } else if count < 1024 * 1024 {
        format!("{:.1} KiB", exact / 1024.0)
    } else {
        format!("{:.1} MiB", exact / (1024.0 * 1024.0))
    }
}

/// A count with thousands separators: "12,480".
fn grouped(count: u64) -> String {
    let digits = count.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// The "Files" line under Execution limits: how much is used, of how much.
pub fn files_summary(info: &SandboxInfo) -> String {
    let used = match info.usage.file_bytes {
        Some(used) => format!("{} used", bytes(used)),
        None => "Usage unavailable".to_owned(),
    };
    let quota = match info.limits.file_bytes {
        Some(limit) => format!(" of {}", bytes(limit)),
        None => " · No disk quota".to_owned(),
    };
    let entries = match (info.usage.entries, info.limits.entries) {
        (Some(used), Some(limit)) => format!(
            " · {} of {} checkpoint entries",
            grouped(used),
            grouped(limit)
        ),
        _ => " · Quota is checked before commands, not enforced during writes".to_owned(),
    };
    format!("{used}{quota}{entries}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_minutes_are_a_whole_number_from_1_to_1440() {
        assert_eq!(parse_idle_minutes(" 30 "), Some(30));
        assert_eq!(parse_idle_minutes("1440"), Some(1440));
        for bad in ["0", "1441", "1.5", "-3", "soon", ""] {
            assert_eq!(parse_idle_minutes(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn an_empty_quota_is_no_limit() {
        assert_eq!(parse_disk_quota(""), Some(None));
        assert_eq!(parse_disk_quota("2048"), Some(Some(2048)));
        for bad in ["0", "-1", "1.5", "lots", "9007199254740992"] {
            assert_eq!(parse_disk_quota(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn sizes_read_like_the_web_workspace() {
        assert_eq!(bytes(512), "512 B");
        assert_eq!(bytes(1536), "1.5 KiB");
        assert_eq!(bytes(2 * 1024 * 1024), "2.0 MiB");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(12_480), "12,480");
        assert_eq!(grouped(1_000_000), "1,000,000");
    }
}
