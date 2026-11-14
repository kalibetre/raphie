//! Settings → Account: who this device is signed in as, and signing out.
//!
//! The web's Account page (`account-settings.tsx`) also lists connected
//! devices and passkeys. The web host answers those requests only for a
//! signed-in browser, never for a device token, so this page points to the
//! browser for them rather than pretending.

use raphie_core::engine::Command;
use rune::{El, Tx};

use super::parts::{Scope, group, page, setting};
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

    let signed_in = group(
        t,
        "Signed in",
        "The administrator this device is connected as.",
        vec![
            setting(t, Some(&icons::USER_ROUND), name, email, None).key("rd-account-identity"),
            setting(t, Some(&icons::RADIO), "Raphie address", &address, None)
                .key("rd-account-address"),
        ],
    );
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
        vec![signed_in, in_browser, sign_out],
        look,
    )
}
