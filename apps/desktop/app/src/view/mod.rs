//! What the window shows, as a function of state: `view(&Ui) -> El`.
//!
//! Rune calls `view` after every change and diffs the result against the last
//! one, animating whatever moved. A view never changes state itself; buttons
//! carry closures (`on_press`, ...) that Rune runs *between* frames with
//! `&mut Ui`, after which it calls `view` again.
//!
//! The layout follows the web workspace region by region, one module each:
//!
//! ```text
//! ┌─────────┬───────────────────────────────┬──────────┐
//! │ roster  │ header                        │ panel    │
//! │         ├───────────────────────────────┤ (when    │
//! │ (bots)  │ conversation  or  welcome     │  open)   │
//! │         │ composer                      │          │
//! └─────────┴───────────────────────────────┴──────────┘
//! ```
//!
//! Element keys made here start with `rd-`, because Rune keys the parts of
//! its own components (`label`, `value`, ...) in the same namespace.

mod composer;
mod conversation;
mod header;
mod panel;
mod roster;
mod settings;
mod sign_in;
mod steps;
mod welcome;

use raphie_core::model::AuthState;
use raphie_core::settings::ThemeChoice;
use rune::{Cx, El, LiveRegion, col, row, text};
use rune_kit::Kit;

use crate::avatar::Tones;
use crate::icons;
use crate::state::{Screen, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{icon_button, pressable};

/// What every region needs in order to draw: the colours, the kit components
/// styled with them, each bot's colour, and where the window's own buttons
/// sit. Built once per `view` call and passed down by reference.
pub struct Look {
    pub theme: Theme,
    pub kit: Kit,
    pub tones: Tones,
    /// How far the macOS traffic lights reach in from the left edge, in
    /// points; 0 in full screen, on other platforms and in headless runs.
    pub lights: f32,
}

pub fn view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    // The theme follows the OS: `system_dark` changes when the owner switches
    // appearance, and Rune re-runs the view and springs the colours across.
    // Settings → Appearance can pin it to light or dark instead.
    let dark = match s.theme {
        ThemeChoice::System => cx.system_dark(),
        ThemeChoice::Light => false,
        ThemeChoice::Dark => true,
    };
    let theme = Theme::new(dark);
    let look = Look {
        kit: theme.kit(),
        tones: Tones::assign(&s.model.bots),
        lights: cx.titlebar_inset(),
        theme,
    };
    // Drop-down lists float over the page. A view that has one puts it in
    // `overlays`, and `rune_kit::root` draws them above everything else.
    // `&mut` lends the list to the views so they can add to it.
    let mut overlays: Vec<El> = Vec::new();
    let base = match &s.model.auth {
        AuthState::SignedIn => match &s.screen {
            Screen::Workspace => workspace(s, &look),
            Screen::Settings(page) => settings::settings(s, page, &look, &mut overlays),
        },
        _ => sign_in::sign_in(s, &look),
    };
    rune_kit::root(base, overlays)
}

fn workspace(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let mut main = col()
        .key("rd-main")
        .grow(1.0)
        .h_full()
        .min_w(0.0)
        .min_h(0.0)
        .child(header::header(s, look));
    if let Some(notice) = &s.model.notice {
        main = main.child(notice_banner(notice, t));
    }
    main = match &s.model.conversation {
        Some(conversation) => main.child(conversation::conversation(s, conversation, look)),
        None => main.child(welcome::welcome(s, look)),
    };
    main = main.child(composer::composer(s, look));

    let mut shell = row()
        .key("rd-workspace")
        .w_full()
        .h_full()
        .fill(t.background);
    if s.roster_open {
        shell = shell.child(roster::roster(s, look));
    }
    shell = shell.child(main);
    if s.panel_open {
        shell = shell.child(panel::panel(s, look));
    }
    shell
}

/// A message for the owner (a stale approval, a failed send), styled like
/// the web's `.runtime-error` strip.
fn notice_banner(notice: &str, t: &Theme) -> El {
    row().w_full().px(28.0).pt(10.0).justify_center().child(
        row()
            .key("rd-notice")
            .max_w(780.0)
            .pl(12.0)
            .pr(4.0)
            .py(4.0)
            .gap(8.0)
            .center_y()
            .radius(8.0)
            .fill(t.attention_soft)
            // Screen readers announce the text when it appears.
            .live_region(LiveRegion::Polite)
            .child(
                text(notice.to_owned())
                    .font(font(13.0, 400.0))
                    .color(t.attention)
                    .wrap()
                    .shrink(),
            )
            .child(pressable(
                icon_button(t, &icons::X, 14.0, "Dismiss").key("rd-dismiss"),
                true,
                |s: &mut Ui| s.model.notice = None,
            )),
    )
}
