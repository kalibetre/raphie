//! Settings → About: this copy of Raphie Desktop, its version and whether
//! a newer one is released. The web keeps its version under Appearance;
//! the desktop gives it a page of its own, with room for more about the
//! app later.

use raphie_core::updates::{UpdateStatus, current_version};
use rune::{El, Tx};

use super::parts::{Scope, group, page, setting, value};
use crate::icons;
use crate::state::Ui;
use crate::theme::Theme;
use crate::view::Look;
use crate::widgets::{Kind, Size, button, pressable};

pub fn about(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let app = group(
        t,
        "This app",
        "Information about this installation.",
        vec![version_row(s, t), updates_row(s, t)],
    );
    page(
        "rd-page-about",
        "About",
        "Which Raphie Desktop this is, and whether a newer one is out.",
        Scope::App,
        vec![app],
        look,
    )
}

/// Raphie's version, and which build this is.
fn version_row(s: &Ui, t: &Theme) -> El {
    let version = current_version();
    let shown = if s.flavor.is_dev() {
        format!("{version} · Dev build")
    } else {
        version.to_owned()
    };
    setting(
        t,
        Some(&icons::INFO),
        "Raphie Desktop version",
        "The version of this app.",
        Some(value(shown, t.muted_foreground).key("rd-version")),
    )
}

/// What the last check for a newer release found, and a way to look again
/// or to open the newer release's page.
fn updates_row(s: &Ui, t: &Theme) -> El {
    let status = &s.model.update;
    let description = match status {
        UpdateStatus::NotChecked => "Not checked yet.".to_owned(),
        UpdateStatus::Checking => "Checking GitHub for a newer release…".to_owned(),
        UpdateStatus::UpToDate => "This is the newest release.".to_owned(),
        UpdateStatus::Available(update) => format!("Raphie {} is available.", update.version),
        UpdateStatus::Failed(why) => format!("Could not check: {why}"),
    };
    let control = match status {
        // Opening a browser needs Rune's `Tx`, so `on_press_tx`.
        UpdateStatus::Available(_) => button(t, Kind::Primary, Size::Regular, None, "View release")
            .key("rd-view-release")
            .on_press_tx(|s: &mut Ui, tx: &mut Tx| s.open_release(tx)),
        _ => {
            let checking = *status == UpdateStatus::Checking;
            pressable(
                button(t, Kind::Outline, Size::Regular, None, "Check for updates")
                    .key("rd-check-updates"),
                !checking,
                |s: &mut Ui| s.check_for_updates(),
            )
        }
    };
    setting(
        t,
        Some(&icons::REFRESH_CW),
        "Updates",
        &description,
        Some(control),
    )
    .key("rd-updates")
}
