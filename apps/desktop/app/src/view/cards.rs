//! A card the bot showed under its reply, as the web's `ShownCard` draws
//! it: rows in groups, or a day's events, with links out. Read-only.
//!
//! In sync with `apps/web/src/shared/styles/cards.css`. The web lines a
//! timeline's times up with a grid; here the time column has one width,
//! which fits because this app always writes times the same way.

use raphie_core::cards::{TimelineRow, timeline_rows};
use raphie_core::contracts::{
    Card, CardBadge, CardBody, CardEvent, CardGroup, CardLink, CardRow, CardTimelineItem, CardTone,
    SessionCard,
};
use rune::{Color, Cursor, El, Tx, col, el, icon, row, text};

use super::Look;
use crate::format;
use crate::icons;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, button};

/// Wide enough for "11:30 AM – 12:45 PM" at the time column's size.
const TIME_WIDTH: f32 = 128.0;

pub fn card(shown: &SessionCard, now: i64, look: &Look) -> El {
    let t = &look.theme;
    let card = &shown.card;
    let id = &shown.id;
    let mut body = col()
        .key(format!("rd-card-{id}"))
        .role("group")
        .label(card.title.clone())
        .w_full()
        .max_w(520.0)
        .mt(8.0)
        .mb(4.0)
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .clip_rounded(12.0)
        .child(head(shown, now, t));
    if card.sources.len() > 1 {
        body = body.child(legend(&card.sources, t));
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
                    .child(
                        text(stat.label.clone())
                            .font(font(12.0, 400.0))
                            .color(t.muted_foreground),
                    ),
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
        CardBody::List { groups } => list(body, id, card, groups, t),
        CardBody::Timeline { items } => timeline(body, id, card, items, now, t),
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
        let mut foot = row().w_full().px(12.0).py(8.0).gap(4.0).center_y();
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

/// The title, linked when the card has a page, and where and when it was read.
fn head(shown: &SessionCard, now: i64, t: &Theme) -> El {
    let card = &shown.card;
    let title = text(card.title.clone())
        .font(font(14.0, 600.0))
        .color(t.foreground)
        .wrap()
        .shrink()
        .min_w(0.0);
    let mut name = row().gap(4.0).center_y().shrink().min_w(0.0);
    name = match &card.url {
        Some(url) => name
            .child(link(
                title,
                format!("rd-card-{}-title", shown.id),
                &card.title,
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
    let meta = match card.sources.as_slice() {
        [only] => format!("{only} · as of {read}"),
        _ => format!("as of {read}"),
    };
    row()
        .w_full()
        .px(12.0)
        .py(10.0)
        .gaps(2.0, 8.0)
        .flex_wrap()
        .justify_between()
        .child(name)
        .child(text(meta).font(font(12.0, 400.0)).color(t.muted_foreground))
}

/// Which colour stands for which source, when a card mixes several.
fn legend(sources: &[String], t: &Theme) -> El {
    let mut line = row()
        .role("list")
        .label("Sources")
        .w_full()
        .px(12.0)
        .pb(10.0)
        .gaps(4.0, 12.0)
        .flex_wrap();
    for (position, name) in sources.iter().enumerate() {
        line = line.child(
            row()
                .gap(5.0)
                .center_y()
                .child(
                    el().size(8.0, 8.0)
                        .radius(4.0)
                        .fill(t.source(position))
                        .a11y_hidden(),
                )
                .child(
                    text(name.clone())
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground),
                ),
        );
    }
    line
}

fn list(mut body: El, id: &str, card: &Card, groups: &[CardGroup], t: &Theme) -> El {
    for (g, group) in groups.iter().enumerate() {
        if let Some(label) = &group.label {
            body = body.child(rule(t)).child(heading(label.clone(), t));
        }
        for (r, item) in group.rows.iter().enumerate() {
            body = body.child(rule(t)).child(list_row(
                &format!("rd-card-{id}-{g}-{r}"),
                card,
                item,
                t,
            ));
        }
    }
    body
}

fn list_row(key: &str, card: &Card, item: &CardRow, t: &Theme) -> El {
    let mut line = line(key);
    if card.sources.len() > 1 {
        line = line.child(bars(&item.sources, &card.sources, false, t));
    }
    if let Some(id) = &item.key {
        line = line.child(
            text(id.clone())
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .min_w(44.0),
        );
    }
    line = line.child(main(
        key,
        &item.title,
        item.url.as_deref(),
        item.detail.as_deref(),
        t.foreground,
        t,
    ));
    match extras(
        key,
        item.badge.as_ref(),
        item.link.as_ref(),
        item.trailing.as_deref(),
        t,
    ) {
        Some(extras) => line.child(extras),
        None => line,
    }
}

fn timeline(
    mut body: El,
    id: &str,
    card: &Card,
    items: &[CardTimelineItem],
    now: i64,
    t: &Theme,
) -> El {
    for (n, item) in timeline_rows(items, now, format::local_day)
        .iter()
        .enumerate()
    {
        let key = format!("rd-card-{id}-{n}");
        body = match item {
            TimelineRow::Day { date } => body
                .child(rule(t))
                .child(heading(format::weekday_date(date), t)),
            TimelineRow::Now { at } => body.child(
                row()
                    .key(key)
                    .w_full()
                    .px(12.0)
                    .py(2.0)
                    .gap(8.0)
                    .center_y()
                    .child(
                        text(format!("Now · {}", format::clock(*at)))
                            .font(font(11.0, 600.0))
                            .color(t.accent),
                    )
                    .child(el().h(1.0).grow(1.0).fill(t.accent).a11y_hidden()),
            ),
            TimelineRow::Gap {
                start,
                end,
                current,
                ..
            } => body.child(
                row()
                    .key(key)
                    .w_full()
                    .px(12.0)
                    .py(4.0)
                    .gap(10.0)
                    .child(el().w(TIME_WIDTH).a11y_hidden())
                    .child(el().w(8.0).a11y_hidden())
                    .child(
                        text(if *current {
                            format!("Free until {}", format::clock(*end))
                        } else {
                            format!("Free {}", format::clock_range(*start, *end))
                        })
                        .font(font(12.0, 400.0))
                        .color(t.muted_foreground)
                        .wrap()
                        .shrink()
                        .min_w(0.0),
                    ),
            ),
            TimelineRow::Event { event, past } => body
                .child(rule(t))
                .child(event_row(&key, card, event, *past, t)),
        };
    }
    body
}

fn event_row(key: &str, card: &Card, event: &CardEvent, past: bool, t: &Theme) -> El {
    let when = if event.all_day {
        "All day".to_owned()
    } else {
        match event.end {
            Some(end) => format::clock_range(event.start, end),
            None => format::clock(event.start),
        }
    };
    let ink = if past {
        t.muted_foreground
    } else {
        t.foreground
    };
    let line = line(key)
        .child(
            text(when)
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .w(TIME_WIDTH),
        )
        // A timeline keeps the bar's column even when the card has one source.
        .child(bars(&event.sources, &card.sources, past, t))
        .child(main(
            key,
            &event.title,
            event.url.as_deref(),
            event.detail.as_deref(),
            ink,
            t,
        ));
    match extras(key, event.badge.as_ref(), event.link.as_ref(), None, t) {
        Some(extras) => line.child(extras),
        None => line,
    }
}

/// One row of a card. Its badge, link and age go under the title when the
/// card is too narrow to hold them beside it.
fn line(key: &str) -> El {
    row()
        .key(key.to_owned())
        .w_full()
        .min_w(0.0)
        .px(12.0)
        .py(8.0)
        .gaps(4.0, 10.0)
        .center_y()
        .flex_wrap()
}

/// The title, linked when the item has a page, over its one line of detail.
fn main(
    key: &str,
    title: &str,
    url: Option<&str>,
    detail: Option<&str>,
    ink: Color,
    t: &Theme,
) -> El {
    let name = text(title.to_owned())
        .font(font(14.0, 400.0))
        .color(ink)
        .wrap()
        .shrink()
        .min_w(0.0);
    let mut main = col().grow(1.0).shrink().min_w(120.0).child(match url {
        Some(url) => link(name, format!("{key}-title"), title, url),
        None => name,
    });
    if let Some(detail) = detail {
        main = main.child(
            text(detail.to_owned())
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap()
                .shrink()
                .min_w(0.0),
        );
    }
    main
}

fn extras(
    key: &str,
    badge: Option<&CardBadge>,
    second: Option<&CardLink>,
    trailing: Option<&str>,
    t: &Theme,
) -> Option<El> {
    if badge.is_none() && second.is_none() && trailing.is_none() {
        return None;
    }
    let mut extras = row().gap(8.0).center_y();
    if let Some(badge) = badge {
        let (ink, fill) = match badge.tone {
            CardTone::Good => (t.accent, t.accent_soft),
            CardTone::Attention => (t.attention, t.attention_soft),
            CardTone::Bad => (t.error, t.muted),
            CardTone::Neutral | CardTone::Unknown => (t.muted_foreground, t.muted),
        };
        extras = extras.child(
            row().px(7.0).py(1.0).radius(999.0).fill(fill).child(
                text(badge.label.clone())
                    .font(font(10.5, 500.0).lh(15.75))
                    .color(ink),
            ),
        );
    }
    if let Some(second) = second {
        let url = second.url.clone();
        extras = extras.child(
            button(t, Kind::Outline, Size::Tiny, None, &second.label)
                .key(format!("{key}-link"))
                .role("link")
                .label(format!("{} (opens your browser)", second.label))
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_link(&url, tx)),
        );
    }
    if let Some(trailing) = trailing {
        extras = extras.child(
            text(trailing.to_owned())
                .font(font(12.0, 400.0))
                .color(t.muted_foreground),
        );
    }
    Some(extras)
}

/// One coloured bar per source of an item.
fn bars(of: &[usize], names: &[String], past: bool, t: &Theme) -> El {
    let label = of
        .iter()
        .filter_map(|position| names.get(*position).map(String::as_str))
        .collect::<Vec<_>>()
        .join(" and ");
    let mut bars = row().w(8.0).min_h(20.0).gap(2.0).self_stretch();
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

/// A group's or a day's heading, on the muted band.
fn heading(label: String, t: &Theme) -> El {
    row().w_full().px(12.0).py(6.0).fill(t.muted).child(
        text(label)
            .font(font(12.0, 500.0))
            .color(t.muted_foreground),
    )
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
