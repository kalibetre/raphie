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

/// A span of local time: "02:00 – 03:00 PM", or "11:30 AM – 12:15 PM"
/// across noon.
pub fn clock_range(start: i64, end: i64) -> String {
    let (from, to) = (clock(start), clock(end));
    match (from.rsplit_once(' '), to.rsplit_once(' ')) {
        (Some((time, half)), Some((_, same))) if half == same => format!("{time} – {to}"),
        _ => format!("{from} – {to}"),
    }
}

/// The local calendar day of `at`, as days since 1970-01-01.
pub fn local_day(at: i64) -> i64 {
    chrono::DateTime::from_timestamp_millis(at).map_or(0, |utc| {
        let day = utc.with_timezone(&chrono::Local).date_naive();
        (day - chrono::NaiveDate::default()).num_days()
    })
}

/// The weekday and date of a calendar date written YYYY-MM-DD:
/// "Monday 23 November". The date as given when it cannot be read.
pub fn weekday_date(date: &str) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_or_else(
        |_| date.to_owned(),
        |day| day.format("%A %-d %B").to_string(),
    )
}

/// A calendar date written YYYY-MM-DD, in short: "Mon, Nov 23".
pub fn short_date(date: &str) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_or_else(
        |_| date.to_owned(),
        |day| day.format("%a, %b %-d").to_string(),
    )
}

/// The local month and day of `at`: "Nov 14".
pub fn month_day(at: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => utc
            .with_timezone(&chrono::Local)
            .format("%b %-d")
            .to_string(),
        None => String::new(),
    }
}

/// True when `at` is on the same local day as `now` or later.
pub fn is_today(at: i64, now: i64) -> bool {
    let day = |ms: i64| {
        chrono::DateTime::from_timestamp_millis(ms)
            .map(|utc| utc.with_timezone(&chrono::Local).date_naive())
    };
    match (day(at), day(now)) {
        (Some(at), Some(now)) => at >= now,
        _ => false,
    }
}

/// The local date and time of `at`: "Nov 14, 2026, 08:55 PM".
pub fn date_time(at: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => {
            let local = utc.with_timezone(&chrono::Local);
            // `%-d` is the day without a leading zero.
            let date = local.format("%b %-d, %Y");
            format!("{date}, {}", twelve_hour(local.hour(), local.minute()))
        }
        None => String::new(),
    }
}

/// The local time of day of `at` with seconds: "08:55:03 PM".
pub fn time_seconds(at: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => {
            let local = utc.with_timezone(&chrono::Local);
            let clock = twelve_hour(local.hour(), local.minute());
            // "08:55 PM" becomes "08:55:03 PM": the seconds go before the
            // space.
            match clock.split_once(' ') {
                Some((time, half)) => format!("{time}:{:02} {half}", local.second()),
                None => clock,
            }
        }
        None => String::new(),
    }
}

/// The local time of day of `at` to the millisecond, on a 24-hour clock:
/// "20:55:03.123".
pub fn time_millis(at: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => {
            let local = utc.with_timezone(&chrono::Local);
            // `%.3f` is the fraction of a second, to three digits.
            local.format("%H:%M:%S%.3f").to_string()
        }
        None => String::new(),
    }
}

/// `at` in UTC as ISO 8601: "2026-11-14T17:55:03.123Z".
pub fn iso_utc(at: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(at) {
        Some(utc) => utc.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        None => String::new(),
    }
}

/// This machine's offset from UTC now: "UTC+03:00".
pub fn utc_offset() -> String {
    // `%:z` is the offset with a colon, such as "+03:00".
    format!("UTC{}", chrono::Local::now().format("%:z"))
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
    fn utc_times_are_iso_8601() {
        assert_eq!(iso_utc(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
        assert!(utc_offset().starts_with("UTC"));
        // The local forms depend on this machine's zone; their shape does not.
        assert_eq!(time_millis(1_700_000_000_123).len(), "20:55:03.123".len());
        assert!(time_seconds(1_700_000_000_123).contains(":20 "));
    }

    #[test]
    fn a_span_of_time_names_its_half_of_the_day_once() {
        // Built from local times, so the test reads the same in any zone.
        let local = |hour: u32, minute: u32| {
            chrono::Local::now()
                .date_naive()
                .and_hms_opt(hour, minute, 0)
                .and_then(|naive| naive.and_local_timezone(chrono::Local).single())
                .expect("a local time today")
                .timestamp_millis()
        };
        assert_eq!(clock_range(local(14, 0), local(15, 0)), "02:00 – 03:00 PM");
        assert_eq!(
            clock_range(local(11, 30), local(12, 15)),
            "11:30 AM – 12:15 PM"
        );
        assert_eq!(weekday_date("2026-11-23"), "Monday 23 November");
        assert_eq!(weekday_date("soon"), "soon");
        assert_eq!(short_date("2026-11-23"), "Mon, Nov 23");
        assert_eq!(local_day(local(23, 59)), local_day(local(0, 1)));
        assert_eq!(
            local_day(local(12, 0) + 86_400_000) - local_day(local(12, 0)),
            1
        );
    }

    #[test]
    fn times_read_like_the_web_workspace() {
        assert_eq!(twelve_hour(20, 55), "08:55 PM");
        assert_eq!(twelve_hour(0, 5), "12:05 AM");
        assert_eq!(twelve_hour(12, 0), "12:00 PM");
        assert_eq!(twelve_hour(9, 30), "09:30 AM");
    }
}
