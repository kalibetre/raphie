//! Signing in: the web's sign-in page, asking for a Raphie address instead
//! of a password, then showing the device code to approve in a browser.
//!
//! Mirrors `apps/web/src/presentation/auth/sign-in.tsx` (the card) and
//! `device-approval.tsx` (the code box).

use raphie_core::auth::DeviceCode;
use raphie_core::engine::Command;
use raphie_core::model::AuthState;
use rune::color::hex;
use rune::{Color, El, LiveRegion, Shadow, TextEdit, Tx, col, el, row, text};
use rune_kit::Loader;

use super::Look;
use crate::avatar::bot_avatar;
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::widgets::{Field, Kind, Size, button, labelled, pressable, text_field};

pub fn sign_in(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let tone = look.tones.of("default");
    // The brand starts right of the window's own buttons when there are any.
    let brand_inset = (look.lights + 12.0).max(35.0);
    col()
        .key("rd-sign-in")
        .w_full()
        .h_full()
        .fill(t.background)
        // A faint sage glow from the top edge, as on the web page.
        .child(
            el().pin(Some(0.0), Some(0.0), Some(0.0), None)
                .h(320.0)
                .radial_gradient(
                    [0.5, 0.0],
                    [900.0, 450.0],
                    [(0.0, sage().alpha(0.12)), (0.7, sage().alpha(0.0))],
                )
                .a11y_hidden(),
        )
        .child(
            // This band moves the window, since the app draws its own title bar.
            row()
                .w_full()
                .pl(brand_inset)
                .pr(35.0)
                .py(21.0)
                .gap(8.75)
                .center_y()
                .window_drag()
                .child(bot_avatar("default", tone, 32.0))
                .child(
                    text("raphie")
                        .font(font(15.75, 600.0).tracking(-0.4))
                        .color(t.foreground),
                ),
        )
        .child(
            col()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .px(17.5)
                .pt(21.0)
                .pb(70.0)
                .center()
                .child(card(s, look)),
        )
}

/// The sage of the default bot, which tints this page.
fn sage() -> Color {
    hex("#b5c99b").unwrap_or(Color::WHITE)
}

fn card(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let form = match &s.model.auth {
        AuthState::AwaitingApproval(code) => approve_device(code, look),
        state => {
            let connecting = matches!(state, AuthState::Connecting);
            let notice = match state {
                AuthState::SignedOut { notice } => notice.as_deref(),
                _ => None,
            };
            choose_origin(&s.origin_field, connecting, notice, t)
        }
    };
    col()
        .key("rd-sign-in-card")
        .w_full()
        .max_w(420.0)
        .radius(14.0)
        .fill(t.card)
        .border(1.0, t.border)
        // A Rune border takes no room by default, so children would draw
        // over it. This lays them out inside it, as CSS does.
        .border_layout()
        .box_shadow(Shadow {
            y: 18.0,
            blur: 60.0,
            spread: -30.0,
            color: Color::BLACK.alpha(0.35),
            ..Shadow::default()
        })
        .child(welcome_section(look))
        .child(col().w_full().px(31.5).py(28.0).child(form))
}

/// The card's tinted top: avatar tile, title and tagline.
fn welcome_section(look: &Look) -> El {
    let t = &look.theme;
    col()
        .w_full()
        .px(31.5)
        .py(28.0)
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        // Round the top like the card around it, and cut the circle below
        // to that shape. Corners go top-left, top-right, bottom-right,
        // bottom-left.
        .corners([13.0, 13.0, 0.0, 0.0])
        .clip_corners([13.0, 13.0, 0.0, 0.0])
        // CSS `linear-gradient(125deg, sage-tinted card, card 75%)`.
        .linear_gradient(
            125.0_f32.to_radians(),
            [
                (0.0, t.card.mix(sage(), 0.17)),
                (0.75, t.card),
                (1.0, t.card),
            ],
        )
        .child(
            // A soft circle peeking in from the top-right corner.
            el().pin(None, Some(-56.0), Some(-42.0), None)
                .size(140.0, 140.0)
                .radius(70.0)
                .fill(sage().alpha(0.1))
                .a11y_hidden(),
        )
        .child(
            row()
                .size(42.0, 42.0)
                .center()
                .radius(14.0)
                .fill(sage().alpha(0.15))
                .border(1.0, sage().alpha(0.25))
                .child(bot_avatar("default", look.tones.of("default"), 32.0)),
        )
        .child(
            text("Welcome to Raphie")
                .font(font(21.0, 600.0).tracking(-0.5).lh(28.0))
                .color(t.foreground)
                .mt(17.5),
        )
        .child(
            text("Your personal workspace, ready when you are.")
                .font(font(12.25, 400.0).lh(21.0))
                .color(t.muted_foreground)
                .wrap()
                .mt(7.0),
        )
}

/// A form section's heading and the line under it.
fn heading(t: &Theme, title: &str, detail: &str) -> El {
    col()
        .w_full()
        .gap(3.5)
        .child(text(title).font(font(14.0, 600.0)).color(t.foreground))
        .child(
            text(detail)
                .font(font(12.25, 400.0).lh(17.5))
                .color(t.muted_foreground)
                .wrap(),
        )
}

fn small_print(t: &Theme, content: &str) -> El {
    text(content)
        .font(font(10.5, 400.0).lh(17.5))
        .color(t.muted_foreground)
        .wrap()
}

/// Step 1: which Raphie to connect to.
fn choose_origin(origin: &TextEdit, connecting: bool, notice: Option<&str>, t: &Theme) -> El {
    let field = text_field(
        t,
        Field {
            key: "rd-origin-field",
            label: "Raphie address",
            placeholder: "https://raphie.your-tailnet.ts.net",
            edit: origin,
            disabled: connecting,
        },
        |s: &mut Ui| &mut s.origin_field,
        |s: &mut Ui, _: &mut Tx| s.connect(),
    );
    let mut form = col()
        .key("rd-origin")
        .w_full()
        .gap(17.5)
        .child(heading(
            t,
            "Connect this device",
            "Enter your Raphie address to continue.",
        ))
        .child(labelled(t, "Raphie address", field));
    if let Some(notice) = notice {
        form = form.child(
            text(notice.to_owned())
                .key("rd-sign-in-notice")
                .font(font(12.25, 400.0).lh(17.5))
                .color(t.error)
                .wrap()
                .live_region(LiveRegion::Polite),
        );
    }
    let label = if connecting {
        "Connecting…"
    } else {
        "Connect"
    };
    form.child(pressable(
        button(t, Kind::Primary, Size::Large, None, label)
            .key("rd-connect")
            .w_full(),
        !connecting,
        |s: &mut Ui| s.connect(),
    ))
    .child(small_print(
        t,
        "Use its HTTPS address, or http://127.0.0.1 when Raphie runs on this machine.",
    ))
}

/// Step 2: the code to check in the browser, and the way there.
fn approve_device(code: &DeviceCode, look: &Look) -> El {
    let t = &look.theme;
    let url = code.verification_url.clone();
    col()
        .key("rd-device")
        .w_full()
        .gap(17.5)
        .child(heading(
            t,
            "Approve this device",
            "Open the approval page, sign in if asked, and check that it shows this code:",
        ))
        .child(
            row()
                .w_full()
                .px(14.0)
                .py(10.5)
                .center()
                .radius(10.5)
                .fill(t.muted)
                .border(1.0, t.border)
                .child(
                    text(code.user_code.clone())
                        .key("rd-user-code")
                        .font(rune::TextStyle {
                            weight: 600.0,
                            ..mono(17.5).tracking(1.75)
                        })
                        .color(t.foreground)
                        .selectable(true)
                        .selection_color(t.selection())
                        // Read out letter by letter rather than as a word.
                        .label(format!("Code {}", spell_out(&code.user_code))),
                ),
        )
        .child(
            button(t, Kind::Primary, Size::Large, None, "Open approval page")
                .key("rd-open-approval")
                .w_full()
                // `on_press_tx` also hands over `Tx`, Rune's handle for
                // effects outside the state, such as opening a URL.
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                    if tx.open_url(&url).is_err() {
                        s.model.notice =
                            Some("Could not open a browser. Copy the link below.".into());
                    }
                }),
        )
        .child(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Cancel")
                .key("rd-cancel-sign-in")
                .w_full(),
            true,
            |s: &mut Ui| s.command(Command::CancelSignIn),
        ))
        .child(
            row()
                .gap(7.0)
                .center_y()
                .child(Loader::new().size(14.0).color(t.muted_foreground).build(&look.kit))
                .child(
                    text("Waiting for approval…")
                        .font(font(12.25, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(
            text(code.verification_url.clone())
                .key("rd-approval-link")
                .font(font(10.5, 400.0).lh(17.5))
                .color(t.faint)
                .selectable(true)
                .selection_color(t.selection())
                .wrap_anywhere(),
        )
        .child(small_print(
            t,
            "Only approve a code shown on a device you have with you. An approved device gets full access to your Raphie.",
        ))
}

/// "WXYZ-1234" read out as "W X Y Z, 1 2 3 4" for screen readers.
fn spell_out(code: &str) -> String {
    code.split('-')
        .map(|part| part.chars().map(String::from).collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join(", ")
}
