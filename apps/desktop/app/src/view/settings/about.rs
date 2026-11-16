//! Settings → About: this copy of Raphie Desktop, its version and whether
//! a newer one is released, and the version of the Raphie it is signed in
//! to. The web keeps its version under Appearance;
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
        vec![version_row(t), channel_row(s, t), updates_row(s, t)],
    );
    let host = group(
        t,
        "Raphie",
        "The Raphie this app is signed in to.",
        vec![host_version_row(s, t)],
    );
    page(
        "rd-page-about",
        "About",
        "This app's version and updates, and the Raphie it is signed in to.",
        Scope::App,
        vec![app, host],
        look,
    )
}

/// Raphie Desktop's version.
fn version_row(t: &Theme) -> El {
    let shown = current_version().to_owned();
    setting(
        t,
        Some(&icons::INFO),
        "Raphie Desktop version",
        "The version of this app.",
        Some(value(shown, t.muted_foreground).key("rd-version")),
    )
}

/// The release the signed-in Raphie runs, written as the web writes it.
fn host_version_row(s: &Ui, t: &Theme) -> El {
    let shown = match s.model.host_version.as_deref() {
        None => "Unknown".to_owned(),
        Some("development") => "Development".to_owned(),
        Some(version) => version.strip_prefix('v').unwrap_or(version).to_owned(),
    };
    setting(
        t,
        Some(&icons::INFO),
        "Raphie version",
        "The version the signed-in Raphie runs: its runtime and web host.",
        Some(value(shown, t.muted_foreground).key("rd-host-version")),
    )
}

/// Which releases this copy follows: stable, nightly, or none for a dev
/// build made on this computer.
fn channel_row(s: &Ui, t: &Theme) -> El {
    let (glyph, shown, color, description) = if s.flavor.is_dev() {
        (
            &icons::WRENCH,
            "Dev build",
            t.attention,
            "Built from this computer's checkout. It is not updated from releases.",
        )
    } else if s.release_channel.is_nightly() {
        (
            &icons::MOON,
            "Nightly",
            t.night,
            "Built from the latest main. Newer features, tested less than stable releases.",
        )
    } else {
        (
            &icons::SHIELD_CHECK,
            "Stable",
            t.muted_foreground,
            "Stable releases only.",
        )
    };
    setting(
        t,
        Some(glyph),
        "Release channel",
        description,
        Some(value(shown, color).key("rd-release-channel")),
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
