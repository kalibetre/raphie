//! A card the bot showed under its reply, as the web's `ShownCard` draws
//! it: rows, a day's events, a board's columns or one task opened up, with
//! links out. Read-only.
//!
//! In sync with `apps/web/src/shared/styles/cards.css`. Like the web's, the
//! layout is a phone's at every width: a row is a title that wraps over one
//! line of small parts, never fixed columns.

use raphie_core::cards::{
    ScheduleDay, ScheduleNext, ScheduleStrip, TimelineRow, due_label, duration, initials, schedule,
};
use raphie_core::contracts::{
    Card, CardBody, CardColumn, CardEvent, CardField, CardGroup, CardLink, CardProgress, CardRow,
    CardSteps, CardTone, SessionCard,
};
use rune::{Color, Cursor, El, Tx, col, el, icon, row, text};

use super::Look;
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button};

pub fn card(s: &Ui, shown: &SessionCard, now: i64, look: &Look) -> El {
    let t = &look.theme;
    let card = &shown.card;
    let id = &shown.id;
    let today = format::local_day(now);
    let days = match &card.body {
        CardBody::Timeline { items } => schedule(items, now, format::local_day, format::hour_at),
        _ => Vec::new(),
    };
    // A schedule of one day is headed by that day, read from its events.
    let single = match days.as_slice() {
        [day] => Some(day),
        _ => None,
    };
    let mut body = col()
        .key(format!("rd-card-{id}"))
        .role("group")
        .label(card.title.clone())
        // As wide as the conversation: a row wraps, so width only helps.
        .w_full()
        .mt(8.0)
        .mb(4.0)
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .clip_rounded(12.0)
        .child(head(shown, single, now, t));
    if card.sources.len() > 1 {
        let mut line = legend("Sources");
        for (position, name) in card.sources.iter().enumerate() {
            line = line.child(legend_item(t.source(position), name, None, t));
        }
        body = body.child(line);
    }
    if !card.stats.is_empty() {
        let mut stats = row().w_full().px(12.0).pb(10.0).gaps(6.0, 20.0).flex_wrap();
        for stat in &card.stats {
            stats = stats.child(
                col()
                    .child(
                        text(stat.value.clone())
                            .font(font(18.0, 600.0).lh(23.5))
                            .color(t.foreground),
                    )
                    .child(small(stat.label.clone(), t)),
            );
        }
        body = body.child(stats);
    }
    if let Some(warning) = &card.warning {
        body = body.child(rule(t)).child(
            row()
                .w_full()
                .px(12.0)
                .py(6.0)
                .fill(t.attention_soft)
                .child(
                    text(warning.clone())
                        .font(font(12.5, 400.0))
                        .color(t.attention)
                        .wrap()
                        .shrink()
                        .min_w(0.0),
                ),
        );
    }
    body = match &card.body {
        CardBody::List { groups } => list(body, id, card, groups, today, t),
        CardBody::Timeline { .. } => {
            let several = days.len() > 1;
            days.iter().fold(body, |body, day| {
                schedule_day(body, s, id, card, day, several, now, t)
            })
        }
        CardBody::Board { columns } => board(body, id, card, columns, today, t),
        CardBody::Item {
            fields,
            body: about,
            steps,
            ..
        } => item(body, fields, about.as_deref(), steps.as_ref(), today, t),
        // A kind of card this version cannot draw still shows its heading.
        CardBody::Unknown => body,
    };
    if let Some(more) = &card.more {
        let line = text(more.label.clone())
            .font(font(12.5, 400.0))
            .color(t.muted_foreground)
            .wrap()
            .shrink()
            .min_w(0.0);
        let mut foot = row().w_full().px(12.0).py(10.0).gap(4.0).center_y();
        foot = match &more.url {
            Some(url) => foot
                .child(link(line, format!("rd-card-{id}-more"), &more.label, url))
                .child(out_arrow(t)),
            None => foot.child(line),
        };
        body = body.child(rule(t)).child(foot);
    }
    body
}

/// The title, linked when the card has a page, over where and when it was
/// read. A one-day schedule is headed by its day, with how full it is.
fn head(shown: &SessionCard, single: Option<&ScheduleDay>, now: i64, t: &Theme) -> El {
    let card = &shown.card;
    let heading = single.map_or_else(|| card.title.clone(), day_name);
    let title = text(heading.clone())
        .font(if single.is_some() {
            font(17.0, 600.0)
        } else {
            font(14.0, 600.0)
        })
        .color(t.foreground)
        .wrap()
        .shrink()
        .min_w(0.0);
    let mut name = row().w_full().gap(4.0).center_y().min_w(0.0);
    name = match &card.url {
        Some(url) => name
            .child(link(
                title,
                format!("rd-card-{}-title", shown.id),
                &heading,
                url,
            ))
            .child(out_arrow(t)),
        None => name.child(title),
    };
    let read = if format::is_today(shown.created_at, now) {
        format::clock(shown.created_at)
    } else {
        format!(
            "{}, {}",
            format::month_day(shown.created_at),
            format::clock(shown.created_at)
        )
    };
    let mut about = String::new();
    if let CardBody::Item { key: Some(key), .. } = &card.body {
        about.push_str(&format!("{key} · "));
    }
    if let [only] = card.sources.as_slice() {
        about.push_str(&format!("{only} · "));
    }
    about.push_str(&format!("as of {read}"));
    let mut head = col().w_full().px(12.0).pt(10.0).pb(8.0);
    if let Some(day) = single {
        head = head.child(small(format::day_date(day.day), t));
    }
    head = head.child(name).child(small(about, t));
    match single {
        Some(day) => head.child(summary(day, t)),
        None => head,
    }
}

fn legend(label: &str) -> El {
    row()
        .role("list")
        .label(label.to_owned())
        .w_full()
        .px(12.0)
        .pb(10.0)
        .gaps(2.0, 12.0)
        .flex_wrap()
}

/// A colour and what it stands for, with a count when it has one.
fn legend_item(colour: Color, name: &str, count: Option<u32>, t: &Theme) -> El {
    let mut item = row()
        .gap(5.0)
        .center_y()
        .child(el().size(8.0, 8.0).radius(4.0).fill(colour).a11y_hidden())
        .child(small(name.to_owned(), t));
    if let Some(count) = count {
        item = item.child(
            text(count.to_string())
                .font(font(12.0, 600.0))
                .color(t.foreground),
        );
    }
    item
}

fn list(mut body: El, id: &str, card: &Card, groups: &[CardGroup], today: i64, t: &Theme) -> El {
    for (g, group) in groups.iter().enumerate() {
        if let Some(label) = &group.label {
            body = body.child(rule(t)).child(heading(label.clone(), None, t));
        }
        for (r, item) in group.rows.iter().enumerate() {
            body = body.child(rule(t)).child(list_row(
                &format!("rd-card-{id}-{g}-{r}"),
                card,
                item,
                today,
                t,
            ));
        }
    }
    body
}

fn board(mut body: El, id: &str, card: &Card, columns: &[CardColumn], today: i64, t: &Theme) -> El {
    // Each column as wide as its share of the items.
    let mut spread = row()
        .w_full()
        .h(6.0)
        .gap(2.0)
        .px(12.0)
        .mt(2.0)
        .mb(8.0)
        .a11y_hidden();
    let mut names = legend("Columns");
    for column in columns {
        if column.count > 0 {
            spread = spread.child(
                el().h(6.0)
                    .min_w(6.0)
                    .grow(column.count as f32)
                    .radius(3.0)
                    .fill(t.column(column.color)),
            );
        }
        names = names.child(legend_item(
            t.column(column.color),
            &column.label,
            Some(column.count),
            t,
        ));
    }
    body = body.child(spread).child(names);
    for (c, column) in columns.iter().enumerate() {
        if column.rows.is_empty() {
            continue;
        }
        body = body
            .child(rule(t))
            .child(heading(column.label.clone(), Some(column.count), t));
        for (r, item) in column.rows.iter().enumerate() {
            body = body.child(rule(t)).child(list_row(
                &format!("rd-card-{id}-{c}-{r}"),
                card,
                item,
                today,
                t,
            ));
        }
        let rest = column.count.saturating_sub(column.rows.len() as u32);
        if rest > 0 {
            body = body.child(rule(t)).child(
                row().w_full().px(12.0).py(10.0).child(
                    text(format!("{rest} more in {}", column.label))
                        .font(font(12.5, 400.0))
                        .color(t.muted_foreground)
                        .wrap()
                        .shrink()
                        .min_w(0.0),
                ),
            );
        }
    }
    body
}

fn list_row(key: &str, card: &Card, item: &CardRow, today: i64, t: &Theme) -> El {
    let mut line = line(key);
    if card.sources.len() > 1 {
        line = line.child(bars(&item.sources, &card.sources, false, t));
    }
    let mut meta = meta();
    let mut any = false;
    let mut add = |meta: El, part: El| {
        any = true;
        meta.child(part)
    };
    if let Some(id) = &item.key {
        meta = add(meta, small(id.clone(), t));
    }
    if let Some(detail) = &item.detail {
        meta = add(meta, small(detail.clone(), t).wrap().shrink().min_w(0.0));
    }
    for tag in &item.tags {
        meta = add(meta, self::tag(tag, t));
    }
    if let Some(progress) = item.progress {
        meta = add(meta, self::progress(progress, t));
    }
    if let Some(badge) = &item.badge {
        meta = add(meta, self::badge(&badge.label, badge.tone, t));
    }
    if let Some(date) = &item.due {
        meta = add(meta, due(date, today, t));
    }
    if let Some(trailing) = &item.trailing {
        // Pushed to the end of the line.
        meta = add(meta, el().grow(1.0).a11y_hidden());
        meta = meta.child(small(trailing.clone(), t));
    }
    let mut main = col().grow(1.0).shrink().min_w(0.0).child(title(
        key,
        &item.title,
        item.url.as_deref(),
        t.foreground,
    ));
    if any {
        main = main.child(meta);
    }
    line = line.child(main);
    if !item.people.is_empty() {
        line = line.child(people(&item.people, t));
    }
    match &item.link {
        Some(second) => line.child(self::second(key, second, t)),
        None => line,
    }
}

/// "Today", "Tomorrow", "Yesterday" or the weekday of a day further off.
fn day_name(day: &ScheduleDay) -> String {
    match day.offset {
        0 => "Today".to_owned(),
        1 => "Tomorrow".to_owned(),
        -1 => "Yesterday".to_owned(),
        _ => format::weekday(day.day),
    }
}

/// How full a day is: its events, the time they take and when it frees up.
fn summary(day: &ScheduleDay, t: &Theme) -> El {
    let part = |strong: String, rest: &str| {
        row()
            .gap(4.0)
            .center_y()
            .child(text(strong).font(font(12.5, 600.0)).color(t.foreground))
            .child(
                text(rest.to_owned())
                    .font(font(12.5, 400.0))
                    .color(t.muted_foreground),
            )
    };
    let mut line = row().w_full().pt(4.0).gaps(2.0, 10.0).flex_wrap();
    line = line.child(part(
        day.events.to_string(),
        if day.events == 1 { "event" } else { "events" },
    ));
    if day.booked > 0 {
        line = line.child(part(duration(day.booked), "booked"));
    }
    if let Some(free) = day.free_after {
        line = line.child(
            row()
                .gap(4.0)
                .center_y()
                .child(
                    text("free after".to_owned())
                        .font(font(12.5, 400.0))
                        .color(t.muted_foreground),
                )
                .child(
                    text(format::short_clock(free))
                        .font(font(12.5, 600.0))
                        .color(t.foreground),
                ),
        );
    }
    line
}

/// The day at a glance: a bar of busy time with a mark for now.
///
/// Built from slices of time between the blocks' edges, each as wide as its
/// share of the day, so it needs no measured width. A slice is two halves:
/// a block alone fills both, and an overlap puts one block over the other.
fn strip_view(strip: &ScheduleStrip, t: &Theme) -> El {
    const HALF: f32 = 6.0;
    let mut edges: Vec<i64> = vec![strip.from, strip.to];
    for block in &strip.blocks {
        edges.extend([block.start, block.end]);
    }
    if let Some(now) = strip.now {
        edges.push(now);
    }
    edges.sort_unstable();
    edges.dedup();
    let colour = |source: usize, past: bool| {
        let colour = t.source(source);
        if past { colour.alpha(0.4) } else { colour }
    };
    let mut bar = row()
        .w_full()
        .h(18.0)
        .px(0.0)
        .py(3.0)
        .radius(4.0)
        .fill(t.muted)
        .clip_rounded(4.0)
        .a11y_hidden();
    for pair in edges.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        if strip.now == Some(start) {
            bar = bar.child(el().w(2.0).self_stretch().fill(t.foreground));
        }
        let covering = |lane: u8| {
            strip
                .blocks
                .iter()
                .find(|b| b.lane == lane && b.start <= start && end <= b.end)
        };
        let (first, second) = (covering(0), covering(1));
        let top = first.map(|b| colour(b.source, b.past));
        let bottom = match (first, second) {
            (_, Some(b)) => Some(colour(b.source, b.past)),
            (Some(b), None) if !b.split => Some(colour(b.source, b.past)),
            _ => None,
        };
        // Grow is a share of the day: minutes keep it in an f32's range.
        let share = ((end - start) / 60_000).max(1) as f32;
        let half = |fill: Option<Color>| {
            let part = el().w_full().h(HALF);
            match fill {
                Some(fill) => part.fill(fill),
                None => part,
            }
        };
        bar = bar.child(
            col()
                .grow(share)
                .shrink()
                .min_w(0.0)
                .child(half(top))
                .child(half(bottom)),
        );
    }
    let mut hours = row().w_full().pt(2.0);
    for (n, pair) in strip.hours.windows(2).enumerate() {
        let share = ((pair[1] - pair[0]) / 60_000).max(1) as f32;
        let mut segment = row()
            .grow(share)
            .shrink()
            .min_w(0.0)
            .child(small_hour(pair[0], t));
        // The last label sits at the strip's end.
        if n + 2 == strip.hours.len() {
            segment = segment.justify_between().child(small_hour(pair[1], t));
        }
        hours = hours.child(segment);
    }
    col()
        .w_full()
        .px(12.0)
        .pt(4.0)
        .pb(2.0)
        .a11y_hidden()
        .child(bar)
        .child(hours)
}

fn small_hour(at: i64, t: &Theme) -> El {
    text(format::hour_label(at))
        .font(font(10.5, 400.0))
        .color(t.muted_foreground)
}

/// What is on now, or the next thing today, with its link to join.
fn next_view(key: &str, next: &ScheduleNext, now: i64, t: &Theme) -> El {
    let event = next.event;
    let when = if next.current {
        event.end.map_or_else(
            || "NOW".to_owned(),
            |end| format!("NOW · ENDS IN {}", duration(end - now).to_uppercase()),
        )
    } else {
        format!("NEXT · IN {}", duration(event.start - now).to_uppercase())
    };
    let mut meta = meta().child(small(span(event), t));
    if let Some(detail) = &event.detail {
        meta = meta.child(small(detail.clone(), t).wrap().shrink().min_w(0.0));
    }
    let name = text(event.title.clone())
        .font(font(14.0, 600.0))
        .color(t.foreground)
        .wrap()
        .shrink()
        .min_w(0.0);
    let name = match &event.url {
        Some(url) => link(name, format!("{key}-title"), &event.title, url),
        None => name,
    };
    let mut boxed = row()
        .key(key.to_owned())
        .w_full()
        .px(12.0)
        .py(10.0)
        .gap(10.0)
        .center_y()
        .radius(10.0)
        .fill(t.accent_soft)
        .child(
            col()
                .grow(1.0)
                .shrink()
                .min_w(0.0)
                .child(text(when).font(font(11.5, 600.0)).color(t.accent))
                .child(name)
                .child(meta),
        );
    if let Some(second) = &event.link {
        let url = second.url.clone();
        boxed = boxed.child(
            button(t, Kind::Primary, Size::Small, None, &second.label)
                .key(format!("{key}-link"))
                .role("link")
                .label(format!("{} (opens your browser)", second.label))
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_link(&url, tx)),
        );
    }
    row().w_full().px(12.0).pt(8.0).pb(10.0).child(boxed)
}

/// "All day", "7:30 – 8:30 PM" or a start alone.
fn span(event: &CardEvent) -> String {
    if event.all_day {
        "All day".to_owned()
    } else {
        match event.end {
            Some(end) => format::short_range(event.start, end),
            None => format::short_clock(event.start),
        }
    }
}

/// The column every event's start and end sit in, and that free time and
/// the line for now line up with.
const WHEN: f32 = 52.0;

/// One timed event: start over end in a column, then the event itself.
fn event_line(key: &str, card: &Card, event: &CardEvent, past: bool, t: &Theme) -> El {
    let ink = if past {
        t.muted_foreground
    } else {
        t.foreground
    };
    // The end says "AM" or "PM", so the start can leave it out.
    let mut when = col().w(WHEN).items_end().self_start().child(
        text(match event.end {
            Some(_) => format::bare_clock(event.start),
            None => format::short_clock(event.start),
        })
        .font(font(13.0, 600.0))
        .color(ink),
    );
    if let Some(end) = event.end {
        when = when.child(
            text(format::short_clock(end))
                .font(font(11.5, 400.0))
                .color(t.muted_foreground),
        );
    }
    let mut main = col().grow(1.0).shrink().min_w(0.0).child(title(
        key,
        &event.title,
        event.url.as_deref(),
        ink,
    ));
    if event.detail.is_some() || event.badge.is_some() {
        let mut parts = meta();
        if let Some(detail) = &event.detail {
            parts = parts.child(small(detail.clone(), t).wrap().shrink().min_w(0.0));
        }
        if let Some(badge) = &event.badge {
            parts = parts.child(self::badge(&badge.label, badge.tone, t));
        }
        main = main.child(parts);
    }
    let line = line(key)
        .child(when)
        // A schedule keeps the bar even when the card has one source.
        .child(bars(&event.sources, &card.sources, past, t))
        .child(main);
    match &event.link {
        Some(second) => line.child(self::second(key, second, t)),
        None => line,
    }
}

/// One day of a schedule: its strip, all-day events, what is next and its
/// agenda, under a heading when the card covers several days.
#[allow(clippy::too_many_arguments)]
fn schedule_day(
    mut body: El,
    s: &Ui,
    id: &str,
    card: &Card,
    day: &ScheduleDay,
    several: bool,
    now: i64,
    t: &Theme,
) -> El {
    let key = format!("rd-card-{id}-{}", day.day);
    if several {
        body = body.child(rule(t)).child(
            row()
                .w_full()
                .px(12.0)
                .pt(12.0)
                .pb(6.0)
                .gaps(2.0, 8.0)
                .flex_wrap()
                .justify_between()
                .child(
                    text(day_name(day))
                        .font(font(13.0, 600.0))
                        .color(t.foreground),
                )
                .child(small(
                    format!(
                        "{} · {} {}",
                        format::short_day(day.day),
                        day.events,
                        if day.events == 1 { "event" } else { "events" }
                    ),
                    t,
                )),
        );
    }
    if let Some(strip) = &day.strip {
        body = body.child(strip_view(strip, t));
    }
    if !day.all_day.is_empty() {
        let mut chips = row()
            .w_full()
            .px(12.0)
            .pt(6.0)
            .pb(2.0)
            .gaps(6.0, 6.0)
            .flex_wrap();
        for (n, event) in day.all_day.iter().enumerate() {
            let source = event.sources.first().copied().unwrap_or(0);
            chips = chips.child(
                row()
                    .gap(6.0)
                    .center_y()
                    .min_w(0.0)
                    .px(9.0)
                    .py(2.0)
                    .radius(999.0)
                    .fill(t.muted)
                    .child(
                        el().w(8.0)
                            .h(8.0)
                            .radius(4.0)
                            .fill(t.source(source))
                            .a11y_hidden(),
                    )
                    .child({
                        let name = text(event.title.clone())
                            .font(font(12.0, 400.0))
                            .color(t.foreground)
                            .wrap()
                            .shrink()
                            .min_w(0.0);
                        match &event.url {
                            Some(url) => link(name, format!("{key}-all-{n}"), &event.title, url),
                            None => name,
                        }
                    }),
            );
        }
        body = body.child(chips);
    }
    if let Some(next) = &day.next {
        body = body.child(next_view(&format!("{key}-next"), next, now, t));
    }
    if !day.earlier.is_empty() {
        let open = s.open_card_days.contains(&key);
        let names = day
            .earlier
            .iter()
            .map(|e| e.title.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let toggle = key.clone();
        body = body.child(rule(t)).child(
            row()
                .key(format!("{key}-earlier"))
                .w_full()
                .min_h(36.0)
                .px(12.0)
                .py(6.0)
                .gap(6.0)
                .center_y()
                .role("button")
                .label(format!(
                    "{} {} earlier: {names}",
                    if open { "Hide" } else { "Show" },
                    day.earlier.len()
                ))
                .cursor(Cursor::Pointer)
                .on_press(move |s: &mut Ui| Ui::toggle(&mut s.open_card_days, &toggle))
                .child(
                    icon(
                        if open {
                            &icons::CHEVRON_DOWN
                        } else {
                            &icons::CHEVRON_RIGHT
                        },
                        14.0,
                    )
                    .color(t.muted_foreground)
                    .a11y_hidden(),
                )
                .child(
                    text(format!("{} earlier · {names}", day.earlier.len()))
                        .font(font(12.5, 400.0))
                        .color(t.muted_foreground)
                        .wrap()
                        .shrink()
                        .min_w(0.0),
                ),
        );
        if open {
            for (n, event) in day.earlier.iter().enumerate() {
                body = body.child(rule(t)).child(event_line(
                    &format!("{key}-earlier-{n}"),
                    card,
                    event,
                    true,
                    t,
                ));
            }
        }
    }
    for (n, row_) in day.rows.iter().enumerate() {
        let key = format!("{key}-{n}");
        body = match row_ {
            TimelineRow::Now { at } => body.child(
                row()
                    .key(key)
                    .w_full()
                    .px(12.0)
                    .py(2.0)
                    .gap(10.0)
                    .center_y()
                    .child(
                        row().w(WHEN).justify_end().child(
                            text(format::bare_clock(*at))
                                .font(font(11.0, 600.0))
                                .color(t.accent),
                        ),
                    )
                    .child(el().h(1.0).grow(1.0).fill(t.accent).a11y_hidden()),
            ),
            // Past the time column and the bar, in line with the titles.
            TimelineRow::Gap {
                start,
                end,
                current,
                ..
            } => body.child(
                row()
                    .key(key)
                    .w_full()
                    .pl(12.0 + WHEN + 23.0)
                    .pr(12.0)
                    .py(4.0)
                    .gap(8.0)
                    .center_y()
                    .child(small(
                        if *current {
                            format!("Free until {}", format::short_clock(*end))
                        } else {
                            format!("Free {}", duration(end - start))
                        },
                        t,
                    ))
                    .child(el().h(1.0).grow(1.0).fill(t.border).a11y_hidden()),
            ),
            TimelineRow::Event { event, past } => body
                .child(rule(t))
                .child(event_line(&key, card, event, *past, t)),
            TimelineRow::Day { .. } => body,
        };
    }
    body
}

/// One task opened up: its facts, the start of its description, its steps.
fn item(
    mut body: El,
    fields: &[CardField],
    about: Option<&str>,
    steps: Option<&CardSteps>,
    today: i64,
    t: &Theme,
) -> El {
    if !fields.is_empty() {
        // The labels share the width of the longest, as the web's grid does.
        let label_width = fields
            .iter()
            .map(|field| field.label.chars().count())
            .max()
            .unwrap_or(0) as f32
            * 7.2;
        let mut grid = col().w_full().px(12.0).py(10.0).gap(6.0);
        for field in fields {
            let mut value = row()
                .grow(1.0)
                .shrink()
                .min_w(0.0)
                .gaps(4.0, 6.0)
                .center_y()
                .flex_wrap();
            let plain = |words: String| {
                text(words)
                    .font(font(13.0, 400.0))
                    .color(t.foreground)
                    .wrap()
                    .shrink()
                    .min_w(0.0)
            };
            if let Some(badge) = &field.badge {
                value = value.child(self::badge(&badge.label, badge.tone, t));
            }
            if !field.people.is_empty() {
                value = value
                    .child(people(&field.people, t))
                    .child(plain(field.people.join(", ")));
            }
            if let Some(date) = &field.due {
                value = value.child(plain(format::short_date(date)));
                if due_label(date, today).soon {
                    value = value.child(due(date, today, t));
                }
            }
            for tag in &field.tags {
                value = value.child(self::tag(tag, t));
            }
            if let Some(words) = &field.value {
                value = value.child(plain(words.clone()));
            }
            grid = grid.child(
                row()
                    .w_full()
                    .gap(14.0)
                    .child(
                        // At least the estimate, so values line up; wider
                        // when a label's letters are, so it never runs into
                        // its value.
                        text(field.label.clone())
                            .font(font(13.0, 400.0))
                            .color(t.muted_foreground)
                            .min_w(label_width.max(40.0)),
                    )
                    .child(value),
            );
        }
        body = body.child(rule(t)).child(grid);
    }
    if let Some(about) = about {
        body = body.child(rule(t)).child(
            row().w_full().px(12.0).py(10.0).child(
                text(about.to_owned())
                    .font(font(13.5, 400.0))
                    .color(t.foreground)
                    .wrap()
                    .shrink()
                    .min_w(0.0),
            ),
        );
    }
    if let Some(steps) = steps {
        let mut section = col().w_full().px(12.0).py(10.0).gap(4.0).child(small(
            format!("Steps · {} of {}", steps.done, steps.total),
            t,
        ));
        for step in &steps.items {
            let mut check = row().size(14.0, 14.0).radius(4.0).center().a11y_hidden();
            check = if step.done {
                check
                    .fill(t.accent)
                    .child(icon(&icons::CHECK, 10.0).color(t.card))
            } else {
                check.border(1.5, t.border)
            };
            section = section.child(
                row()
                    .role("listitem")
                    .label(format!(
                        "{}: {}",
                        if step.done { "Done" } else { "To do" },
                        step.label
                    ))
                    .w_full()
                    .gap(8.0)
                    .center_y()
                    .child(check)
                    .child(
                        text(step.label.clone())
                            .font(font(13.5, 400.0))
                            .color(if step.done {
                                t.muted_foreground
                            } else {
                                t.foreground
                            })
                            // A done step is struck through, as on the web.
                            .strikes(step.done.then_some((
                                0,
                                step.label.len(),
                                Some(t.muted_foreground),
                            )))
                            .wrap()
                            .shrink()
                            .min_w(0.0)
                            .a11y_hidden(),
                    ),
            );
        }
        let rest = steps.total.saturating_sub(steps.items.len() as u32);
        if rest > 0 {
            section = section.child(small(format!("{rest} more"), t));
        }
        body = body.child(rule(t)).child(section);
    }
    body
}

/// One row of a card, tall enough to press with a thumb.
fn line(key: &str) -> El {
    row()
        .key(key.to_owned())
        .w_full()
        .min_w(0.0)
        .min_h(44.0)
        .px(12.0)
        .py(8.0)
        .gap(10.0)
        .center_y()
}

/// The small parts of a row, on one line that wraps when it must.
fn meta() -> El {
    row().w_full().gaps(2.0, 6.0).center_y().flex_wrap()
}

/// Small quiet text: a key, a detail, a time, a count.
fn small(words: String, t: &Theme) -> El {
    text(words)
        .font(font(12.0, 400.0))
        .color(t.muted_foreground)
}

/// An item's title, linked when it has a page. It wraps rather than cuts.
fn title(key: &str, words: &str, url: Option<&str>, ink: Color) -> El {
    let name = text(words.to_owned())
        .font(font(14.0, 400.0))
        .color(ink)
        .wrap()
        .shrink()
        .min_w(0.0);
    match url {
        Some(url) => link(name, format!("{key}-title"), words, url),
        None => name,
    }
}

fn badge(label: &str, tone: CardTone, t: &Theme) -> El {
    let (ink, fill) = match tone {
        CardTone::Good => (t.accent, t.accent_soft),
        CardTone::Attention => (t.attention, t.attention_soft),
        CardTone::Bad => (t.error, t.muted),
        CardTone::Neutral | CardTone::Unknown => (t.muted_foreground, t.muted),
    };
    row().px(7.0).py(1.0).radius(999.0).fill(fill).child(
        text(label.to_owned())
            .font(font(10.5, 500.0).lh(15.75))
            .color(ink),
    )
}

/// A due date: a badge when it is close or past, plain words otherwise.
fn due(date: &str, today: i64, t: &Theme) -> El {
    let due = due_label(date, today);
    if due.soon {
        badge(&due.label, due.tone, t)
    } else {
        small(due.label, t)
    }
}

fn tag(label: &str, t: &Theme) -> El {
    row().px(6.0).radius(5.0).border(1.0, t.border).child(
        text(label.to_owned())
            .font(font(11.0, 400.0))
            .color(t.muted_foreground),
    )
}

/// A checklist's progress: a short bar and "2/5".
fn progress(progress: CardProgress, t: &Theme) -> El {
    let share = if progress.total == 0 {
        0.0
    } else {
        progress.done.min(progress.total) as f32 / progress.total as f32
    };
    row()
        .role("img")
        .label(format!(
            "{} of {} steps done",
            progress.done, progress.total
        ))
        .gap(5.0)
        .center_y()
        .child(
            row()
                .w(34.0)
                .h(4.0)
                .radius(2.0)
                .fill(t.muted)
                .clip_rounded(2.0)
                .a11y_hidden()
                .child(el().w(34.0 * share).h(4.0).fill(t.accent)),
        )
        .child(small(format!("{}/{}", progress.done, progress.total), t).a11y_hidden())
}

/// Who has it: their initials, named for a screen reader.
fn people(names: &[String], t: &Theme) -> El {
    let mut faces = row()
        .role("img")
        .label(format!("Assigned to {}", names.join(", ")))
        .help(names.join(", "))
        .gap(2.0);
    for name in names {
        faces = faces.child(
            row()
                .size(22.0, 22.0)
                .radius(11.0)
                .center()
                .fill(t.accent_soft)
                .a11y_hidden()
                .child(
                    text(initials(name))
                        .font(font(10.0, 600.0).lh(12.0))
                        .color(t.accent),
                ),
        );
    }
    faces
}

/// A second link beside a row, such as a meeting's "Join".
fn second(key: &str, second: &CardLink, t: &Theme) -> El {
    let url = second.url.clone();
    button(t, Kind::Outline, Size::Small, None, &second.label)
        .key(format!("{key}-link"))
        .role("link")
        .label(format!("{} (opens your browser)", second.label))
        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_link(&url, tx))
}

/// One coloured bar per source of an item.
fn bars(of: &[usize], names: &[String], past: bool, t: &Theme) -> El {
    let label = of
        .iter()
        .filter_map(|position| names.get(*position).map(String::as_str))
        .collect::<Vec<_>>()
        .join(" and ");
    let mut bars = row().min_h(20.0).gap(2.0).self_stretch();
    bars = if label.is_empty() {
        bars.a11y_hidden()
    } else {
        bars.role("img").label(label)
    };
    // With one source or none, the bar takes the first colour; with
    // several, an item that names none has no bar.
    let first = [0];
    let shown = if of.is_empty() && names.len() < 2 {
        &first[..]
    } else {
        of
    };
    for position in shown {
        let colour = t.source(*position);
        bars = bars.child(
            el().w(3.0)
                .radius(2.0)
                .self_stretch()
                .fill(if past { colour.alpha(0.45) } else { colour })
                .a11y_hidden(),
        );
    }
    bars
}

/// A group's, column's or day's heading on the muted band, with its count.
fn heading(label: String, count: Option<u32>, t: &Theme) -> El {
    let words = |words: String| {
        text(words)
            .font(font(12.0, 500.0))
            .color(t.muted_foreground)
    };
    let mut band = row()
        .w_full()
        .px(12.0)
        .py(6.0)
        .gap(8.0)
        .justify_between()
        .fill(t.muted)
        .child(words(label));
    if let Some(count) = count {
        band = band.child(words(count.to_string()));
    }
    band
}

fn rule(t: &Theme) -> El {
    col().h(1.0).w_full().fill(t.border).a11y_hidden()
}

fn out_arrow(t: &Theme) -> El {
    icon(&icons::ARROW_UP_RIGHT, 12.0)
        .color(t.muted_foreground)
        .a11y_hidden()
}

/// Makes `e` open `url` in the owner's browser.
fn link(e: El, key: String, name: &str, url: &str) -> El {
    let url = url.to_owned();
    e.key(key)
        .role("link")
        .label(format!("{name} (opens your browser)"))
        .focusable(true)
        .cursor(Cursor::Pointer)
        .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_link(&url, tx))
}
