//! Small text formatting for the view. Pure functions of their inputs, so the
//! clock is passed in and tests stay deterministic.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, the unit the runtime uses.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// "now", "5m", "3h", "2d": how long ago `at` was.
pub fn ago(at: i64, now: i64) -> String {
    let minutes = (now - at).max(0) / 60_000;
    match minutes {
        0 => "now".to_owned(),
        1..=59 => format!("{minutes}m"),
        60..=1439 => format!("{}h", minutes / 60),
        _ => format!("{}d", minutes / 1440),
    }
}

/// "Expires in 4 min", or "Expired" once the deadline passed.
pub fn expires_in(deadline: i64, now: i64) -> String {
    let seconds = (deadline - now) / 1000;
    match seconds {
        ..=0 => "Expired".to_owned(),
        1..=59 => format!("Expires in {seconds} s"),
        _ => format!("Expires in {} min", (seconds + 59) / 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ago_rounds_down_to_the_largest_unit() {
        let now = 10 * 86_400_000;
        assert_eq!(ago(now, now), "now");
        assert_eq!(ago(now - 5 * 60_000, now), "5m");
        assert_eq!(ago(now - 3 * 3_600_000, now), "3h");
        assert_eq!(ago(now - 2 * 86_400_000, now), "2d");
        assert_eq!(ago(now + 1000, now), "now", "clock skew is not negative");
    }

    #[test]
    fn expiry_counts_down() {
        assert_eq!(expires_in(1000 + 240_000, 1000), "Expires in 4 min");
        assert_eq!(expires_in(1000 + 30_000, 1000), "Expires in 30 s");
        assert_eq!(expires_in(1000, 1000), "Expired");
    }
}
