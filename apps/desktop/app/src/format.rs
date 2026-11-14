//! Small text formatting for the view. Pure functions of their inputs, so the
//! clock is passed in and tests stay deterministic.

use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Timelike;

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

/// The local time of day of `at` (milliseconds since the Unix epoch) as the
/// web workspace writes it: "08:55 PM".
pub fn clock(at: i64) -> String {
    // `chrono` knows this machine's time zone; the standard library does not.
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => {
            let local = utc.with_timezone(&chrono::Local);
            twelve_hour(local.hour(), local.minute())
        }
        None => String::new(),
    }
}

/// "08:55 PM" for 20:55. Midnight and noon are 12, not 0.
fn twelve_hour(hour: u32, minute: u32) -> String {
    let half = if hour < 12 { "AM" } else { "PM" };
    let hour = match hour % 12 {
        0 => 12,
        other => other,
    };
    format!("{hour:02}:{minute:02} {half}")
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
    fn times_read_like_the_web_workspace() {
        assert_eq!(twelve_hour(20, 55), "08:55 PM");
        assert_eq!(twelve_hour(0, 5), "12:05 AM");
        assert_eq!(twelve_hour(12, 0), "12:00 PM");
        assert_eq!(twelve_hour(9, 30), "09:30 AM");
    }
}
