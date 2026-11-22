//! The team down the left edge: requests that wait on the owner, one row
//! per bot with what it is doing, the selected bot's conversations, and the
//! brand with where Raphie runs and the settings gear.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/bot-sidebar.tsx` and
//! the `.bot-roster` rules in `bot-workspace.css`.

use raphie_core::contracts::{BotProfile, SessionSummary};
use raphie_core::model::StreamStatus;
use rune::color::hex;
use rune::{Color, El, Icon, LiveRegion, ScrollSpec, TextCase, col, el, icon, row, text};

use super::Look;
use super::sessions::sessions;
use crate::avatar::{bot_avatar, tone_of};
use crate::icons;
use crate::sections::Page;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::widgets::{build_badge, build_badge_width, icon_button, one_line, pressable};

/// What a teammate is doing, from its conversations as last heard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    NeedsYou,
    NeedsSetup,
    Working,
    Replied(usize),
    Available,
}

impl Presence {
    pub fn label(self) -> String {
        match self {
            Presence::NeedsYou => "Needs you".into(),
            Presence::NeedsSetup => "Needs setup".into(),
            Presence::Working => "Working".into(),
            Presence::Replied(1) => "1 new reply".into(),
            Presence::Replied(n) => format!("{n} new replies"),
            Presence::Available => "Available".into(),
        }
    }

    fn color(self, t: &Theme) -> Color {
        match self {
            Presence::NeedsYou | Presence::NeedsSetup => t.attention,
            Presence::Replied(_) => t.accent,
            _ => t.muted_foreground,
        }
    }

    fn dot(self, t: &Theme) -> Color {
        match self {
            Presence::NeedsYou => t.attention,
            Presence::NeedsSetup => t.muted_foreground,
            // The web's `--info` fallback, a calm blue.
            Presence::Working => hex("#4a6fa5").unwrap_or(t.accent),
            _ => t.accent,
        }
    }
}

/// A conversation that waits on the owner: an approval or a question.
pub fn needs_you(session: &SessionSummary) -> bool {
    session.waiting || session.asking
}

pub fn presence(s: &Ui, bot_id: &str) -> Presence {
    let sessions = s.sessions_of(bot_id);
    // Known only once the bot's settings are here.
    let unready = s
        .model
        .settings
        .get(bot_id)
        .is_some_and(|settings| settings.models.is_empty());
    if sessions.iter().any(|session| needs_you(session)) {
        Presence::NeedsYou
    } else if unready {
        Presence::NeedsSetup
    } else if sessions.iter().any(|session| session.working) {
        Presence::Working
    } else {
        match sessions
            .iter()
            .filter(|session| s.unread_in(bot_id, session) > 0)
            .count()
        {
            0 => Presence::Available,
            n => Presence::Replied(n),
        }
    }
}

/// The section label above a group (the web's `.roster-label`).
fn label(t: &Theme, words: &str) -> El {
    text(words)
        .font(font(10.0, 400.0).tracking(1.0))
        .color(t.muted_foreground)
        // Drawn in capitals; screen readers hear the words as written.
        .text_case(TextCase::Uppercase)
}

pub fn roster(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let width = s.visible_roster_width();
    let bots = &s.model.bots;
    let mut list = col().w_full();
    for bot in bots {
        list = list.child(bot_row(s, bot, look));
    }
    list = list.child(add_row(t));
    let mut bots_list = col()
        .key("rd-bots")
        .role("navigation")
        .label("Your team")
        .w_full()
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .child(list);
    // The bots take what they need, up to two fifths of the window, and
    // scroll past that; the selected bot's conversations fill the rest.
    if s.workspace_height > 0.0 {
        bots_list = bots_list.max_h((s.workspace_height * 0.4).floor());
    }
    col()
        .key("rd-roster")
        .w(width)
        .h_full()
        .pb(14.0)
        .fill(t.sidebar)
        // Only a right edge: `[top, right, bottom, left]` widths.
        .border_sides([0.0, 1.0, 0.0, 0.0], t.border)
        // A band as tall as the header beside it, which holds the window's
        // own buttons and the build badge, and moves the window.
        .child(band(s, look, width))
        .children(requests(s, look))
        .child(row().w_full().px(22.0).pb(8.0).child(label(t, "Your team")))
        .child(bots_list)
        .child(sessions(s, look))
        .child(footer(s, look))
}

/// Conversations waiting on the owner, from every bot, newest first.
fn requests(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let mut waiting: Vec<(&BotProfile, &SessionSummary)> = s
        .model
        .bots
        .iter()
        .flat_map(|bot| {
            s.sessions_of(&bot.id)
                .into_iter()
                .filter(|session| needs_you(session))
                .map(move |session| (bot, session))
        })
        .collect();
    if waiting.is_empty() {
        return None;
    }
    waiting.sort_by_key(|(_, session)| std::cmp::Reverse(session.last_at));
    let mut list = col()
        .key("rd-requests")
        .role("region")
        .label("Needs you")
        .w_full()
        .px(12.0)
        .pb(14.0)
        .gap(6.0);
    for (bot, session) in waiting.into_iter().take(3) {
        let headline = format!(
            "{} {}",
            bot.name,
            if session.asking {
                "has a question"
            } else {
                "needs your OK"
            }
        );
        let card = row()
            .key(format!("rd-request-{}", session.id))
            .role("button")
            .label(format!("{headline}: {}", session.title))
            .w_full()
            .px(10.0)
            .py(8.0)
            .gap(10.0)
            .center_y()
            .radius(10.0)
            .fill(t.attention_soft.mix(t.card, 0.45))
            .border(1.0, t.attention.mix(t.border, 0.65))
            .child(bot_avatar(&bot.id, look.tones.of(&bot.id), 22.0))
            .child(
                col()
                    .grow(1.0)
                    .min_w(0.0)
                    .child(one_line(headline, font(12.0, 600.0), t.foreground))
                    .child(one_line(
                        session.title.clone(),
                        font(11.0, 400.0),
                        t.muted_foreground,
                    )),
            );
        let (bot_id, session_id) = (bot.id.clone(), session.id.clone());
        list = list.child(pressable(card, true, move |s: &mut Ui| {
            s.open_conversation(&bot_id, &session_id)
        }));
    }
    Some(list)
}

fn bot_row(s: &Ui, bot: &BotProfile, look: &Look) -> El {
    let t = &look.theme;
    let tone = look.tones.of(&bot.id);
    let selected = s.model.bot_id.as_deref() == Some(bot.id.as_str());
    let status = presence(s, &bot.id);
    let id = bot.id.clone();
    let row = row()
        .key(format!("rd-bot-{}", bot.id))
        .role("button")
        .label(format!("{}, {}", bot.name, status.label()))
        .w_full()
        .px(22.0)
        .py(5.0)
        .gap(12.0)
        .center_y()
        .child(
            row()
                .size(28.0, 28.0)
                .center()
                .radius(8.0)
                .fill(tone.body.alpha(if selected { 0.22 } else { 0.12 }))
                .child(bot_avatar(&bot.id, tone, 24.0))
                // A presence dot on the corner, ringed in the sidebar's colour.
                .child(
                    el().key(format!("rd-bot-{}-presence", bot.id))
                        .size(10.0, 10.0)
                        .radius(5.0)
                        .fill(status.dot(t))
                        .border(2.0, t.sidebar)
                        .absolute(20.0, 20.0)
                        .a11y_hidden(),
                ),
        )
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .child(one_line(bot.name.clone(), font(13.0, 550.0), t.foreground))
                .child(
                    one_line(status.label(), font(11.5, 400.0), status.color(t))
                        .key(format!("rd-bot-{}-status", bot.id)),
                ),
        );
    // The selected row is washed in the bot's own colour; the others show
    // the hover colour under the pointer.
    let row = if selected {
        row.fill(tone.body.alpha(0.22))
    } else {
        row.hover(t.hover)
    };
    // `move` gives the closure its own copy of `id`, since it outlives this
    // function.
    pressable(row, true, move |s: &mut Ui| s.choose_bot(&id))
}

/// "Add a teammate", the last row of the team.
fn add_row(t: &Theme) -> El {
    let row = row()
        .key("rd-add-teammate")
        .role("button")
        .label("Add a teammate")
        .w_full()
        .px(22.0)
        .py(5.0)
        .gap(12.0)
        .center_y()
        .hover(t.hover)
        .child(
            row()
                .size(28.0, 28.0)
                .center()
                .radius(14.0)
                .fill(t.muted)
                .child(
                    icon(&icons::PLUS, 15.0)
                        .color(t.muted_foreground)
                        .a11y_hidden(),
                ),
        )
        .child(one_line(
            "Add a teammate",
            font(13.0, 400.0),
            t.muted_foreground,
        ));
    pressable(row, true, |s: &mut Ui| s.open_settings(Some(Page::NewBot)))
}

/// The small ghost button at the end of a roster label (the web's
/// `.roster-label-action`, an `icon-xs` button): 21 points with a 10.5-point
/// glyph, pulled into the label's padding so the row stays as tall as its
/// text.
pub fn label_action(t: &Theme, glyph: &'static Icon, label: &str) -> El {
    row()
        .role("button")
        .label(label)
        .help(label)
        .size(21.0, 21.0)
        .mx(-4.0)
        .my(-6.0)
        .center()
        .radius(5.25)
        .hover(t.hover)
        .press(t.hover)
        .focus_ring(2.0, 2.0, t.accent)
        .child(icon(glyph, 10.5).color(t.muted_foreground).a11y_hidden())
}

/// A preview without Markdown markers, on one line (the web's `sessionPreview`).
pub fn plain(preview: &str) -> String {
    preview
        .replace(['*', '_', '`', '#'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The brand, where Raphie runs, and the settings gear at the brand mark's
/// size. "Not answering" when the last check found Raphie down, and
/// "Reconnecting…" while the open conversation's stream is down.
fn footer(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let answering = s.model.reach.is_up();
    let streaming = s
        .model
        .conversation
        .as_ref()
        .is_none_or(|c| c.stream != StreamStatus::Reconnecting);
    let online = answering && streaming;
    let origin = s.model.origin.as_ref();
    let place = match origin {
        Some(origin) if !origin.is_local() => origin.host(),
        _ => "This Mac".to_owned(),
    };
    let wordmark = font(13.0, 650.0).tracking(-0.1);
    let brand = tone_of("#b5c99b").unwrap_or_else(|| look.tones.of("default"));
    row()
        .key("rd-account")
        .w_full()
        .mt(12.0)
        .pl(16.0)
        .pr(10.0)
        .gap(8.0)
        .center_y()
        .child(bot_avatar("default", brand, MARK))
        .child(text("raphie").font(wordmark).color(t.foreground))
        .child(
            row()
                .grow(1.0)
                .min_w(0.0)
                .ml(4.0)
                .gap(6.0)
                .center_y()
                .help(origin.map(ToString::to_string).unwrap_or_default())
                .child(
                    el().size(6.0, 6.0)
                        .radius(3.0)
                        .fill(if online { t.accent } else { t.attention })
                        .a11y_hidden(),
                )
                .child(
                    one_line(
                        if !answering {
                            "Not answering".to_owned()
                        } else if streaming {
                            place
                        } else {
                            "Reconnecting…".to_owned()
                        },
                        font(12.0, 400.0),
                        t.muted_foreground,
                    )
                    .key("rd-stream-status")
                    .shrink()
                    .live_region(LiveRegion::Polite),
                ),
        )
        .child(
            icon_button(t, &icons::SETTINGS, GEAR, "Settings (⌘,)")
                .key("rd-settings")
                .on_press(|s: &mut Ui| s.open_settings(None)),
        )
}

/// The top band: the window's buttons, then a dev or nightly build's badge,
/// which says its word only when the roster has room for it.
fn band(s: &Ui, look: &Look, width: f32) -> El {
    let t = &look.theme;
    let inset = if look.lights > 0.0 {
        look.lights + 12.0
    } else {
        20.0
    };
    let compact = inset + build_badge_width(s.flavor, s.release_channel) + 12.0 > width;
    row()
        .w_full()
        .h(if look.lights > 0.0 { 44.0 } else { 14.0 })
        .pl(inset)
        .center_y()
        .window_drag()
        // An `Option` is a list of none or one, which is what `children` takes.
        .children(build_badge(t, s.flavor, s.release_channel, compact))
}

/// The brand mark's box. Its blob fills about four fifths of it, so the
/// gear's glyph is drawn that size to look as large.
const MARK: f32 = 22.0;
const GEAR: f32 = 18.0;
