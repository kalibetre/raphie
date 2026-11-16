//! Settings → Account: who this device is signed in as, and signing out.
//!
//! The web's Account page (`account-settings.tsx`) also lists connected
//! devices and passkeys. The web host answers those requests only for a
//! signed-in browser, never for a device token, so this page points to the
//! browser for them rather than pretending.

use raphie_core::engine::Command;
use raphie_core::model::Reach;
use rune::{El, Tx, row};

use super::parts::{Scope, alert_with, group, page, setting};
use crate::icons;
use crate::sections::Page;
use crate::state::Ui;
use crate::view::Look;
use crate::widgets::{Kind, Size, button, pressable};

pub fn account(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let account = s.model.account.as_ref();
    let name = account
        .map(|a| a.name.as_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Administrator");
    let email = account.map_or("Account details unavailable", |a| a.email.as_str());
    let address = s
        .model
        .origin
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();

    let reach = &s.model.reach;
    let answering = if reach.is_up() {
        format!("{address} · Connected")
    } else {
        format!("{address} · Not answering")
    };
    let change = pressable(
        button(t, Kind::Outline, Size::Small, None, "Change address")
            .key("rd-account-change-address"),
        true,
        Ui::change_address,
    );
    let signed_in = group(
        t,
        "Signed in",
        "The administrator this device is connected as.",
        vec![
            setting(t, Some(&icons::USER_ROUND), name, email, None).key("rd-account-identity"),
            setting(
                t,
                Some(&icons::RADIO),
                "Raphie address",
                &answering,
                Some(change),
            )
            .key("rd-account-address"),
        ],
    );
    let mut groups = Vec::new();
    if let Some(down) = not_answering(s, reach, &address, look) {
        groups.push(down);
    }
    groups.push(signed_in);
    let in_browser = group(
        t,
        "Connected devices and passkeys",
        "Raphie only lets a signed-in browser list devices or change passkeys, so a lost device cannot disconnect the others.",
        vec![setting(
            t,
            None,
            "Manage in the browser",
            "Disconnect a device you no longer trust, or register a passkey.",
            Some(
                button(
                    t,
                    Kind::Outline,
                    Size::Regular,
                    Some(&icons::EXTERNAL_LINK),
                    "Open in browser",
                )
                .key("rd-account-web")
                .on_press_tx(|s: &mut Ui, tx: &mut Tx| s.open_web(&Page::Account, tx)),
            ),
        )],
    );
    let sign_out = group(
        t,
        "Sign out",
        "Forgets this device's sign-in. The device stays listed in the browser's Account settings until you disconnect it there.",
        vec![setting(
            t,
            None,
            "This device",
            "Approve a new device code to sign in again.",
            Some(pressable(
                button(t, Kind::Outline, Size::Regular, None, "Sign out")
                    .key("rd-account-sign-out"),
                true,
                |s: &mut Ui| {
                    s.close_settings();
                    s.command(Command::SignOut);
                },
            )),
        )],
    );
    page(
        "rd-page-account",
        "Account",
        "The administrator signed in to this Raphie server.",
        Scope::App,
        {
            groups.extend([in_browser, sign_out]);
            groups
        },
        look,
    )
}

/// Why Raphie does not answer at `address`, with a way to try again or to
/// connect somewhere else; `None` while it answers.
fn not_answering(s: &Ui, reach: &Reach, address: &str, look: &Look) -> Option<El> {
    let t = &look.theme;
    let (title, message) = match reach {
        Reach::Up => return None,
        Reach::RuntimeDown(_) => (
            "Raphie is not running",
            format!(
                "The web host at {address} answered, but Raphie's runtime behind it did not. On that computer, run raphie status to check it. This app reconnects when it is back."
            ),
        ),
        Reach::Unreachable(reason) => (
            "Can't reach Raphie",
            format!(
                "Nothing answered at {address} ({reason}). Check that Raphie is running and that this Mac can reach it, or change the address below."
            ),
        ),
    };
    let checking = s.model.checking_reach;
    let actions = row().gap(8.0).flex_wrap().child(pressable(
        button(
            t,
            Kind::Outline,
            Size::Small,
            Some(&icons::REFRESH_CW),
            if checking { "Checking…" } else { "Try again" },
        )
        .key("rd-account-check"),
        !checking,
        Ui::check_reach,
    ));
    Some(alert_with(
        t,
        "rd-account-unreachable",
        title,
        &message,
        Some(actions),
    ))
}
