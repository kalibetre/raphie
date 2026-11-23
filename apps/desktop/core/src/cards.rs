//! What a card works out before it is drawn: a timeline as it reads at one
//! moment and as a day's schedule, how a due date reads today, and a
//! person's initials.
//!
//! Mirrors `card-timeline.ts`, `card-schedule.ts` and `card-facts.ts` in
//! `apps/web/src/domains/conversations/application`.
//! Pure functions, no clock: the caller passes the time and how this
//! machine maps a moment to a calendar day.

use crate::contracts::{CardEvent, CardTimelineItem, CardTone};

const DAY_MS: i64 = 86_400_000;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// A calendar date written exactly YYYY-MM-DD as (year, month, day), if the
/// calendar has that day. As strict as the web's parse, so both clients
/// fall back to the raw text for the same input.
fn civil(date: &str) -> Option<(i64, i64, i64)> {
    let bytes = date.as_bytes();
    let shaped = bytes.len() == 10
        && bytes.iter().enumerate().all(|(at, byte)| match at {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    if !shaped {
        return None;
    }
    let number = |range: std::ops::Range<usize>| date[range].parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1..=12 => 31,
        _ => return None,
    };
    (1..=days).contains(&day).then_some((year, month, day))
}

/// Days from 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn days_from_civil((year, month, day): (i64, i64, i64)) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year.rem_euclid(400);
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468
}

/// The year a day falls in, from days since 1970-01-01 (the inverse of
/// `days_from_civil`, for the year alone).
fn year_of(days: i64) -> i64 {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let of_era = shifted.rem_euclid(146_097);
    let year_of_era = (of_era - of_era / 1_460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    // March-based: January and February belong to the next civil year.
    era * 400 + year_of_era + i64::from(of_year >= 306)
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
        _ => {
            let month = MONTHS[(parts.1 - 1) as usize];
            // Another year is said, so next December is not mistaken for this one.
            let label = if parts.0 == year_of(today) {
                format!("Due {month} {}", parts.2)
            } else {
                format!("Due {month} {}, {}", parts.2, parts.0)
            };
            (label, CardTone::Neutral)
        }
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

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;

/// The working day a strip always covers, in local hours.
const STRIP_FROM: i64 = 8;
const STRIP_TO: i64 = 18;

/// An event drawn on the day strip, on the first lane or, overlapping it,
/// the second.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleBlock {
    pub start: i64,
    pub end: i64,
    pub lane: u8,
    /// It shares its time with a block on the other lane, so takes half
    /// the height.
    pub split: bool,
    /// Its first source's position, for the colour.
    pub source: usize,
    pub past: bool,
}

/// The day at a glance: its events as blocks between two whole hours, with
/// the hours to label and where now falls.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleStrip {
    pub from: i64,
    pub to: i64,
    pub hours: Vec<i64>,
    pub blocks: Vec<ScheduleBlock>,
    pub now: Option<i64>,
}

/// What is on now, or else the next thing today.
#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleNext<'a> {
    pub event: &'a CardEvent,
    pub current: bool,
}

/// One day of a timeline card, laid out as a schedule at `now`.
#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleDay<'a> {
    /// The calendar day, as days since 1970-01-01.
    pub day: i64,
    /// Days from today: 0 today, 1 tomorrow, -1 yesterday.
    pub offset: i64,
    pub events: usize,
    pub all_day: Vec<&'a CardEvent>,
    /// Time in timed events, with overlaps counted once.
    pub booked: i64,
    /// When the last timed event ends, unless one has no end or it is over.
    pub free_after: Option<i64>,
    /// Today only, when it has timed events.
    pub strip: Option<ScheduleStrip>,
    pub next: Option<ScheduleNext<'a>>,
    /// Today's timed events already over, folded into one line.
    pub earlier: Vec<&'a CardEvent>,
    /// The rest, in order: events, free time and the line for now. Never a
    /// day.
    pub rows: Vec<TimelineRow<'a>>,
}

/// The time covered by intervals, counting an overlap once.
fn covered(mut spans: Vec<(i64, i64)>) -> i64 {
    spans.sort_unstable();
    let mut total = 0;
    let mut reach = i64::MIN;
    for (start, end) in spans {
        if end <= reach {
            continue;
        }
        total += end - start.max(reach);
        reach = end;
    }
    total
}

fn strip(
    day: i64,
    events: &[&CardEvent],
    now: i64,
    hour_at: &impl Fn(i64, i64) -> i64,
) -> ScheduleStrip {
    // An event with no end is drawn a quarter of an hour long.
    let ends = |event: &CardEvent| event.end.unwrap_or(event.start + 15 * MINUTE);
    let first = events.iter().map(|e| e.start).min().unwrap_or(now);
    let last = events.iter().map(|e| ends(e)).max().unwrap_or(now);
    let base = hour_at(day, 0);
    // Rounded out to whole hours, and never narrower than a working day.
    let from_hour = (first - base).div_euclid(HOUR).clamp(0, STRIP_FROM);
    let to_hour = (last - base + HOUR - 1)
        .div_euclid(HOUR)
        .clamp(STRIP_TO, 24);
    let (from, to) = (hour_at(day, from_hour), hour_at(day, to_hour));
    let mut hours = vec![from_hour];
    hours.extend(
        (from_hour + 1..to_hour)
            // Far enough from the ends that labels never run into each other.
            .filter(|hour| hour % 3 == 0 && hour - from_hour >= 2 && to_hour - hour >= 3),
    );
    hours.push(to_hour);
    let mut sorted = events.to_vec();
    sorted.sort_by_key(|e| e.start);
    let mut blocks: Vec<ScheduleBlock> = Vec::new();
    let mut lane_end = i64::MIN;
    for event in sorted {
        let end = ends(event);
        let start = from.max(event.start);
        let clipped = to.min(end);
        if clipped <= start {
            continue;
        }
        let lane = u8::from(event.start < lane_end);
        if lane == 0 {
            lane_end = end;
        }
        blocks.push(ScheduleBlock {
            start,
            end: clipped,
            lane,
            split: lane == 1,
            source: event.sources.first().copied().unwrap_or(0),
            past: end <= now,
        });
    }
    let seconds: Vec<(i64, i64)> = blocks
        .iter()
        .filter(|b| b.lane == 1)
        .map(|b| (b.start, b.end))
        .collect();
    for block in blocks.iter_mut().filter(|b| b.lane == 0) {
        if seconds
            .iter()
            .any(|&(start, end)| block.start < end && start < block.end)
        {
            block.split = true;
        }
    }
    ScheduleStrip {
        from,
        to,
        hours: hours.into_iter().map(|hour| hour_at(day, hour)).collect(),
        blocks,
        now: (from <= now && now <= to).then_some(now),
    }
}

fn laid_out<'a>(
    day: i64,
    items: &'a [CardTimelineItem],
    now: i64,
    local_day: &impl Fn(i64) -> i64,
    hour_at: &impl Fn(i64, i64) -> i64,
) -> ScheduleDay<'a> {
    let events: Vec<&CardEvent> = items
        .iter()
        .filter_map(|item| match item {
            CardTimelineItem::Event(event) => Some(event),
            _ => None,
        })
        .collect();
    let times: Vec<&CardEvent> = events.iter().copied().filter(|e| !e.all_day).collect();
    let offset = day - local_day(now);
    let today = offset == 0;
    let last_end = times
        .iter()
        .map(|e| e.end)
        .collect::<Option<Vec<i64>>>()
        .and_then(|ends| ends.into_iter().max());
    let current = times
        .iter()
        .copied()
        .find(|e| today && e.start <= now && now < e.end.unwrap_or(e.start));
    let upcoming = times.iter().copied().find(|e| today && e.start > now);
    let over: Vec<&CardEvent> = times
        .iter()
        .copied()
        .filter(|e| today && e.end.unwrap_or(e.start) <= now)
        .collect();
    // Once the whole day is over there is nothing left to fold it under.
    let fold = !over.is_empty() && over.len() < times.len();
    let rows = timeline_rows(items, now, local_day)
        .into_iter()
        .filter(|row| match row {
            TimelineRow::Day { .. } => false,
            TimelineRow::Event { event, past } => !event.all_day && !(fold && *past),
            TimelineRow::Gap { past, .. } => !(fold && *past),
            TimelineRow::Now { .. } => true,
        })
        .collect();
    ScheduleDay {
        day,
        offset,
        events: events.len(),
        all_day: events.iter().copied().filter(|e| e.all_day).collect(),
        booked: covered(
            times
                .iter()
                .filter_map(|e| e.end.map(|end| (e.start, end)))
                .collect(),
        ),
        free_after: last_end.filter(|&end| !today || end > now),
        strip: (today && !times.is_empty()).then(|| strip(day, &times, now, hour_at)),
        next: current
            .map(|event| ScheduleNext {
                event,
                current: true,
            })
            .or_else(|| {
                upcoming.map(|event| ScheduleNext {
                    event,
                    current: false,
                })
            }),
        earlier: if fold { over } else { Vec::new() },
        rows,
    }
}

/// A timeline card as a schedule: one entry a day, each with how busy it
/// is and, for today, a strip of the day, what is on or next, and what is
/// over folded away. Everything is worked out from the events' times, so a
/// card saved before reads the same way.
///
/// `local_day` gives the calendar day of a moment on this machine, and
/// `hour_at` the moment a local hour of a day starts, both with days since
/// 1970-01-01.
pub fn schedule<'a>(
    items: &'a [CardTimelineItem],
    now: i64,
    local_day: impl Fn(i64) -> i64,
    hour_at: impl Fn(i64, i64) -> i64,
) -> Vec<ScheduleDay<'a>> {
    let mut days = Vec::new();
    let mut named: Option<i64> = None;
    let mut from = 0;
    let mut close = |run: &'a [CardTimelineItem], named: Option<i64>| {
        // An all-day event's start is midnight UTC of its date.
        let first = run.iter().find_map(|item| match item {
            CardTimelineItem::Event(event) if event.all_day => Some(event.start.div_euclid(DAY_MS)),
            CardTimelineItem::Event(event) => Some(local_day(event.start)),
            _ => None,
        });
        if let Some(day) = named.or(first)
            && !run.is_empty()
        {
            days.push(laid_out(day, run, now, &local_day, &hour_at));
        }
    };
    for (at, item) in items.iter().enumerate() {
        if let CardTimelineItem::Day { date } = item {
            close(&items[from..at], named);
            named = civil(date).map(days_from_civil);
            from = at + 1;
        }
    }
    close(&items[from..], named);
    days
}

/// "3h 45m", "45m" or "2h": a length of time, to the minute.
pub fn duration(ms: i64) -> String {
    let minutes = ((ms + MINUTE / 2) / MINUTE).max(1);
    let (hours, rest) = (minutes / 60, minutes % 60);
    match (hours, rest) {
        (0, _) => format!("{rest}m"),
        (_, 0) => format!("{hours}h"),
        _ => format!("{hours}h {rest}m"),
    }
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
        assert_eq!(due("2027-12-04").label, "Due Dec 4, 2027");
        // Anything but a real YYYY-MM-DD date is shown as it came.
        for raw in [
            "soon",
            "",
            "x-y-z",
            "2026-13-01",
            "2026-02-30",
            "2026-1-5",
            "+2026-11-23",
            "99999999999999999-01-01",
        ] {
            assert_eq!(due(raw).label, raw);
            assert!(!due(raw).soon);
        }
        assert_eq!(
            due_label("2028-02-29", days_from_civil((2028, 2, 28))).label,
            "Due tomorrow"
        );
    }

    #[test]
    fn a_days_year_is_read_back_from_its_count() {
        for (date, year) in [
            ((1970, 1, 1), 1970),
            ((1999, 12, 31), 1999),
            ((2000, 1, 1), 2000),
            ((2024, 2, 29), 2024),
            ((2026, 11, 23), 2026),
            ((2026, 12, 31), 2026),
            ((2027, 1, 1), 2027),
        ] {
            assert_eq!(year_of(days_from_civil(date)), year, "{date:?}");
        }
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

    // Hours of the test day, read as UTC.
    fn hour_at(day: i64, hour: i64) -> i64 {
        day * DAY_MS + hour * HOUR
    }

    fn sourced(title: &str, start: i64, end: i64, source: usize) -> CardTimelineItem {
        CardTimelineItem::Event(CardEvent {
            title: title.to_owned(),
            start,
            end: Some(end),
            sources: vec![source],
            ..CardEvent::default()
        })
    }

    fn busy_day() -> Vec<CardTimelineItem> {
        vec![
            CardTimelineItem::Event(CardEvent {
                title: "Birthday".to_owned(),
                start: 20_000 * DAY_MS,
                all_day: true,
                ..CardEvent::default()
            }),
            event("Standup", at(9, 30), at(9, 45)),
            CardTimelineItem::Gap {
                start: at(9, 45),
                end: at(11, 0),
            },
            event("Sync", at(11, 0), at(12, 0)),
            sourced("Dentist", at(11, 45), at(12, 30), 1),
            CardTimelineItem::Gap {
                start: at(12, 30),
                end: at(14, 30),
            },
            event("Interview", at(14, 30), at(15, 30)),
        ]
    }

    fn titles(rows: &[TimelineRow]) -> Vec<String> {
        rows.iter()
            .map(|row| match row {
                TimelineRow::Event { event, .. } => event.title.clone(),
                TimelineRow::Gap { .. } => "gap".to_owned(),
                TimelineRow::Now { .. } => "now".to_owned(),
                TimelineRow::Day { .. } => "day".to_owned(),
            })
            .collect()
    }

    #[test]
    fn today_counts_each_event_once_and_folds_what_is_over() {
        let items = busy_day();
        let days = schedule(&items, at(10, 42), utc_day, hour_at);
        assert_eq!(days.len(), 1);
        let day = &days[0];
        assert_eq!((day.day, day.offset, day.events), (20_000, 0, 5));
        assert_eq!(day.all_day.len(), 1);
        assert_eq!(duration(day.booked), "2h 45m");
        assert_eq!(day.free_after, Some(at(15, 30)));
        assert_eq!(
            day.earlier
                .iter()
                .map(|e| e.title.as_str())
                .collect::<Vec<_>>(),
            ["Standup"]
        );
        assert_eq!(
            titles(&day.rows),
            ["now", "gap", "Sync", "Dentist", "gap", "Interview"]
        );
        let next = day.next.as_ref().unwrap();
        assert_eq!((next.event.title.as_str(), next.current), ("Sync", false));
        let during = schedule(&items, at(11, 50), utc_day, hour_at);
        let next = during[0].next.as_ref().unwrap();
        assert_eq!((next.event.title.as_str(), next.current), ("Sync", true));
    }

    #[test]
    fn once_the_day_is_over_nothing_is_folded_or_next() {
        let items = busy_day();
        let day = &schedule(&items, at(18, 0), utc_day, hour_at)[0];
        assert!(day.earlier.is_empty());
        assert!(day.next.is_none());
        assert!(day.free_after.is_none());
        assert_eq!(
            titles(&day.rows),
            ["Standup", "gap", "Sync", "Dentist", "gap", "Interview"]
        );
    }

    #[test]
    fn the_strip_covers_a_working_day_with_overlaps_on_a_second_lane() {
        let items = busy_day();
        let strip = schedule(&items, at(10, 42), utc_day, hour_at)[0]
            .strip
            .clone()
            .unwrap();
        assert_eq!((strip.from, strip.to), (at(8, 0), at(18, 0)));
        assert_eq!(strip.hours, [at(8, 0), at(12, 0), at(15, 0), at(18, 0)]);
        assert_eq!(strip.now, Some(at(10, 42)));
        let blocks: Vec<_> = strip
            .blocks
            .iter()
            .map(|b| (b.lane, b.split, b.source, b.past))
            .collect();
        assert_eq!(
            blocks,
            [
                (0, false, 0, true),
                (0, true, 0, false),
                (1, true, 1, false),
                (0, false, 0, false)
            ]
        );
        let late = [event("Dinner", at(19, 30), at(20, 15))];
        let strip = schedule(&late, at(9, 0), utc_day, hour_at)[0]
            .strip
            .clone()
            .unwrap();
        assert_eq!(strip.to, at(21, 0));
    }

    #[test]
    fn another_day_has_no_strip_and_several_split_on_their_day_lines() {
        let items = busy_day();
        let day = &schedule(&items, at(10, 0) - DAY_MS, utc_day, hour_at)[0];
        assert_eq!(day.offset, 1);
        assert!(day.strip.is_none() && day.next.is_none() && day.earlier.is_empty());
        let week = [
            CardTimelineItem::Day {
                date: "2024-10-04".to_owned(),
            },
            event("Standup", at(9, 30), at(9, 45)),
            CardTimelineItem::Day {
                date: "2024-10-05".to_owned(),
            },
            event("Planning", at(16, 0) + DAY_MS, at(17, 0) + DAY_MS),
        ];
        let days: Vec<_> = schedule(&week, at(8, 0), utc_day, hour_at)
            .iter()
            .map(|d| (d.day, d.offset, d.events))
            .collect();
        assert_eq!(days, [(20_000, 0, 1), (20_001, 1, 1)]);
    }

    #[test]
    fn a_length_reads_in_hours_and_minutes() {
        assert_eq!(duration(45 * MINUTE), "45m");
        assert_eq!(duration(2 * HOUR), "2h");
        assert_eq!(duration(225 * MINUTE), "3h 45m");
        assert_eq!(duration(10_000), "1m");
    }
}
