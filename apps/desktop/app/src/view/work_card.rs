//! One run of a work item in the chat, as a card rather than a message: a
//! scheduled job's post, background work's result, or what background work
//! waits on the owner for.
//!
//! Mirrors `apps/web/src/domains/conversations/presentation/work-card.tsx`
//! and its `.work-card` rules in `bot-workspace.css`.

use raphie_core::contracts::QuoteAuthor;
use rune::{El, Tx, col, icon, row, text};

use super::Look;
use super::handoffs;
use crate::format;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::widgets::{Kind as ButtonKind, Size, button};

/// What produced the card.
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Scheduled,
    Background,
}

/// The run's state, in the header.
#[derive(Clone, Copy, PartialEq)]
pub enum Status {
    Working,
    Done,
    Failed,
    Cancelled,
    NeedsYou,
}

/// Below this width of the chat, the kind shows as its icon only: the title
/// needs the room (the web's 480px rule).
const NARROW_CARD: f32 = 520.0;

/// About four lines of a reply at the chat's size, folded below that.
const FOLDED_HEIGHT: f32 = 92.0;

/// The card's parts. `text` is what came back, folded when long; `extra`
/// follows it unfolded (tool steps, a question); `turn_id` keys the card and
/// lets its text be quoted.
pub struct Card<'a> {
    pub key: String,
    pub kind: Kind,
    pub title: &'a str,
    pub item_id: Option<&'a str>,
    pub at: Option<i64>,
    pub status: Option<Status>,
    /// The title's tooltip; the title itself when not given.
    pub hint: Option<String>,
    pub text: Option<&'a str>,
    /// The turn whose reply the text is, for quoting it.
    pub turn_id: Option<&'a str>,
}

pub fn card(s: &Ui, card: Card<'_>, extra: Vec<El>, look: &Look) -> El {
    let t = &look.theme;
    let key = |part: &str| format!("{}-{part}", card.key);
    let mut header = row()
        .key(key("head"))
        .w_full()
        .min_w(0.0)
        .px(14.0)
        .py(9.0)
        .gap(8.0)
        .center_y()
        .child(kind_label(
            card.kind,
            s.narrow() || s.main_width() < NARROW_CARD,
            t,
        ))
        .child(
            text(card.title.to_string())
                .font(font(13.5, 600.0))
                .color(t.foreground)
                .truncate()
                .shrink()
                .grow(1.0)
                .help(card.hint.clone().unwrap_or_else(|| card.title.to_string())),
        );
    if let Some(id) = card.item_id {
        header = header.child(
            row().px(6.0).py(1.0).radius(5.0).fill(t.muted).child(
                text(id.to_string())
                    .font(mono(11.0))
                    .color(t.muted_foreground)
                    .single_line(),
            ),
        );
    }
    match (card.status, card.at) {
        (Some(status), _) => header = header.child(status_badge(status, t)),
        (None, Some(at)) => header = header.child(clock(at, t)),
        _ => {}
    }

    let mut body = col()
        .key(key("body"))
        .w_full()
        .min_w(0.0)
        .px(14.0)
        .py(12.0)
        .gap(10.0);
    let mut has_body = false;
    if let Some(source) = card.text.filter(|text| !text.trim().is_empty()) {
        has_body = true;
        let fold_id = card.key.clone();
        let open = s.unfolded_work.contains(&fold_id);
        let tall = is_tall(source);
        let mut content = col()
            .key(key("text"))
            .w_full()
            .min_w(0.0)
            .child(handoffs::markdown(s, source, look));
        if tall && !open {
            content = content.max_h(FOLDED_HEIGHT).clip_fade(0.0, 0.0, 0.0, 36.0);
        }
        body = body.child(content);
        if tall {
            body = body.child(
                text(if open { "Show less" } else { "Show more" })
                    .key(key("more"))
                    .role("button")
                    .font(font(12.5, 500.0))
                    .color(t.accent)
                    .focus_ring(2.0, 2.0, t.accent)
                    .on_press(move |s: &mut Ui| {
                        if !s.unfolded_work.remove(&fold_id) {
                            s.unfolded_work.insert(fold_id.clone());
                        }
                    }),
            );
        }
    }
    if !extra.is_empty() {
        has_body = true;
        body = body.children(extra);
    }

    let mut footer = row()
        .key(key("foot"))
        .w_full()
        .px(10.0)
        .pb(8.0)
        .gap(2.0)
        .center_y();
    let mut has_footer = false;
    if let (Some(turn_id), Some(source)) = (card.turn_id, card.text)
        && card.status != Some(Status::Working)
        && !source.trim().is_empty()
    {
        has_footer = true;
        let (turn_id, source) = (turn_id.to_owned(), source.to_owned());
        footer = footer.child(
            button(
                t,
                ButtonKind::Ghost,
                Size::Tiny,
                Some(&icons::CORNER_UP_LEFT),
                "Quote",
            )
            .key(key("quote"))
            .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                s.quote(&turn_id, QuoteAuthor::Bot, &source);
                tx.focus("rd-composer", false);
            }),
        );
    }
    if card.item_id.is_some() {
        has_footer = true;
        footer = footer.child(
            button(
                t,
                ButtonKind::Ghost,
                Size::Tiny,
                Some(&icons::EXTERNAL_LINK),
                "Open item",
            )
            .key(key("open"))
            .on_press(|s: &mut Ui| {
                let bot_id = s.model.bot_id.clone().unwrap_or_else(|| "default".into());
                s.open_settings(Some(Page::Bot {
                    bot_id,
                    section: BotSection::Work,
                }));
            }),
        );
    }
    if let (Some(_), Some(at)) = (card.status, card.at) {
        has_footer = true;
        footer = footer.child(row().grow(1.0)).child(clock(at, t).pr(4.0));
    }

    let mut el = col()
        .key(card.key.clone())
        .w_full()
        .min_w(0.0)
        .radius(12.0)
        .fill(t.card)
        .border(1.0, t.border)
        .label(format!(
            "{}: {}",
            match card.kind {
                Kind::Scheduled => "Scheduled job",
                Kind::Background => "Background work",
            },
            card.title
        ))
        .child(header);
    if has_body {
        el = el.child(row().w_full().h(1.0).fill(t.border)).child(body);
    }
    if has_footer {
        el = el.child(footer);
    }
    el
}

/// The icon and, unless the window is narrow, the words for what made the card.
fn kind_label(kind: Kind, narrow: bool, t: &Theme) -> El {
    let (glyph, words) = match kind {
        Kind::Scheduled => (&icons::CALENDAR_CLOCK, "Scheduled"),
        Kind::Background => (&icons::LIST_CHECKS, "Background work"),
    };
    let mut label = row()
        .gap(6.0)
        .center_y()
        .child(icon(glyph, 13.0).color(t.accent).a11y_hidden());
    if !narrow {
        label = label.child(
            text(words)
                .font(font(12.5, 500.0))
                .color(t.accent)
                .single_line(),
        );
    }
    label
}

fn status_badge(status: Status, t: &Theme) -> El {
    let (words, ink, fill) = match status {
        Status::Working => ("Working", t.accent, t.accent_soft),
        Status::Done => ("Done", t.accent, t.accent_soft),
        Status::Failed => ("Failed", t.error, t.muted),
        Status::Cancelled => ("Cancelled", t.muted_foreground, t.muted),
        Status::NeedsYou => ("Needs you", t.attention, t.attention_soft),
    };
    row()
        .px(8.0)
        .py(2.0)
        .gap(5.0)
        .center_y()
        .radius(999.0)
        .fill(fill)
        .child(row().size(6.0, 6.0).radius(3.0).fill(ink))
        .child(text(words).font(font(11.5, 600.0)).color(ink).single_line())
}

fn clock(at: i64, t: &Theme) -> El {
    text(format::clock(at))
        .font(font(12.0, 400.0))
        .color(t.muted_foreground)
        .single_line()
}

/// Whether a reply runs past about four lines of the card: the web measures
/// it; here a long text or one of many lines folds.
fn is_tall(source: &str) -> bool {
    source.trim().chars().count() > 360 || source.trim().lines().count() > 4
}
