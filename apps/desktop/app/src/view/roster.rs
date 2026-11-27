//! The team down the left edge: requests that wait on the owner, one row
//! per bot with what it is doing, and the brand with where Raphie runs and
//! the settings gear.
//!
//! Mirrors `apps/web/src/domains/settings/presentation/bot-sidebar.tsx` and
//! the `.bot-roster` rules in `bot-workspace.css`.

use raphie_core::contracts::{BotProfile, SessionSummary};
use raphie_core::model::StreamStatus;
use rune::color::hex;
use rune::{Color, El, LiveRegion, ScrollSpec, TextCase, col, el, icon, row, text};

use super::Look;
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
            Presence::Replied(1) => "1 new message".into(),
            Presence::Replied(n) => format!("{n} new messages"),
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

/// What waits on the owner from one teammate, for the roster: how many
/// questions and approvals, whether one is a question, and the conversation
/// to open, its chat when it has one, where the dock asks them all.
pub struct WaitingOnOwner<'a> {
    pub count: u32,
    pub asking: bool,
    pub session: &'a SessionSummary,
    pub last_at: i64,
}

/// What waits on the owner in a teammate's `sessions`, if anything does.
/// A session that cannot count what waits counts as one.
pub fn waiting_on_owner<'a>(sessions: &[&'a SessionSummary]) -> Option<WaitingOnOwner<'a>> {
    let waiting: Vec<&SessionSummary> = sessions
        .iter()
        .copied()
        .filter(|session| needs_you(session))
        .collect();
    let latest = waiting
        .iter()
        .copied()
        .max_by_key(|session| session.last_at)?;
    Some(WaitingOnOwner {
        count: waiting
            .iter()
            .map(|session| session.pending.unwrap_or(1).max(1))
            .sum(),
        asking: waiting.iter().any(|session| session.asking),
        session: sessions
            .iter()
            .copied()
            .find(|session| session.chat)
            .unwrap_or(latest),
        last_at: latest.last_at,
    })
}

/// The roster's line for what one teammate waits on the owner for.
pub fn waiting_line(name: &str, count: u32, asking: bool) -> String {
    if count > 1 {
        format!("{name} has {count} questions")
    } else if asking {
        format!("{name} has a question")
    } else {
        format!("{name} needs your OK")
    }
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
    let mut list = col().w_full().px(10.0).gap(2.0);
    for bot in bots {
        list = list.child(bot_row(s, bot, look));
    }
    list = list.child(add_row(t));
    // The team fills the roster and scrolls past it.
    let bots_list = col()
        .key("rd-bots")
        .role("navigation")
        .label("Your team")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .child(list);
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
        .child(row().w_full().px(20.0).pb(8.0).child(label(t, "Your team")))
        .child(bots_list)
        .child(footer(s, look))
}

/// What waits on the owner, one line per teammate, newest first.
fn requests(s: &Ui, look: &Look) -> Option<El> {
    let t = &look.theme;
    let mut waiting: Vec<(&BotProfile, WaitingOnOwner)> = s
        .model
        .bots
        .iter()
        .filter_map(|bot| Some((bot, waiting_on_owner(&s.sessions_of(&bot.id))?)))
        .collect();
    if waiting.is_empty() {
        return None;
    }
    waiting.sort_by_key(|(_, waiting)| std::cmp::Reverse(waiting.last_at));
    let mut list = col()
        .key("rd-requests")
        .role("region")
        .label("Needs you")
        .w_full()
        .px(10.0)
        .pb(14.0)
        .gap(6.0);
    for (bot, waiting) in waiting.into_iter().take(3) {
        let session = waiting.session;
        let headline = waiting_line(&bot.name, waiting.count, waiting.asking);
        let card = row()
            .key(format!("rd-request-{}", bot.id))
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
        .px(10.0)
        .py(7.0)
        .gap(12.0)
        .center_y()
        .radius(9.0)
        .child(
            row()
                .size(30.0, 30.0)
                .center()
                .child(bot_avatar(&bot.id, tone, 30.0))
                // A presence dot on the corner, ringed in the row's colour.
                .child(
                    el().key(format!("rd-bot-{}-presence", bot.id))
                        .size(10.0, 10.0)
                        .radius(5.0)
                        .fill(status.dot(t))
                        .border(2.0, if selected { t.hover } else { t.sidebar })
                        .absolute(21.0, 21.0)
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
    // Rows sit inside the sidebar's edges, rounded, in neutral greys: the
    // hover a wash, the selected row the full hover colour.
    let row = if selected {
        row.fill(t.hover)
    } else {
        row.hover(t.hover.alpha(0.55))
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
        .px(10.0)
        .py(7.0)
        .gap(12.0)
        .center_y()
        .radius(9.0)
        .hover(t.hover.alpha(0.55))
        .child(
            row()
                .size(30.0, 30.0)
                .center()
                .radius(15.0)
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
        .pl(20.0)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, last_at: i64, extra: serde_json::Value) -> SessionSummary {
        let mut value = serde_json::json!({
            "id": id, "title": id, "origin": "web", "lastAt": last_at, "working": false,
            "failed": false, "waiting": false, "preview": "", "turnCount": 1
        });
        for (key, field) in extra.as_object().expect("an object") {
            value[key] = field.clone();
        }
        serde_json::from_value(value).expect("a session summary")
    }

    #[test]
    fn a_teammate_waiting_in_several_sessions_is_one_line_that_opens_its_chat() {
        let chat = session("chat", 10, serde_json::json!({ "chat": true }));
        let asking = session(
            "work",
            30,
            serde_json::json!({ "asking": true, "pending": 2 }),
        );
        // A runtime that cannot count, or counts none, still counts one.
        let approval = session("other", 20, serde_json::json!({ "waiting": true }));
        let empty = session(
            "empty",
            5,
            serde_json::json!({ "waiting": true, "pending": 0 }),
        );
        let waiting =
            waiting_on_owner(&[&chat, &asking, &approval, &empty]).expect("something waits");
        assert_eq!(waiting.count, 4);
        assert!(waiting.asking);
        assert_eq!(waiting.session.id, "chat");
        assert_eq!(waiting.last_at, 30);
        // Without a chat, the latest session that waits opens.
        let waiting = waiting_on_owner(&[&approval, &asking]).expect("something waits");
        assert_eq!(waiting.session.id, "work");
        assert!(waiting_on_owner(&[&chat]).is_none());

        assert_eq!(waiting_line("Raphie", 3, true), "Raphie has 3 questions");
        assert_eq!(waiting_line("Raphie", 1, true), "Raphie has a question");
        assert_eq!(waiting_line("Raphie", 1, false), "Raphie needs your OK");
    }
}
