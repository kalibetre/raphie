//! A timeline card as it reads at one moment: what is over, and where the
//! present falls among today's events.
//!
//! Mirrors `apps/web/src/domains/conversations/application/card-timeline.ts`.
//! Pure functions, no clock: the caller passes the time and how this
//! machine maps a moment to a calendar day.

use crate::contracts::{CardEvent, CardTimelineItem};

const DAY_MS: i64 = 86_400_000;

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
