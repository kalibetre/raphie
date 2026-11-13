//! Headless checks of the main screens, in light and dark, through Rune's
//! `Runtime`: the same layout and input code as a window, on a virtual clock,
//! with no GPU and no network. Pixel snapshots are rendered separately with
//! `scripts/snapshots.sh` (they need a GPU); these checks run in CI.

use raphie_core::contracts::Decision;
use raphie_core::engine::Command;
use raphie_core::model::AuthState;
use raphie_desktop::{Ui, scenes, view::view};
use rune::{ElementInfo, Env, Runtime};

const SIZE: (f32, f32) = (1080.0, 720.0);

/// Renders a scene and lets every spring settle.
fn render(scene: fn(&mut Ui), dark: bool) -> Runtime<Ui> {
    let mut ui = Ui::with_origin("http://127.0.0.1:4321");
    scene(&mut ui);
    let mut rt = Runtime::new(ui, view, SIZE, Env::new(dark, 2.0));
    rt.frame(0.0);
    settle(&mut rt);
    rt
}

fn settle(rt: &mut Runtime<Ui>) {
    for _ in 0..90 {
        rt.frame(1.0 / 60.0);
    }
}

fn element(rt: &Runtime<Ui>, key: &str) -> ElementInfo {
    rt.elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(key))
        .unwrap_or_else(|| panic!("no element keyed {key}"))
}

/// All text on screen, joined, for "does it say X" checks.
fn screen_text(rt: &Runtime<Ui>) -> String {
    rt.elements()
        .into_iter()
        .filter_map(|e| e.text)
        .collect::<Vec<_>>()
        .join("\n")
}

fn click(rt: &mut Runtime<Ui>, key: &str) {
    let (x, y) = rt
        .find(key)
        .unwrap_or_else(|| panic!("no element keyed {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    settle(rt);
}

#[test]
fn every_scene_renders_in_light_and_dark() {
    for (name, scene) in scenes::SCENES {
        for dark in [false, true] {
            let rt = render(*scene, dark);
            assert!(
                rt.elements().len() > 5,
                "scene {name} (dark: {dark}) draws something"
            );
        }
    }
}

#[test]
fn the_theme_follows_the_system_appearance() {
    let light = element(&render(scenes::sign_in, false), "rd-sign-in").fill;
    let dark = element(&render(scenes::sign_in, true), "rd-sign-in").fill;
    let luminance = |c: rune::Color| c.r + c.g + c.b;
    assert!(
        luminance(light) > luminance(dark) + 1.0,
        "light {light:?} vs dark {dark:?}"
    );
}

#[test]
fn sign_in_connects_to_a_valid_origin() {
    for dark in [false, true] {
        let mut rt = render(scenes::sign_in, dark);
        assert!(screen_text(&rt).contains("Connect this device"));
        click(&mut rt, "rd-connect");
        assert!(matches!(
            rt.state.sent.last(),
            Some(Command::Connect { origin }) if origin.as_str() == "https://raphie.example.ts.net"
        ));
    }
}

#[test]
fn sign_in_refuses_plain_http_off_loopback() {
    let mut rt = render(scenes::sign_in_error, false);
    click(&mut rt, "rd-connect");
    assert!(rt.state.sent.is_empty());
    assert!(
        matches!(&rt.state.model.auth, AuthState::SignedOut { notice: Some(n) } if n.contains("https"))
    );
    assert!(rt.find("rd-sign-in-notice").is_some());
}

#[test]
fn the_device_code_screen_shows_the_code_and_can_cancel() {
    for dark in [false, true] {
        let mut rt = render(scenes::device_code, dark);
        assert_eq!(
            element(&rt, "rd-user-code").text.as_deref(),
            Some("WXYZ-1234")
        );
        assert!(
            element(&rt, "rd-approval-link")
                .text
                .unwrap()
                .ends_with("/device?user_code=WXYZ-1234")
        );
        assert!(rt.find("rd-open-approval").is_some());
        click(&mut rt, "rd-cancel-sign-in");
        assert_eq!(rt.state.sent.last(), Some(&Command::CancelSignIn));
    }
}

#[test]
fn the_sidebar_lists_bots_and_sessions() {
    for dark in [false, true] {
        let mut rt = render(scenes::new_conversation, dark);
        assert!(rt.find("rd-bot-default").is_some() && rt.find("rd-bot-b-research").is_some());
        for id in ["s-1", "s-2", "s-3"] {
            assert!(rt.find(&format!("rd-session-{id}")).is_some(), "row {id}");
        }
        assert!(screen_text(&rt).contains("New conversation with Raphie"));

        click(&mut rt, "rd-session-s-2");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession {
                session_id: Some("s-2".into())
            })
        );
        click(&mut rt, "rd-bot-b-research");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectBot {
                bot_id: "b-research".into()
            })
        );
    }
}

#[test]
fn a_conversation_renders_messages_markdown_and_code() {
    for dark in [false, true] {
        let rt = render(scenes::conversation, dark);
        for key in [
            "rd-turn-t1",
            "rd-reply-t1",
            "rd-turn-t2",
            "rd-reply-t2",
            "rd-composer",
        ] {
            assert!(rt.find(key).is_some(), "{key} (dark: {dark})");
        }
        let text = screen_text(&rt);
        assert!(text.contains("Choose one priority."), "markdown list item");
        assert!(text.contains("fs::read_dir"), "code block");
        assert!(
            !text.contains("**"),
            "markdown markers are rendered, not shown"
        );
    }
}

#[test]
fn a_streaming_reply_shows_the_text_so_far() {
    let rt = render(scenes::streaming, true);
    let text = screen_text(&rt);
    assert!(text.contains("Tomorrow, start with the"), "{text}");
    assert!(text.contains("review"));
}

#[test]
fn approvals_show_exact_arguments_and_send_one_decision() {
    for dark in [false, true] {
        let mut rt = render(scenes::approval, dark);
        let id = "6f1d7f8e-2a7b-4f1e-9c4e-1b2a3c4d5e6f";
        let text = screen_text(&rt);
        assert!(text.contains("calendar · execute"));
        assert!(
            text.contains("calendar.events.list"),
            "exact arguments shown"
        );

        click(&mut rt, &format!("rd-approve-{id}"));
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Decide {
                approval_id: id.into(),
                decision: Decision::Approved
            })
        );
        // While the decision is on its way, a second click sends nothing.
        click(&mut rt, &format!("rd-reject-{id}"));
        let decisions = rt
            .state
            .sent
            .iter()
            .filter(|c| matches!(c, Command::Decide { .. }))
            .count();
        assert_eq!(decisions, 1);
    }
}

#[test]
fn the_composer_sends_what_was_typed() {
    let mut rt = render(scenes::conversation, false);
    click(&mut rt, "rd-composer");
    rt.paste("Thanks!");
    settle(&mut rt);
    assert_eq!(rt.state.composer.text, "Thanks!");
    click(&mut rt, "rd-send");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Send {
            text: "Thanks!".into()
        })
    );
    assert!(rt.state.model.sending, "the button waits for the receipt");
}

#[test]
fn notices_can_be_dismissed() {
    fn with_notice(ui: &mut Ui) {
        scenes::conversation(ui);
        ui.model.notice = Some("That approval expired before your decision arrived.".into());
    }
    let mut rt = render(with_notice, false);
    assert!(rt.find("rd-notice").is_some());
    click(&mut rt, "rd-dismiss");
    assert_eq!(rt.state.model.notice, None);
}
