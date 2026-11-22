//! A fresh install's first steps: the app says hello, the owner meets and
//! names the first bot, and the bot asks for a model. Connecting one ends it
//! on the bot's empty desk.
//!
//! Mirrors `apps/web/src/presentation/workspace/onboarding.tsx` and the
//! `.onboarding` rules in `bot-workspace.css`.

use rune::{El, col, el, row, text};

use super::Look;
use super::add_teammate::{MeetCopy, meet_step, work_step};
use super::setup;
use crate::avatar::{bot_avatar, tone_of};
use crate::icons;
use crate::state::{Onboarding, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{Kind, Size, build_badge, button, centered, pressable};

const STEPS: [(Onboarding, &str); 4] = [
    (Onboarding::Welcome, "Welcome"),
    (Onboarding::Teammate, "Your first teammate"),
    (Onboarding::Work, "How they work"),
    (Onboarding::Provider, "A way to think"),
];

/// The colour a fresh bot wears until one is chosen.
const SAGE: &str = "#b5c99b";

pub fn onboarding(s: &Ui, look: &Look) -> El {
    let step = match s.onboarding {
        Onboarding::Welcome => welcome(s, look),
        Onboarding::Teammate => teammate(s, look),
        Onboarding::Work => work(s, look),
        Onboarding::Provider => provider(s, look),
    };
    let at = STEPS
        .iter()
        .position(|(step, _)| *step == s.onboarding)
        .unwrap_or(0);
    let labels: Vec<&str> = STEPS.iter().map(|(_, label)| *label).collect();
    flow(s, look, &labels, at, None, step)
}

/// A full-window flow: a short bar per step above the step, filled up to
/// this one, and a close button when the flow can be left.
pub(super) fn flow(
    s: &Ui,
    look: &Look,
    steps: &[&str],
    at: usize,
    close: Option<El>,
    step: El,
) -> El {
    let t = &look.theme;
    let mut progress = row()
        .key("rd-onboarding-progress")
        .role("progressbar")
        .label(format!("Step {} of {}: {}", at + 1, steps.len(), steps[at]))
        .gap(6.0);
    for (i, label) in steps.iter().enumerate() {
        progress = progress.child(
            el().size(28.0, 4.0)
                .radius(2.0)
                .fill(if i <= at { t.foreground } else { t.border })
                .help(*label)
                .a11y_hidden(),
        );
    }
    // A dev or nightly build says so beside the window's buttons, as the
    // roster does.
    let inset = if look.lights > 0.0 {
        look.lights + 12.0
    } else {
        20.0
    };
    let badge = build_badge(t, s.flavor, s.release_channel, false)
        .map(|badge| row().absolute(inset, 12.0).child(badge));
    let close = close.map(|button| row().pin(None, Some(8.0), Some(20.0), None).child(button));
    col()
        .key("rd-onboarding")
        .w_full()
        .h_full()
        .fill(t.background)
        // Clear of the window's buttons; the empty space moves the window.
        .pt(if look.lights > 0.0 { 44.0 } else { 40.0 })
        .px(24.0)
        .items_center()
        .window_drag()
        .on_layout(|s: &mut Ui, rect: [f32; 4]| {
            s.workspace_width = rect[2];
            s.workspace_height = rect[3];
        })
        .children(badge)
        .children(close)
        .child(progress)
        .child(
            col()
                .key("rd-onboarding-step")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .py(32.0)
                .center()
                .child(step),
        )
}

/// The raphie mark: the brand, not a bot.
fn brand_mark(size: f32) -> El {
    let tone = tone_of(SAGE).expect("a valid colour");
    bot_avatar("default", tone, size)
}

pub(super) fn card() -> El {
    col().w_full().max_w(440.0).gap(12.0).items_center()
}

pub(super) fn heading(t: &Theme, words: &str) -> El {
    text(words.to_owned())
        .role("heading")
        .font(font(26.0, 600.0).tracking(-0.4))
        .color(t.foreground)
        .mt(4.0)
}

pub(super) fn lede(t: &Theme, words: &str) -> El {
    centered(words, font(14.0, 400.0).lh(22.4), t.muted_foreground)
}

/// Back on the left and the next step on the right, or a skip.
fn actions(t: &Theme, next: Option<El>, skip: bool) -> El {
    let mut bar = row()
        .w_full()
        .max_w(440.0)
        .mt(8.0)
        .justify_between()
        .center_y()
        .child(pressable(
            button(
                t,
                Kind::Ghost,
                Size::Regular,
                Some(&icons::ARROW_LEFT),
                "Back",
            )
            .key("rd-onboarding-back"),
            true,
            |s: &mut Ui| s.onboarding_back(),
        ));
    if let Some(next) = next {
        bar = bar.child(next);
    }
    if skip {
        bar = bar.child(pressable(
            button(t, Kind::Ghost, Size::Regular, None, "Skip for now").key("rd-onboarding-skip"),
            true,
            |s: &mut Ui| s.onboarding_skipped = true,
        ));
    }
    bar
}

/// The app greets the owner as raphie, before any bot appears.
fn welcome(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let place = match &s.model.origin {
        Some(origin) if !origin.is_local() => origin.host(),
        _ => "this Mac".to_owned(),
    };
    card()
        .child(brand_mark(72.0))
        .child(heading(t, "Welcome to raphie"))
        .child(lede(
            t,
            "A small team of assistants that work for you, on your own machine.",
        ))
        .child(
            row()
                .mt(6.0)
                .mb(10.0)
                .px(14.0)
                .py(9.0)
                .gap(8.0)
                .center_y()
                .radius(10.0)
                .fill(t.card)
                .border(1.0, t.border)
                .child(el().size(7.0, 7.0).radius(3.5).fill(t.accent).a11y_hidden())
                .child(
                    text(format!("Running on {place}"))
                        .key("rd-onboarding-place")
                        .font(font(13.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(pressable(
            button(t, Kind::Primary, Size::Large, None, "Continue").key("rd-onboarding-next"),
            true,
            |s: &mut Ui| s.onboarding_next(),
        ))
}

/// The first bot: its name, what it handles and its colour, through the
/// step "Add a teammate" uses.
fn teammate(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let back = pressable(
        button(
            t,
            Kind::Ghost,
            Size::Regular,
            Some(&icons::ARROW_LEFT),
            "Back",
        )
        .key("rd-onboarding-back"),
        true,
        |s: &mut Ui| s.onboarding_back(),
    );
    let copy = MeetCopy {
        bot_id: s.model.bot_id.as_deref().unwrap_or("default"),
        heading: "Meet your first teammate",
        lede: "They’ll handle your day-to-day. Give them any name you like.",
        keys: "rd-onboarding",
    };
    meet_step(s, look, copy, back, |s: &mut Ui| s.onboarding_next())
}

/// How the first bot works; leaving it saves what changed.
fn work(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let saving = s.model.saving_profile;
    let back = pressable(
        button(
            t,
            Kind::Ghost,
            Size::Regular,
            Some(&icons::ARROW_LEFT),
            "Back",
        )
        .key("rd-onboarding-back"),
        !saving,
        |s: &mut Ui| s.onboarding_back(),
    );
    let next = pressable(
        button(
            t,
            Kind::Primary,
            Size::Large,
            None,
            if saving { "Saving…" } else { "Next" },
        )
        .key("rd-onboarding-next"),
        !saving,
        |s: &mut Ui| s.onboarding_next(),
    );
    let bot_id = s.model.bot_id.as_deref().unwrap_or("default");
    work_step(s, look, bot_id, back, next)
}

/// The bot asks for a model, as it does outside onboarding.
fn provider(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    col()
        .w_full()
        .items_center()
        .child(setup::panel(s, look))
        .child(actions(t, None, true))
}
