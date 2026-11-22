//! What a card works out before it is drawn: a timeline as it reads at one
//! moment, how a due date reads today, and a person's initials.
//!
//! Mirrors `card-timeline.ts` and `card-facts.ts` in
//! `apps/web/src/domains/conversations/application`.
//! Pure functions, no clock: the caller passes the time and how this
//! machine maps a moment to a calendar day.

use crate::contracts::{CardEvent, CardTimelineItem, CardTone};

const DAY_MS: i64 = 86_400_000;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// A calendar date written YYYY-MM-DD as (year, month, day), if it is one.
fn civil(date: &str) -> Option<(i64, i64, i64)> {
    let mut parts = date.split('-').map(|part| part.parse::<i64>().ok());
    let (year, month, day) = (parts.next()??, parts.next()??, parts.next()??);
    (parts.next().is_none() && (1..=12).contains(&month) && (1..=31).contains(&day))
        .then_some((year, month, day))
}

/// Days from 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn days_from_civil((year, month, day): (i64, i64, i64)) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year.rem_euclid(400);
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468
}

/// How a due date reads on a day.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Due {
    pub label: String,
    pub tone: CardTone,
    /// Close or past: worth a badge. Later dates are plain words.
    pub soon: bool,
}

/// How a due date written YYYY-MM-DD reads on `today` (days since
/// 1970-01-01): overdue in red, today and tomorrow in amber, and later
/// dates plainly. Mirrors `dueLabel` in the web's `card-facts.ts`.
pub fn due_label(date: &str, today: i64) -> Due {
    let Some(parts) = civil(date) else {
        return Due {
            label: date.to_owned(),
            tone: CardTone::Neutral,
            soon: false,
        };
    };
    let days = days_from_civil(parts) - today;
    let (label, tone) = match days {
        ..0 => (format!("Overdue {}d", -days), CardTone::Bad),
        0 => ("Due today".to_owned(), CardTone::Attention),
        1 => ("Due tomorrow".to_owned(), CardTone::Attention),
        _ => (
            format!("Due {} {}", MONTHS[(parts.1 - 1) as usize], parts.2),
            CardTone::Neutral,
        ),
    };
    Due {
        label,
        tone,
        soon: days <= 1,
    }
}

/// Up to two letters for a person: "Kalkidan Betre" is "KB", "mara" is "M".
pub fn initials(name: &str) -> String {
    let mut words = name.split_whitespace();
    let first = words.next().and_then(|word| word.chars().next());
    let last = words.next_back().and_then(|word| word.chars().next());
    first
        .into_iter()
        .chain(last)
        .flat_map(char::to_uppercase)
        .collect()
}

/// One line of a timeline card as it reads at `now`.
#[derive(Clone, Debug, PartialEq)]
pub enum TimelineRow<'a> {
    Day {
        date: &'a str,
    },
    /// Where the present falls among today's events.
    Now {
        at: i64,
    },
    Gap {
        start: i64,
        end: i64,
        /// The present falls in this free time.
        current: bool,
        past: bool,
    },
    Event {
        event: &'a CardEvent,
        past: bool,
    },
}

/// A timeline's items with the present placed among them: what is over is
/// marked past, and a line for now goes before the first of today's events
/// still to end, or before the free time now falls in.
///
/// `local_day` gives the calendar day of a moment on this machine, as days
/// since 1970-01-01.
pub fn timeline_rows<'a>(
    items: &'a [CardTimelineItem],
    now: i64,
    local_day: impl Fn(i64) -> i64,
) -> Vec<TimelineRow<'a>> {
    let today = local_day(now);
    let mut rows = Vec::with_capacity(items.len() + 1);
    let mut placed = false;
    for item in items {
        match item {
            CardTimelineItem::Day { date } => rows.push(TimelineRow::Day { date }),
            CardTimelineItem::Gap { start, end } => {
                let current = *start <= now && now < *end;
                if current && !placed {
                    rows.push(TimelineRow::Now { at: now });
                    placed = true;
                }
                rows.push(TimelineRow::Gap {
                    start: *start,
                    end: *end,
                    current,
                    past: *end <= now,
                });
            }
            // An all-day event's start is midnight UTC of its date.
            CardTimelineItem::Event(event) if event.all_day => rows.push(TimelineRow::Event {
                event,
                past: event.start.div_euclid(DAY_MS) < today,
            }),
            CardTimelineItem::Event(event) => {
                let ends = event.end.unwrap_or(event.start);
                if !placed && ends > now && local_day(event.start) == today {
                    rows.push(TimelineRow::Now { at: now });
                    placed = true;
                }
                rows.push(TimelineRow::Event {
                    event,
                    past: ends <= now,
                });
            }
            CardTimelineItem::Unknown => {}
        }
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3_600_000;

    // The tests read times as UTC, so a day is the same wherever they run.
    fn utc_day(at: i64) -> i64 {
        at.div_euclid(DAY_MS)
    }

    fn at(hour: i64, minute: i64) -> i64 {
        20_000 * DAY_MS + hour * HOUR + minute * 60_000
    }

    fn event(title: &str, start: i64, end: i64) -> CardTimelineItem {
        CardTimelineItem::Event(CardEvent {
            title: title.to_owned(),
            start,
            end: Some(end),
            ..CardEvent::default()
        })
    }

    fn day() -> Vec<CardTimelineItem> {
        vec![
            event("Standup", at(9, 30), at(9, 45)),
            CardTimelineItem::Gap {
                start: at(9, 45),
                end: at(13, 0),
            },
            event("1:1", at(13, 0), at(13, 30)),
            CardTimelineItem::Gap {
                start: at(13, 30),
                end: at(14, 0),
            },
            event("Planning", at(14, 0), at(15, 0)),
        ]
    }

    fn kinds(now: i64) -> Vec<String> {
        timeline_rows(&day(), now, utc_day)
            .iter()
            .map(|row| match row {
                TimelineRow::Day { .. } => "day".to_owned(),
                TimelineRow::Now { .. } => "now".to_owned(),
                TimelineRow::Gap { current, past, .. } => format!(
                    "gap{}{}",
                    if *current { " (current)" } else { "" },
                    if *past { " (past)" } else { "" }
                ),
                TimelineRow::Event { event, past } => {
                    format!("{}{}", event.title, if *past { " (past)" } else { "" })
                }
            })
            .collect()
    }

    #[test]
    fn a_due_date_is_red_once_past_amber_today_and_tomorrow_and_plain_later() {
        // 2026-11-23 is 20_780 days after 1970-01-01.
        let today = days_from_civil((2026, 11, 23));
        assert_eq!(today, 20_780);
        let due = |date: &str| due_label(date, today);
        assert_eq!(due("2026-11-20").label, "Overdue 3d");
        assert_eq!(due("2026-11-20").tone, CardTone::Bad);
        assert_eq!(due("2026-11-23").label, "Due today");
        assert_eq!(due("2026-11-24").label, "Due tomorrow");
        assert_eq!(due("2026-11-24").tone, CardTone::Attention);
        let later = due("2026-12-04");
        assert_eq!(later.label, "Due Dec 4");
        assert!(!later.soon && later.tone == CardTone::Neutral);
        // Across a year end the count is still in days.
        assert_eq!(
            due_label("2026-12-31", days_from_civil((2027, 1, 2))).label,
            "Overdue 2d"
        );
        assert_eq!(due("soon").label, "soon");
        assert!(!due("soon").soon);
    }

    #[test]
    fn a_person_is_drawn_as_their_first_and_last_initials() {
        assert_eq!(initials("Kalkidan Betre"), "KB");
        assert_eq!(initials("  mara "), "M");
        assert_eq!(initials("Ana de la Cruz"), "AC");
        assert_eq!(initials(""), "");
    }

    #[test]
    fn before_the_day_starts_now_sits_above_the_first_event() {
        assert_eq!(
            kinds(at(8, 0)),
            ["now", "Standup", "gap", "1:1", "gap", "Planning"]
        );
    }

    #[test]
    fn in_free_time_now_sits_above_the_gap_it_falls_in() {
        assert_eq!(
            kinds(at(10, 42)),
            [
                "Standup (past)",
                "now",
                "gap (current)",
                "1:1",
                "gap",
                "Planning"
            ]
        );
    }

    #[test]
    fn during_an_event_now_sits_above_it() {
        assert_eq!(
            kinds(at(14, 20)),
            [
                "Standup (past)",
                "gap (past)",
                "1:1 (past)",
                "gap (past)",
                "now",
                "Planning"
            ]
        );
    }

    #[test]
    fn once_the_day_is_over_or_on_another_day_there_is_no_line_for_now() {
        let over = [
            "Standup (past)",
            "gap (past)",
            "1:1 (past)",
            "gap (past)",
            "Planning (past)",
        ];
        assert_eq!(kinds(at(18, 0)), over);
        assert_eq!(kinds(at(10, 0) + DAY_MS), over);
        assert_eq!(
            kinds(at(10, 0) - DAY_MS),
            ["Standup", "gap", "1:1", "gap", "Planning"]
        );
    }

    #[test]
    fn an_all_day_event_is_past_only_after_its_date() {
        let items = vec![
            CardTimelineItem::Day {
                date: "2024-10-04".to_owned(),
            },
            CardTimelineItem::Event(CardEvent {
                title: "Birthday".to_owned(),
                start: at(0, 0),
                all_day: true,
                ..CardEvent::default()
            }),
            CardTimelineItem::Unknown,
        ];
        let rows = timeline_rows(&items, at(23, 59), utc_day);
        assert_eq!(rows.len(), 2, "an unknown item is not drawn");
        assert!(matches!(rows[1], TimelineRow::Event { past: false, .. }));
        let later = timeline_rows(&items, at(0, 1) + DAY_MS, utc_day);
        assert!(matches!(later[1], TimelineRow::Event { past: true, .. }));
    }
}
