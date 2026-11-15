//! Headless checks of the main screens, in light and dark, through Rune's
//! `Runtime`: the same layout and input code as a window, on a virtual clock,
//! with no GPU and no network. Pixel snapshots are rendered separately with
//! `scripts/snapshots.sh` (they need a GPU); these checks run in CI.

use raphie_core::auth::Secret;
use raphie_core::channels::{Channel, ChannelChange, ChannelOutcome};
use raphie_core::contracts::{
    BotProfile, ControlAction, Decision, MemoryPage, MemoryProvider, Scope, TelegramPairingCode,
};
use raphie_core::engine::{Command, ConnectionChange};
use raphie_core::mcp::{McpAction, NewMcpConnection};
use raphie_core::memory::{KeyChange, MemoryUpdate};
use raphie_core::model::{AuthState, Event};
use raphie_core::settings::ThemeChoice;
use raphie_desktop::sections::{BotSection, Page};
use raphie_desktop::state::{self, Filter, Screen};
use raphie_desktop::{Ui, scenes, view::view};
use rune::{ElementInfo, Env, Runtime, TextEdit};

const SIZE: (f32, f32) = (1280.0, 800.0);

/// Renders a scene and lets every spring settle.
fn render(scene: fn(&mut Ui), dark: bool) -> Runtime<Ui> {
    render_sized(scene, dark, SIZE)
}

/// `render` in a window of another size, for pages taller than the default.
fn render_sized(scene: fn(&mut Ui), dark: bool, size: (f32, f32)) -> Runtime<Ui> {
    let mut ui = Ui::with_origin("http://127.0.0.1:4321");
    scene(&mut ui);
    let mut rt = Runtime::new(ui, view, size, Env::new(dark, 2.0));
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

/// The page colour is the web workspace's `--background` token in each
/// appearance (`apps/web/src/shared/styles/tokens.css`).
#[test]
fn the_theme_follows_the_system_appearance_in_the_web_colours() {
    for (dark, background, sidebar) in [(false, "#f7f5ef", "#ebe8de"), (true, "#1c1b18", "#161512")]
    {
        let sign_in = render(scenes::sign_in, dark);
        assert_eq!(color(&sign_in, "rd-sign-in"), background);
        let workspace = render(scenes::new_conversation, dark);
        assert_eq!(color(&workspace, "rd-workspace"), background);
        assert_eq!(color(&workspace, "rd-roster"), sidebar);
    }
}

/// An element's fill as `#rrggbb`.
fn color(rt: &Runtime<Ui>, key: &str) -> String {
    // `Color::hex` gives `#rrggbbaa`; the first seven characters are the colour.
    element(rt, key).fill.hex()[..7].to_owned()
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
fn the_roster_lists_bots_and_says_which_need_the_owner() {
    for dark in [false, true] {
        let mut rt = render(scenes::new_conversation, dark);
        assert!(rt.find("rd-bot-default").is_some() && rt.find("rd-bot-b-research").is_some());
        let text = screen_text(&rt);
        assert!(text.contains("1 conversation needs you"), "{text}");
        assert!(text.contains("What’s on your mind?"), "the welcome screen");

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
fn the_roster_and_the_panel_open_and_close() {
    let mut rt = render(scenes::new_conversation, false);
    assert!(rt.find("rd-panel").is_none(), "the panel starts closed");
    click(&mut rt, "rd-toggle-panel");
    assert!(rt.find("rd-panel").is_some());
    click(&mut rt, "rd-toggle-roster");
    assert!(rt.find("rd-roster").is_none());
    click(&mut rt, "rd-toggle-roster");
    assert!(rt.find("rd-roster").is_some());
}

#[test]
fn the_panel_lists_searches_and_filters_sessions() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversations, dark);
        for id in ["s-1", "s-2", "s-3"] {
            assert!(rt.find(&format!("rd-session-{id}")).is_some(), "row {id}");
        }
        assert!(screen_text(&rt).contains("3 conversations · Most recent first"));

        // The Approvals chip keeps only the session waiting for the owner.
        click(&mut rt, "rd-filter-approvals");
        assert_eq!(rt.state.filter, Filter::Approvals);
        assert!(rt.find("rd-session-s-2").is_some() && rt.find("rd-session-s-1").is_none());
        click(&mut rt, "rd-filter-all");

        // Search matches titles, whatever the case.
        click(&mut rt, "rd-search");
        rt.paste("TEA");
        settle(&mut rt);
        assert!(rt.find("rd-session-s-3").is_some() && rt.find("rd-session-s-1").is_none());
        assert!(screen_text(&rt).contains("1 conversation matching “TEA”"));
        click(&mut rt, "rd-search-clear");
        assert!(rt.find("rd-session-s-1").is_some());

        click(&mut rt, "rd-session-s-2");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession {
                session_id: Some("s-2".into())
            })
        );
        click(&mut rt, "rd-new");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession { session_id: None })
        );
    }
}

#[test]
fn a_suggestion_fills_the_composer_without_sending() {
    let mut rt = render(scenes::new_conversation, false);
    let key = element_with_label(&rt, "Help me plan my day");
    click(&mut rt, &key);
    assert_eq!(rt.state.composer.text, "Help me plan my day");
    assert!(rt.state.sent.is_empty(), "the owner still chooses to send");
}

/// The key of the element whose accessible label is `label`.
fn element_with_label(rt: &Runtime<Ui>, label: &str) -> String {
    rt.elements()
        .into_iter()
        .find(|e| e.label.as_deref() == Some(label))
        .and_then(|e| e.key)
        .unwrap_or_else(|| panic!("no element labelled {label}"))
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
        let id = scenes::APPROVAL_ID;
        let text = screen_text(&rt);
        assert!(text.contains("Waiting for your approval"));
        assert!(text.contains("calendar") && text.contains("execute"));
        assert!(text.contains("Expires "), "when the approval lapses");
        assert!(
            text.contains("calendar.events.list"),
            "exact arguments shown"
        );

        click(&mut rt, &format!("rd-approve-{id}"));
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Decide {
                approval_id: id.into(),
                decision: Decision::Approved,
                scope: Scope::Once,
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
fn only_command_approvals_offer_approve_for_session() {
    let rt = render(scenes::approval, false);
    let offer = format!("rd-approve-session-{}", scenes::APPROVAL_ID);
    assert!(rt.find(&offer).is_none(), "MCP approvals are once-only");

    let mut rt = render(scenes::command_approval, false);
    let id = scenes::COMMAND_APPROVAL_ID;
    // A multi-line command is shown as written, not as an escaped string.
    let text = screen_text(&rt);
    assert!(text.contains("ls -la notes\nwc -l notes/*.md"), "{text}");
    click(&mut rt, &format!("rd-approve-session-{id}"));
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Decide {
            approval_id: id.into(),
            decision: Decision::Approved,
            scope: Scope::Session,
        })
    );
}

#[test]
fn finished_replies_show_their_tools_time_and_cost() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversation, dark);
        let text = screen_text(&rt);
        assert!(text.contains("88 tokens · $0.0004"), "{text}");
        // 640 + 1,210 tokens over the run's two model calls.
        assert!(text.contains("1.9k tokens · $0.01"), "{text}");
        assert!(text.contains("Used 2 tools · 3s"), "{text}");
        assert!(rt.find("rd-step-op-1").is_none(), "steps start folded");

        click(&mut rt, "rd-steps-toggle-t2");
        let text = screen_text(&rt);
        assert!(
            text.contains("read_file") && text.contains("search"),
            "{text}"
        );
        assert!(!text.contains("notes/rust.md"), "details start folded");
        click(&mut rt, "rd-step-toggle-op-1");
        assert!(screen_text(&rt).contains("notes/rust.md"));
        click(&mut rt, "rd-steps-toggle-t2");
        assert!(rt.find("rd-step-op-1").is_none());
    }
}

#[test]
fn a_running_task_can_be_stopped_and_a_queued_message_steered() {
    let mut rt = render(scenes::working, false);
    let text = screen_text(&rt);
    assert!(text.contains("Running calendar · list_events…"), "{text}");
    assert!(text.contains("elapsed"), "{text}");
    assert!(text.contains("Queued"), "{text}");
    assert!(rt.find("rd-send").is_none(), "nothing typed: Stop only");

    click(&mut rt, "rd-stop");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Control {
            session_id: "s-1".into(),
            action: ControlAction::Stop,
            turn_id: None,
        })
    );
    click(&mut rt, "rd-queue-toggle-t3");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Control {
            session_id: "s-1".into(),
            action: ControlAction::Steer,
            turn_id: Some("t3".into()),
        })
    );

    // With a message typed, it can be queued or the task stopped.
    click(&mut rt, "rd-composer");
    rt.paste("And Saturday?");
    settle(&mut rt);
    assert!(rt.find("rd-send").is_some() && rt.find("rd-stop").is_some());
}

#[test]
fn settings_open_in_the_app_and_close_back_to_conversations() {
    for dark in [false, true] {
        let mut rt = render(scenes::new_conversation, dark);
        click(&mut rt, "rd-settings");
        // The selected bot's Profile, with that bot unfolded in the navigation.
        assert_eq!(
            rt.state.screen,
            Screen::Settings(Page::Bot {
                bot_id: "default".into(),
                section: BotSection::Profile,
            })
        );
        assert!(rt.find("rd-nav-default-models").is_some());
        assert!(
            rt.find("rd-roster").is_none(),
            "settings replace the workspace"
        );
        assert!(rt.state.opened.is_empty(), "nothing opens a browser");

        click(&mut rt, "rd-nav-default-models");
        assert_eq!(
            element(&rt, "rd-settings-page-name").text.as_deref(),
            Some("Models")
        );
        click(&mut rt, "rd-nav-appearance");
        assert_eq!(rt.state.screen, Screen::Settings(Page::Appearance));
        click(&mut rt, "rd-close-settings");
        assert_eq!(rt.state.screen, Screen::Workspace);

        click(&mut rt, "rd-account-settings");
        assert_eq!(rt.state.screen, Screen::Settings(Page::Account));
        click(&mut rt, "rd-back-to-conversations");
        assert!(rt.find("rd-roster").is_some());
    }
}

#[test]
fn the_account_page_says_who_is_signed_in_and_signs_out() {
    let mut rt = render(scenes::settings_account, false);
    let text = screen_text(&rt);
    assert!(
        text.contains("Owner") && text.contains("owner@example.com"),
        "{text}"
    );
    assert!(
        text.contains("https://raphie.example.ts.net"),
        "the address"
    );

    // Devices and passkeys are the browser's: the host refuses device tokens.
    click(&mut rt, "rd-account-web");
    assert_eq!(
        rt.state.opened,
        ["https://raphie.example.ts.net/?view=settings&section=account"]
    );
    click(&mut rt, "rd-account-sign-out");
    assert_eq!(rt.state.sent.last(), Some(&Command::SignOut));
    assert_eq!(rt.state.screen, Screen::Workspace);
}

#[test]
fn appearance_pins_the_theme_whatever_the_system_uses() {
    // The system is light throughout; the choice decides.
    let mut rt = render(scenes::settings_appearance, false);
    assert_eq!(color(&rt, "rd-settings"), "#f7f5ef");
    click(&mut rt, "rd-theme-dark");
    assert_eq!(rt.state.theme, ThemeChoice::Dark);
    assert_eq!(color(&rt, "rd-settings"), "#1c1b18");
    click(&mut rt, "rd-theme-system");
    assert_eq!(color(&rt, "rd-settings"), "#f7f5ef");

    // And the other way round: a dark system, pinned light.
    let mut rt = render(scenes::settings_appearance, true);
    click(&mut rt, "rd-theme-light");
    assert_eq!(color(&rt, "rd-settings"), "#f7f5ef");
}

/// Delivers an engine event, as `poll` would in a window.
fn deliver(rt: &mut Runtime<Ui>, event: Event) {
    rt.update(|ui, tx| {
        state::receive(ui, vec![event], tx);
    });
    settle(rt);
}

fn research(description: &str, revision: u32) -> BotProfile {
    BotProfile {
        id: "b-research".into(),
        name: "Research".into(),
        description: description.into(),
        color: None,
        soul: "Be brief.".into(),
        revision,
    }
}

/// The Research bot's Profile page, at revision 3.
fn research_profile(ui: &mut Ui) {
    scenes::settings_account(ui);
    let mut bots = ui.model.bots.clone();
    bots[1] = research("Reads and summarises.", 3);
    ui.model.apply(Event::Bots(bots));
    ui.open_settings(Some(Page::Bot {
        bot_id: "b-research".into(),
        section: BotSection::Profile,
    }));
}

#[test]
fn a_profile_is_edited_saved_and_shown_at_its_new_revision() {
    for dark in [false, true] {
        let mut rt = render(research_profile, dark);
        // Opening the page asks the host for the latest bots.
        assert_eq!(rt.state.sent.last(), Some(&Command::RefreshBots));
        assert!(rt.find("rd-save-bar").is_none(), "a clean page is quiet");
        assert_eq!(
            element(&rt, "rd-profile-revision").text.as_deref(),
            Some("Revision 3")
        );

        click(&mut rt, "rd-profile-color-teal");
        assert_eq!(
            element(&rt, "rd-profile-color-name").text.as_deref(),
            Some("#83BCB4")
        );
        assert_eq!(
            element(&rt, "rd-profile-status").text.as_deref(),
            Some("Unsaved changes")
        );

        click(&mut rt, "rd-profile-save");
        let Some(Command::SaveProfile { bot_id, update }) = rt.state.sent.last().cloned() else {
            panic!("no save was sent");
        };
        assert_eq!(bot_id, "b-research");
        assert_eq!(
            (update.revision, update.color.as_deref()),
            (3, Some("#83bcb4"))
        );
        assert_eq!(update.soul, "Be brief.");
        // A second press while saving sends nothing more.
        click(&mut rt, "rd-profile-save");
        let saves = rt
            .state
            .sent
            .iter()
            .filter(|c| matches!(c, Command::SaveProfile { .. }))
            .count();
        assert_eq!(saves, 1);

        let mut saved = research("Reads and summarises.", 4);
        saved.color = Some("#83bcb4".into());
        deliver(&mut rt, Event::ProfileSaved(saved));
        assert_eq!(
            element(&rt, "rd-profile-status").text.as_deref(),
            Some("Saved revision 4.")
        );
        assert_eq!(
            element(&rt, "rd-profile-revision").text.as_deref(),
            Some("Revision 4")
        );
        assert!(!rt.state.profile.is_dirty());
    }
}

#[test]
fn a_profile_changed_elsewhere_keeps_the_draft_and_blocks_saving() {
    let mut rt = render(research_profile, false);
    click(&mut rt, "rd-profile-color-automatic");
    click(&mut rt, "rd-profile-color-rose");
    // Another client saves the bot while this draft is open.
    let mut bots = rt.state.model.bots.clone();
    bots[1] = research("Changed in the browser.", 4);
    deliver(&mut rt, Event::Bots(bots.clone()));
    assert!(
        element(&rt, "rd-profile-error")
            .text
            .unwrap()
            .contains("changed elsewhere")
    );
    assert_eq!(
        rt.state.profile.color.as_deref(),
        Some("#dda6b5"),
        "the draft stays"
    );
    click(&mut rt, "rd-profile-save");
    assert!(
        !rt.state
            .sent
            .iter()
            .any(|c| matches!(c, Command::SaveProfile { .. })),
        "a stale draft is not sent"
    );

    // Discard loads the latest revision.
    click(&mut rt, "rd-profile-discard");
    assert_eq!(rt.state.profile.description.text, "Changed in the browser.");
    assert!(rt.find("rd-save-bar").is_none());

    // With no edits, the form simply follows the bot.
    bots[1] = research("Changed again.", 5);
    deliver(&mut rt, Event::Bots(bots));
    assert_eq!(rt.state.profile.description.text, "Changed again.");
}

#[test]
fn unsaved_profile_edits_survive_a_look_at_another_page() {
    let mut rt = render(research_profile, false);
    click(&mut rt, "rd-profile-color-sky");
    click(&mut rt, "rd-nav-appearance");
    click(&mut rt, "rd-nav-default-bot");
    assert_eq!(rt.state.profile.bot_id(), Some("default"));
    assert!(
        !rt.state.profile.is_dirty(),
        "the other bot's form is clean"
    );
    click(&mut rt, "rd-nav-b-research-bot");
    assert_eq!(rt.state.profile.color.as_deref(), Some("#91b7df"));
    assert!(rt.find("rd-save-bar").is_some());
}

#[test]
fn a_failed_save_says_why_and_a_bad_custom_colour_is_refused() {
    let mut rt = render(research_profile, false);
    click(&mut rt, "rd-profile-custom-color");
    rt.paste("teal");
    settle(&mut rt);
    click(&mut rt, "rd-profile-custom-use");
    assert_eq!(rt.state.profile.color, None, "not a colour");
    assert!(
        element(&rt, "rd-profile-error")
            .text
            .unwrap()
            .contains("six hex digits")
    );

    click(&mut rt, "rd-profile-color-sand");
    click(&mut rt, "rd-profile-save");
    deliver(
        &mut rt,
        Event::ProfileFailed {
            bot_id: "b-research".into(),
            message: "Could not reach Raphie".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-profile-error").text.as_deref(),
        Some("Could not reach Raphie")
    );
    assert!(rt.state.profile.is_dirty(), "nothing typed is lost");
}

#[test]
fn a_bots_page_names_the_bot_and_offers_the_web_page() {
    let mut rt = render(scenes::settings_bot, false);
    let text = screen_text(&rt);
    assert!(text.contains("Research only"), "{text}");
    assert!(text.contains("How Research runs commands"), "{text}");
    click(&mut rt, "rd-bot-page-web");
    assert_eq!(
        rt.state.opened,
        ["https://raphie.example.ts.net/?view=settings&section=sandbox&bot=b-research"]
    );
    // Folding a bot hides its pages without leaving the page.
    click(&mut rt, "rd-nav-bot-b-research");
    assert!(rt.find("rd-nav-b-research-sandbox").is_none());
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Sandbox")
    );
}

#[test]
fn the_models_page_loads_shows_and_filters_the_catalogue() {
    for dark in [false, true] {
        // Opening the page asks for the bot's settings and waits for them.
        let mut rt = render(scenes::settings_account, dark);
        click(&mut rt, "rd-nav-default-models");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::LoadSettings {
                bot_id: "default".into()
            })
        );
        assert!(screen_text(&rt).contains("Loading models…"));
        deliver(
            &mut rt,
            Event::BotSettings {
                bot_id: "default".into(),
                settings: Box::new(scenes::model_settings()),
            },
        );

        let text = screen_text(&rt);
        assert!(text.contains("Default for new sessions"), "{text}");
        assert!(
            text.contains("Personal · Existing sessions keep their model."),
            "{text}"
        );
        assert_eq!(
            element(&rt, "rd-models-count").text.as_deref(),
            Some("5 models available")
        );
        // Numbers as the web writes them; no price shows a dash.
        for expected in [
            "1M context",
            "128K output",
            "$10.00",
            "$0.075",
            "—",
            "Vision",
        ] {
            assert!(text.contains(expected), "{expected} in {text}");
        }
        // A name's maker moves to the small label above it.
        assert!(text.contains("GPT Next") && !text.contains("OpenAI: GPT Next"));

        click(&mut rt, "rd-models-search");
        rt.paste("claude");
        settle(&mut rt);
        assert_eq!(
            element(&rt, "rd-models-count").text.as_deref(),
            Some("3 models match your filters")
        );
        assert!(rt.find("rd-model-c-router-openai/gpt-next").is_none());
        click(&mut rt, "rd-models-clear");
        assert_eq!(
            element(&rt, "rd-models-count").text.as_deref(),
            Some("5 models available")
        );
    }
}

#[test]
fn a_model_becomes_the_default_once() {
    // Tall enough to show every card, so each press lands on its button.
    let mut rt = render_sized(scenes::settings_models, false, (1280.0, 1200.0));
    click(&mut rt, "rd-model-default-c-router-openai/gpt-next");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::SetDefaultModel {
            bot_id: "default".into(),
            model_id: "openai/gpt-next".into(),
            connection_id: "c-router".into(),
        })
    );
    // While the change is on its way another press sends nothing.
    click(&mut rt, "rd-model-default-c-direct-claude-haiku");
    let changes = rt
        .state
        .sent
        .iter()
        .filter(|c| matches!(c, Command::SetDefaultModel { .. }))
        .count();
    assert_eq!(changes, 1);

    let mut settings = scenes::model_settings();
    settings.model_id = "openai/gpt-next".into();
    settings.provider = "c-router".into();
    deliver(
        &mut rt,
        Event::DefaultModelSet {
            bot_id: "default".into(),
            settings: Box::new(settings),
        },
    );
    assert_eq!(
        element(&rt, "rd-models-message").text.as_deref(),
        Some("OpenAI: GPT Next is now the default for new sessions.")
    );
    assert!(screen_text(&rt).contains("Work · Existing sessions keep their model."));
}

#[test]
fn providers_list_connections_and_remove_one() {
    for dark in [false, true] {
        let mut rt = render(scenes::settings_account, dark);
        click(&mut rt, "rd-nav-default-providers");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::LoadSettings {
                bot_id: "default".into()
            })
        );
        deliver(
            &mut rt,
            Event::BotSettings {
                bot_id: "default".into(),
                settings: Box::new(scenes::model_settings()),
            },
        );
        let text = screen_text(&rt);
        assert!(text.contains("2 connections · name each one"), "{text}");
        // Each card names its provider and counts its models.
        for expected in [
            "Personal",
            "Anthropic",
            "2 models",
            "Work",
            "OpenRouter",
            "3 models",
        ] {
            assert!(text.contains(expected), "{expected} in {text}");
        }

        click(&mut rt, "rd-connection-remove-c-router");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::ChangeConnection {
                bot_id: "default".into(),
                change: ConnectionChange::Remove {
                    id: "c-router".into(),
                    name: "Work".into(),
                },
            })
        );
        let mut settings = scenes::model_settings();
        settings.connections.retain(|c| c.id != "c-router");
        deliver(
            &mut rt,
            Event::ConnectionChanged {
                bot_id: "default".into(),
                settings: Some(Box::new(settings)),
                message: "Work removed. Other connections are unchanged.".into(),
            },
        );
        assert!(rt.find("rd-connection-c-router").is_none());
        assert_eq!(
            element(&rt, "rd-providers-message").text.as_deref(),
            Some("Work removed. Other connections are unchanged.")
        );
    }
}

#[test]
fn a_connection_is_added_with_a_key_that_is_never_shown() {
    let mut rt = render_sized(scenes::settings_providers, false, (1280.0, 1300.0));
    click(&mut rt, "rd-providers-add");
    // The web's suggestion: the provider's name and the next number.
    assert_eq!(rt.state.providers.name.text, "Anthropic 2");

    // Without a key there is nothing to add or to try.
    click(&mut rt, "rd-connection-save");
    click(&mut rt, "rd-connection-test");
    assert!(
        !rt.state
            .sent
            .iter()
            .any(|c| matches!(c, Command::ChangeConnection { .. })),
        "no key yet"
    );

    click(&mut rt, "rd-connection-key");
    rt.paste("sk-pasted-key");
    settle(&mut rt);
    assert!(
        !screen_text(&rt).contains("sk-pasted-key"),
        "the key is drawn as dots"
    );
    click(&mut rt, "rd-connection-save");
    let sent = rt.state.sent.last().cloned().unwrap();
    assert_eq!(
        sent,
        Command::ChangeConnection {
            bot_id: "default".into(),
            change: ConnectionChange::Add {
                provider: "anthropic".into(),
                name: "Anthropic 2".into(),
                key: Secret::new("sk-pasted-key"),
            },
        }
    );
    assert!(
        !format!("{sent:?}").contains("sk-pasted-key"),
        "redacted when printed"
    );

    // Once the host has it, the form closes and the key is forgotten.
    deliver(
        &mut rt,
        Event::ConnectionChanged {
            bot_id: "default".into(),
            settings: Some(Box::new(scenes::model_settings())),
            message: "Connection added.".into(),
        },
    );
    assert!(rt.find("rd-connection-form").is_none());
    assert_eq!(rt.state.providers.key.text, "");
}

#[test]
fn editing_a_connection_keeps_its_key_unless_one_is_typed() {
    let mut rt = render_sized(scenes::settings_providers, false, (1280.0, 1300.0));
    click(&mut rt, "rd-connection-edit-c-direct");
    assert_eq!(rt.state.providers.name.text, "Personal");
    let text = screen_text(&rt);
    assert!(text.contains("Edit Personal"), "{text}");
    assert!(text.contains("Replace API key"), "{text}");

    // A saved connection can be tried with the key it already has.
    click(&mut rt, "rd-connection-test");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ChangeConnection {
            bot_id: "default".into(),
            change: ConnectionChange::Test {
                id: Some("c-direct".into()),
                key: None,
            },
        })
    );
    // A failed test says why and leaves the form open.
    deliver(
        &mut rt,
        Event::ConnectionFailed {
            message: "The provider rejected this API key.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-connection-message").text.as_deref(),
        Some("The provider rejected this API key.")
    );

    // Cancel closes the form; nothing was changed.
    click(&mut rt, "rd-connection-cancel");
    assert!(rt.find("rd-connection-form").is_none());

    click(&mut rt, "rd-connection-edit-c-direct");
    click(&mut rt, "rd-connection-save");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ChangeConnection {
            bot_id: "default".into(),
            change: ConnectionChange::Edit {
                id: "c-direct".into(),
                name: "Personal".into(),
                key: None,
            },
        })
    );
    // While the save is on its way the form cannot be cancelled.
    click(&mut rt, "rd-connection-cancel");
    assert!(rt.find("rd-connection-form").is_some());
}

#[test]
fn models_that_cannot_load_offer_a_retry() {
    let mut rt = render(scenes::settings_account, false);
    click(&mut rt, "rd-nav-default-models");
    deliver(
        &mut rt,
        Event::BotSettingsFailed {
            bot_id: "default".into(),
            message: "Could not reach Raphie".into(),
        },
    );
    assert!(screen_text(&rt).contains("Could not load models."));
    let before = rt.state.sent.len();
    click(&mut rt, "rd-settings-retry");
    assert_eq!(rt.state.sent.len(), before + 1);
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadSettings { .. })
    ));
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

#[test]
fn memory_settings_load_and_a_change_is_saved() {
    for dark in [false, true] {
        // Opening the page asks for the bot's memory settings and waits.
        let mut rt = render_sized(scenes::settings_account, dark, (1280.0, 1300.0));
        click(&mut rt, "rd-nav-default-memory");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::LoadMemory {
                bot_id: "default".into()
            })
        );
        assert!(screen_text(&rt).contains("Loading memory settings…"));
        deliver(
            &mut rt,
            Event::Memory {
                bot_id: "default".into(),
                status: scenes::memory_status(false),
            },
        );
        let text = screen_text(&rt);
        for expected in [
            "Enable memory",
            "Stored locally in this backend’s SQLite database.",
            "Model-assisted reflection",
            "Available",
        ] {
            assert!(text.contains(expected), "{expected} in {text}");
        }
        // Nothing changed yet: no save bar, and no Hindsight fields.
        assert!(rt.find("rd-save-bar").is_none());
        assert!(rt.find("rd-memory-endpoint").is_none());

        // Switching memory off is a change; a test must wait for the save.
        click(&mut rt, "rd-memory-enabled");
        assert_eq!(
            element(&rt, "rd-memory-status").text.as_deref(),
            Some("Unsaved memory changes")
        );
        click(&mut rt, "rd-memory-test");
        assert!(
            !rt.state
                .sent
                .iter()
                .any(|c| matches!(c, Command::TestMemory { .. })),
            "a test uses the saved setup"
        );
        click(&mut rt, "rd-memory-save");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SaveMemory {
                bot_id: "default".into(),
                update: MemoryUpdate {
                    enabled: false,
                    provider: MemoryProvider::Builtin,
                    scope: "owner".into(),
                    endpoint: String::new(),
                    bank_id: String::new(),
                    key: KeyChange::Keep,
                },
            })
        );
        let mut saved = scenes::memory_status(false);
        saved.configuration.enabled = false;
        deliver(
            &mut rt,
            Event::MemorySaved {
                bot_id: "default".into(),
                status: saved,
            },
        );
        assert!(rt.find("rd-save-bar").is_none());
        assert_eq!(
            element(&rt, "rd-memory-message").text.as_deref(),
            Some("Memory settings saved.")
        );
    }
}

#[test]
fn a_hindsight_key_is_replaced_or_cleared_and_never_shown() {
    let mut rt = render_sized(scenes::settings_memory_hindsight, false, (1280.0, 1500.0));
    // The typed key is drawn as dots: its text is nowhere on screen.
    let text = screen_text(&rt);
    assert!(!text.contains("hs-not-a-real-key"), "{text}");
    assert!(text.contains("API key · saved"), "{text}");
    assert!(text.contains("Provider reflection"), "{text}");

    click(&mut rt, "rd-memory-save");
    let Some(Command::SaveMemory { update, .. }) = rt.state.sent.last() else {
        panic!("no save was sent");
    };
    assert_eq!(update.bank_id, "raphie-work");
    assert_eq!(
        update.key,
        KeyChange::Replace(Secret::new("hs-not-a-real-key"))
    );
    // A command that carries a key can be logged: the key is redacted.
    assert!(!format!("{update:?}").contains("hs-not-a-real-key"));

    // What the runtime refuses is shown, and nothing typed is lost.
    deliver(
        &mut rt,
        Event::MemorySaveFailed {
            message: "Wait for active turns to finish before changing memory settings.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-memory-error").text.as_deref(),
        Some("Wait for active turns to finish before changing memory settings.")
    );
    assert_eq!(rt.state.memory.bank_id.text, "raphie-work");

    // Ticking "Clear saved API key" drops the typed key and sends a clear.
    click(&mut rt, "rd-memory-clear-key");
    assert!(rt.state.memory.key.text.is_empty());
    click(&mut rt, "rd-memory-save");
    let Some(Command::SaveMemory { update, .. }) = rt.state.sent.last() else {
        panic!("no save was sent");
    };
    assert_eq!(update.key, KeyChange::Clear);

    // A saved form forgets the key and the bar goes away.
    let mut saved = scenes::memory_status(true);
    saved.configuration.bank_id = "raphie-work".into();
    saved.configuration.has_credential = false;
    deliver(
        &mut rt,
        Event::MemorySaved {
            bot_id: "default".into(),
            status: saved,
        },
    );
    assert!(rt.find("rd-save-bar").is_none());
    assert!(rt.find("rd-memory-clear-key").is_none());
    assert!(screen_text(&rt).contains("API key · optional for a local server"));

    // With nothing to save, the saved setup can be tested.
    click(&mut rt, "rd-memory-test");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::TestMemory {
            bot_id: "default".into()
        })
    );
    deliver(
        &mut rt,
        Event::MemoryTested {
            message: "Hindsight did not answer.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-memory-message").text.as_deref(),
        Some("Hindsight did not answer.")
    );
}

#[test]
fn a_bad_scope_cannot_be_saved() {
    let mut rt = render_sized(scenes::settings_memory, false, (1280.0, 1300.0));
    rt.update(|ui, _| ui.memory.scope = rune::TextEdit::new("two words"));
    settle(&mut rt);
    assert!(
        element(&rt, "rd-memory-error")
            .text
            .unwrap_or_default()
            .contains("scope")
    );
    click(&mut rt, "rd-memory-save");
    assert!(
        !rt.state
            .sent
            .iter()
            .any(|c| matches!(c, Command::SaveMemory { .. }))
    );
    // Discard puts the saved scope back.
    click(&mut rt, "rd-memory-discard");
    assert_eq!(rt.state.memory.scope.text, "owner");
    assert!(rt.find("rd-save-bar").is_none());
}

fn changes(rt: &Runtime<Ui>) -> Vec<&ChannelChange> {
    let sent = rt.state.sent.iter();
    sent.filter_map(|command| match command {
        Command::ChangeChannel { change, .. } => Some(change),
        _ => None,
    })
    .collect()
}

#[test]
fn channels_load_and_describe_each_connection() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 1600.0));
    click(&mut rt, "rd-nav-default-channels");
    let asked = |rt: &Runtime<Ui>, wanted: &Command| rt.state.sent.contains(wanted);
    assert!(asked(
        &rt,
        &Command::LoadChannels {
            bot_id: "default".into()
        }
    ));
    assert!(asked(
        &rt,
        &Command::LoadChannelHome {
            bot_id: "default".into()
        }
    ));
    assert!(screen_text(&rt).contains("Loading channels…"));
    deliver(
        &mut rt,
        Event::Channels {
            bot_id: "default".into(),
            settings: scenes::channel_settings(false),
        },
    );
    let text = screen_text(&rt);
    for expected in [
        "Connected",
        "Connected as @raphie_example_bot · 1 verified account",
        "Loading home channel…",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    assert!(
        rt.find("rd-discord-settings").is_none(),
        "forms start folded"
    );

    // The home channel arrives separately and is chosen by a button.
    deliver(
        &mut rt,
        Event::ChannelHome {
            bot_id: "default".into(),
            home: scenes::channel_home(false),
        },
    );
    assert_eq!(
        element(&rt, "rd-home-web").label.as_deref(),
        Some("Selected")
    );
    click(&mut rt, "rd-home-telegram:7300112233");
    assert_eq!(
        changes(&rt),
        [&ChannelChange::SelectHome(Some(
            "telegram:7300112233".into()
        ))]
    );
    deliver(
        &mut rt,
        Event::ChannelChangeFailed {
            channel: Channel::Home,
            message: "That conversation is no longer verified.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-home-error").text.as_deref(),
        Some("That conversation is no longer verified.")
    );
    assert!(rt.find("rd-discord-alert").is_none(), "not Discord's error");
}

#[test]
fn the_discord_form_checks_ids_and_never_shows_the_token() {
    let mut rt = render_sized(scenes::settings_channels, false, (1280.0, 1800.0));
    click(&mut rt, "rd-discord-toggle");
    assert_eq!(rt.state.discord.user_ids.len(), 2);
    // Closing a clean form is fine; a form with edits says how to leave.
    click(&mut rt, "rd-discord-toggle");
    assert!(rt.find("rd-discord-settings").is_none());
    click(&mut rt, "rd-discord-toggle");
    click(&mut rt, "rd-discord-add-user");
    assert_eq!(rt.state.discord.user_ids.len(), 3);
    click(&mut rt, "rd-discord-toggle");
    assert_eq!(
        element(&rt, "rd-discord-alert-message").text.as_deref(),
        Some("Save your changes or choose Cancel to discard them.")
    );

    // A repeated id is caught here, before anything is sent.
    rt.update(|ui, _| {
        ui.discord.user_ids[2] = TextEdit::new("318274650912345678");
        ui.discord.token = TextEdit::new("discord-not-a-real-token").secure();
    });
    settle(&mut rt);
    assert!(!screen_text(&rt).contains("discord-not-a-real-token"));
    click(&mut rt, "rd-discord-save");
    assert_eq!(
        element(&rt, "rd-discord-alert-message").text.as_deref(),
        Some("User IDs must be unique.")
    );
    assert!(changes(&rt).is_empty());

    // Removing the row fixes it; the save carries the token once.
    click(&mut rt, "rd-discord-user-2-remove");
    click(&mut rt, "rd-discord-save");
    let [ChannelChange::SaveDiscord(update)] = changes(&rt)[..] else {
        panic!("one Discord save");
    };
    assert_eq!(update.allowed_user_ids.len(), 2);
    assert_eq!(
        update.token.as_ref().map(|token| token.expose()),
        Some("discord-not-a-real-token")
    );
    assert!(!format!("{:?}", rt.state.sent).contains("discord-not-a-real-token"));

    // A refusal keeps the form; success folds it and forgets the token.
    deliver(
        &mut rt,
        Event::ChannelChangeFailed {
            channel: Channel::Discord,
            message: "Discord rejected the bot token.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-discord-alert-message").text.as_deref(),
        Some("Discord rejected the bot token.")
    );
    click(&mut rt, "rd-discord-save");
    deliver(
        &mut rt,
        Event::ChannelChanged {
            bot_id: "default".into(),
            outcome: ChannelOutcome::DiscordSaved,
            settings: Some(scenes::channel_settings(false)),
            pairing: None,
        },
    );
    assert!(rt.find("rd-discord-settings").is_none());
    assert!(rt.state.discord.token.text.is_empty());
    assert_eq!(
        element(&rt, "rd-discord-message").text.as_deref(),
        Some("Discord settings saved.")
    );
}

#[test]
fn a_discord_conflict_is_explained_and_the_portal_opens_in_the_browser() {
    let mut rt = render_sized(scenes::settings_channels_discord, false, (1280.0, 1800.0));
    let text = screen_text(&rt);
    assert!(text.contains("Disconnected · application used by another bot"));
    assert!(text.contains("Discord application already in use"));
    click(&mut rt, "rd-discord-portal");
    assert_eq!(
        rt.state.opened,
        ["https://discord.com/developers/applications"]
    );
    click(&mut rt, "rd-discord-remove");
    assert_eq!(changes(&rt), [&ChannelChange::RemoveDiscord]);
}

#[test]
fn telegram_connects_pairs_revokes_and_pauses() {
    let mut rt = render_sized(scenes::settings_channels_empty, false, (1280.0, 1800.0));
    click(&mut rt, "rd-telegram-toggle");
    assert!(
        rt.find("rd-telegram-enabled").is_none(),
        "nothing saved yet"
    );
    // Something that is not a bot token is caught before it is sent.
    rt.update(|ui, _| ui.telegram.token = TextEdit::new("hello").secure());
    settle(&mut rt);
    click(&mut rt, "rd-telegram-save");
    assert_eq!(
        element(&rt, "rd-telegram-alert-message").text.as_deref(),
        Some("Enter a valid bot token.")
    );
    assert!(changes(&rt).is_empty());
    rt.update(|ui, _| {
        ui.telegram.token = TextEdit::new("123456:telegram-not-a-real-token").secure();
    });
    settle(&mut rt);
    assert!(!screen_text(&rt).contains("telegram-not-a-real-token"));
    click(&mut rt, "rd-telegram-save");
    assert!(matches!(changes(&rt)[..], [ChannelChange::SaveTelegram(_)]));
    deliver(
        &mut rt,
        Event::ChannelChanged {
            bot_id: "default".into(),
            outcome: ChannelOutcome::TelegramSaved,
            settings: Some(scenes::channel_settings(false)),
            pairing: None,
        },
    );
    // The panel stays open for pairing; the token is gone.
    assert!(rt.state.telegram.token.text.is_empty());
    assert_eq!(
        element(&rt, "rd-telegram-message").text.as_deref(),
        Some("Telegram connected.")
    );

    // A pairing code shows only while the runtime says it is still live.
    click(&mut rt, "rd-telegram-pair");
    deliver(
        &mut rt,
        Event::ChannelChanged {
            bot_id: "default".into(),
            outcome: ChannelOutcome::TelegramPairing,
            settings: Some(scenes::channel_settings(true)),
            pairing: Some(TelegramPairingCode {
                code: "K7Q2-M9XD".into(),
                expires_at: 1_794_650_400_000,
            }),
        },
    );
    assert_eq!(
        element(&rt, "rd-telegram-code").text.as_deref(),
        Some("K7Q2-M9XD")
    );
    assert!(screen_text(&rt).contains("send /pair K7Q2-M9XD"));
    // While the code is out the page asks every two seconds.
    let loads = |rt: &Runtime<Ui>| {
        let sent = rt.state.sent.iter();
        sent.filter(|c| matches!(c, Command::LoadChannels { .. }))
            .count()
    };
    let before = loads(&rt);
    rt.update(|ui, _| {
        ui.refresh_channels(50.0);
        ui.refresh_channels(51.0);
        ui.refresh_channels(52.5);
    });
    assert_eq!(loads(&rt), before + 2);
    // The account verified, so the code is used up and leaves the screen.
    deliver(
        &mut rt,
        Event::Channels {
            bot_id: "default".into(),
            settings: scenes::channel_settings(false),
        },
    );
    assert!(rt.find("rd-telegram-code").is_none());
    rt.update(|ui, _| {
        ui.refresh_channels(60.0);
    });
    assert_eq!(loads(&rt), before + 2, "no code out, no polling");

    click(&mut rt, "rd-telegram-revoke-7300112233");
    click(&mut rt, "rd-telegram-enabled");
    assert_eq!(
        changes(&rt).last(),
        Some(&&ChannelChange::UnpairTelegram("7300112233".into())),
        "one change at a time: the switch waits for the answer"
    );
    deliver(
        &mut rt,
        Event::ChannelChanged {
            bot_id: "default".into(),
            outcome: ChannelOutcome::TelegramUnpaired,
            settings: Some(scenes::channel_settings(false)),
            pairing: None,
        },
    );
    click(&mut rt, "rd-telegram-enabled");
    assert_eq!(
        changes(&rt).last(),
        Some(&&ChannelChange::EnableTelegram(false))
    );
}

#[test]
fn mcp_connections_load_and_show_what_each_can_do() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 1500.0));
    click(&mut rt, "rd-nav-default-mcp");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadMcp {
            bot_id: "default".into()
        })
    );
    assert!(screen_text(&rt).contains("Loading connections…"));
    deliver(
        &mut rt,
        Event::Mcp {
            bot_id: "default".into(),
            items: scenes::mcp_connections(),
        },
    );
    let label = |rt: &Runtime<Ui>, key: &str| element(rt, key).label.unwrap_or_default();
    assert_eq!(
        element(&rt, "rd-mcp-mcp-calendar-summary").text.as_deref(),
        Some("12 tools · Streamable HTTP · https://calendar.example.com/mcp")
    );
    assert_eq!(label(&rt, "rd-mcp-mcp-calendar-toggle"), "Pause");
    assert_eq!(label(&rt, "rd-mcp-mcp-docs-toggle"), "Cancel authorization");
    assert_eq!(label(&rt, "rd-mcp-mcp-files-toggle"), "Enable");
    // A connection from the host's environment can only be imported.
    assert!(rt.find("rd-mcp-env-search-toggle").is_none());
    assert!(rt.find("rd-mcp-env-search-remove").is_none());
    assert!(screen_text(&rt).contains("Import saves an encrypted copy"));

    // Authorizing happens in the browser, at the address the server gave.
    click(&mut rt, "rd-mcp-mcp-docs-authorize");
    assert_eq!(
        rt.state.opened,
        ["https://docs.example.com/oauth/authorize?state=made-up"]
    );

    click(&mut rt, "rd-mcp-mcp-calendar-toggle");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ChangeMcp {
            bot_id: "default".into(),
            id: "mcp-calendar".into(),
            action: McpAction::Disable,
        })
    );
    // One change at a time: the other buttons wait for the answer.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-mcp-mcp-files-remove");
    assert_eq!(rt.state.sent.len(), before);
    let mut paused = scenes::mcp_connections();
    paused[0].connected = false;
    paused[0].enabled = false;
    deliver(
        &mut rt,
        Event::McpChanged {
            bot_id: "default".into(),
            items: paused,
        },
    );
    assert_eq!(label(&rt, "rd-mcp-mcp-calendar-toggle"), "Enable");
    click(&mut rt, "rd-mcp-env-search-import");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::ChangeMcp { id, action: McpAction::Import, .. }) if id == "env-search"
    ));
    deliver(
        &mut rt,
        Event::McpChangeFailed {
            message: "Remove a saved connection before importing.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-mcp-error").text.as_deref(),
        Some("Remove a saved connection before importing.")
    );
}

#[test]
fn an_mcp_server_is_added_and_its_token_is_never_shown() {
    let mut rt = render_sized(scenes::settings_mcp_empty, false, (1280.0, 1500.0));
    assert!(screen_text(&rt).contains("No MCP servers yet"));
    // Nothing typed: nothing to connect or discard.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-mcp-connect");
    assert_eq!(rt.state.sent.len(), before);
    rt.update(|ui, _| {
        ui.mcp.name = TextEdit::new("Team docs");
        ui.mcp.address = TextEdit::new("https://docs.example.com/mcp");
        ui.mcp.token = TextEdit::new("mcp-not-a-real-token").secure();
    });
    settle(&mut rt);
    assert!(!screen_text(&rt).contains("mcp-not-a-real-token"));
    click(&mut rt, "rd-mcp-connect");
    let Some(Command::AddMcp { connection, .. }) = rt.state.sent.last() else {
        panic!("the form is sent");
    };
    assert!(matches!(
        connection,
        NewMcpConnection::Http { token: Some(token), .. } if token.expose() == "mcp-not-a-real-token"
    ));
    assert!(!format!("{:?}", rt.state.sent).contains("mcp-not-a-real-token"));
    assert_eq!(
        element(&rt, "rd-mcp-connect").label.as_deref(),
        Some("Connecting…")
    );

    // A refusal keeps what was typed; success empties the form.
    deliver(
        &mut rt,
        Event::McpChangeFailed {
            message: "A bot can have at most 16 MCP connections.".into(),
        },
    );
    assert_eq!(rt.state.mcp.name.text, "Team docs");
    click(&mut rt, "rd-mcp-connect");
    deliver(
        &mut rt,
        Event::McpAdded {
            bot_id: "default".into(),
            items: scenes::mcp_connections(),
        },
    );
    assert!(rt.state.mcp.token.text.is_empty() && rt.state.mcp.name.text.is_empty());
    assert_eq!(
        element(&rt, "rd-mcp-message").text.as_deref(),
        Some("Server added. Choose Authorize to sign in and grant access.")
    );
    assert!(rt.find("rd-mcp-error").is_none());
}

#[test]
fn a_local_command_checks_its_json_and_discard_empties_the_form() {
    let mut rt = render_sized(scenes::settings_mcp_command, false, (1280.0, 1500.0));
    // The scene pressed "Connect server" with arguments that are not JSON.
    assert_eq!(
        element(&rt, "rd-mcp-error").text.as_deref(),
        Some("Check the arguments and environment JSON.")
    );
    assert!(
        rt.state
            .sent
            .iter()
            .all(|c| !matches!(c, Command::AddMcp { .. }))
    );
    assert!(rt.find("rd-mcp-token").is_none(), "a command has no token");
    assert!(!screen_text(&rt).contains("not-a-real-token"));
    rt.update(|ui, _| ui.mcp.args = TextEdit::new(r#"["-y", "a-server"]"#));
    settle(&mut rt);
    click(&mut rt, "rd-mcp-connect");
    let Some(Command::AddMcp { connection, .. }) = rt.state.sent.last() else {
        panic!("the form is sent");
    };
    assert!(matches!(
        connection,
        NewMcpConnection::Stdio { command, args, env, .. }
            if command == "npx" && args.len() == 2 && env[0].0 == "API_TOKEN"
    ));
    deliver(
        &mut rt,
        Event::McpChangeFailed {
            message: "offline".into(),
        },
    );
    click(&mut rt, "rd-mcp-discard");
    assert!(!rt.state.mcp.is_dirty());
    assert!(rt.find("rd-mcp-error").is_none());
    assert!(rt.find("rd-mcp-token").is_some(), "back to a URL server");
}

#[test]
fn the_mcp_page_asks_again_every_few_seconds_while_it_shows() {
    let mut rt = render(scenes::settings_mcp, false);
    let loads = |rt: &Runtime<Ui>| {
        let sent = &rt.state.sent;
        sent.iter()
            .filter(|c| matches!(c, Command::LoadMcp { .. }))
            .count()
    };
    let opened = loads(&rt);
    rt.update(|ui, _| {
        assert!(ui.refresh_mcp(100.0));
        // Two seconds later is too soon to ask again.
        assert!(ui.refresh_mcp(102.0));
    });
    assert_eq!(loads(&rt), opened + 1);
    rt.update(|ui, _| {
        ui.refresh_mcp(105.5);
        // Elsewhere in Settings, nothing is asked.
        ui.open_settings(Some(Page::Account));
        assert!(!ui.refresh_mcp(200.0));
    });
    assert_eq!(loads(&rt), opened + 2);
}

/// The ticket of the load the page last asked for.
fn memory_ticket(rt: &Runtime<Ui>) -> u64 {
    match rt.state.sent.last() {
        Some(Command::BrowseMemory { ticket, .. } | Command::SearchMemory { ticket, .. }) => {
            *ticket
        }
        other => panic!("the last command is not a memory load: {other:?}"),
    }
}

fn browse_page() -> Page {
    Page::Bot {
        bot_id: "default".into(),
        section: BotSection::MemoryBrowse,
    }
}

#[test]
fn saved_memories_are_listed_paged_corrected_and_forgotten() {
    let mut rt = render_sized(scenes::settings_memory, false, (1280.0, 1500.0));
    click(&mut rt, "rd-memory-browse");
    assert_eq!(rt.state.screen, Screen::Settings(browse_page()));
    assert!(rt.state.opened.is_empty(), "the page is in the app");
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Browse memory")
    );
    // The page asks for the first page at once and says so.
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::BrowseMemory { after: None, .. })
    ));
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("Loading memories…")
    );
    let mut evidence = scenes::memory_evidence();
    let third = evidence.pop().unwrap();
    let ticket = memory_ticket(&rt);
    deliver(
        &mut rt,
        Event::MemoryListed {
            ticket,
            more: false,
            page: MemoryPage {
                evidence,
                next: Some("cursor-2".into()),
                total: 3,
            },
        },
    );
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("Showing 2 of 3 saved memories")
    );
    let text = screen_text(&rt);
    for expected in ["Prefers short answers", "Experience", "revision 2"] {
        assert!(text.contains(expected), "missing {expected:?}");
    }

    // "Load more" asks for the page after the cursor and adds to the list.
    click(&mut rt, "rd-memories-more");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::BrowseMemory { after: Some(cursor), .. }) if cursor == "cursor-2"
    ));
    let ticket = memory_ticket(&rt);
    deliver(
        &mut rt,
        Event::MemoryListed {
            ticket,
            more: true,
            page: MemoryPage {
                evidence: vec![third],
                next: None,
                total: 3,
            },
        },
    );
    assert!(rt.find("rd-memories-more").is_none());
    assert!(screen_text(&rt).contains("Time not supplied"));

    // Correcting opens an editor holding what the memory says now.
    click(&mut rt, "rd-memory-mem_01jc8x2v7q-correct");
    assert!(
        rt.state
            .memories
            .correction
            .text
            .starts_with("Prefers short")
    );
    rt.update(|ui, _| ui.memories.correction = TextEdit::new("  Prefers long answers.  "));
    settle(&mut rt);
    click(&mut rt, "rd-memory-mem_01jc8x2v7q-save");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ReviseMemory {
            bot_id: "default".into(),
            id: "mem_01jc8x2v7q".into(),
            content: "Prefers long answers.".into(),
        })
    );
    deliver(
        &mut rt,
        Event::MemoryRevised {
            id: "mem_01jc8x2v7q".into(),
            content: "Prefers long answers.".into(),
        },
    );
    assert!(rt.find("rd-memory-mem_01jc8x2v7q-save").is_none());
    let text = screen_text(&rt);
    assert!(text.contains("Prefers long answers."));
    assert!(text.contains("revision 3"));

    // Forgetting asks first. A refusal is shown and keeps the memory.
    click(&mut rt, "rd-memory-mem_01jc7m4k2d-forget");
    assert!(
        rt.state
            .sent
            .iter()
            .all(|c| !matches!(c, Command::ForgetMemory { .. })),
        "nothing is forgotten before the owner confirms"
    );
    click(&mut rt, "rd-memory-mem_01jc7m4k2d-confirm");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ForgetMemory {
            bot_id: "default".into(),
            id: "mem_01jc7m4k2d".into(),
        })
    );
    deliver(
        &mut rt,
        Event::MemoryChangeFailed {
            message: "Wait for active turns to finish.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("Wait for active turns to finish.")
    );
    assert!(rt.find("rd-memory-mem_01jc7m4k2d").is_some());
    click(&mut rt, "rd-memory-mem_01jc7m4k2d-confirm");
    deliver(
        &mut rt,
        Event::MemoryForgotten {
            id: "mem_01jc7m4k2d".into(),
        },
    );
    assert!(rt.find("rd-memory-mem_01jc7m4k2d").is_none());
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("Showing 2 of 2 saved memories")
    );

    // The link over the title goes back to Memory.
    click(&mut rt, "rd-memories-back");
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Memory")
    );
}

#[test]
fn a_memory_search_waits_for_typing_to_pause_and_drops_late_answers() {
    let mut rt = render_sized(scenes::settings_memories, false, (1280.0, 1500.0));
    let sent = |rt: &Runtime<Ui>| rt.state.sent.len();
    let before = sent(&rt);
    // Typing empties the list at once but sends nothing yet.
    rt.update(|ui, _| {
        ui.memories.query = TextEdit::new("plan");
        assert!(ui.watch_memory_query(10.0));
    });
    settle(&mut rt);
    assert!(rt.state.model.memories.evidence.is_none());
    assert_eq!(sent(&rt), before);
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("Loading memories…")
    );
    rt.update(|ui, _| {
        ui.memories.query = TextEdit::new("planning");
        assert!(ui.watch_memory_query(10.2));
        // Still typing 0.2 s later: the pause starts again.
        assert!(!ui.watch_memory_query(10.4));
        assert!(ui.watch_memory_query(10.5));
    });
    settle(&mut rt);
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::SearchMemory { query, .. }) if query == "planning"
    ));
    assert_eq!(sent(&rt), before + 1, "one search for the whole word");

    // The owner types on; the answer to "planning" arrives late and is dropped.
    let late = memory_ticket(&rt);
    rt.update(|ui, _| {
        ui.memories.query = TextEdit::new("planning review");
        ui.watch_memory_query(11.0);
        ui.watch_memory_query(11.3);
    });
    deliver(
        &mut rt,
        Event::MemoryRecalled {
            ticket: late,
            evidence: scenes::memory_evidence(),
        },
    );
    assert!(rt.state.model.memories.evidence.is_none());
    let ticket = memory_ticket(&rt);
    deliver(
        &mut rt,
        Event::MemoryRecalled {
            ticket,
            evidence: Vec::new(),
        },
    );
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("0 matching memories")
    );
    assert!(screen_text(&rt).contains("No matching memories"));

    // Clearing the search lists every memory again.
    click(&mut rt, "rd-memories-clear");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::BrowseMemory { after: None, .. })
    ));
}

#[test]
fn a_search_only_back_end_searches_on_request_and_cannot_change_memories() {
    let mut rt = render_sized(scenes::settings_memories_search, false, (1280.0, 1500.0));
    // Hindsight does not list memories, so nothing is asked for yet.
    assert!(
        rt.state
            .sent
            .iter()
            .all(|c| !matches!(c, Command::BrowseMemory { .. }))
    );
    assert!(screen_text(&rt).contains("Press Search or Enter to query the provider."));
    rt.update(|ui, _| {
        ui.memories.query = TextEdit::new("tea");
        ui.watch_memory_query(1.0);
        // However long the pause, a search waits for the button.
        assert!(!ui.watch_memory_query(9.0));
    });
    settle(&mut rt);
    assert!(
        rt.state
            .sent
            .iter()
            .all(|c| !matches!(c, Command::SearchMemory { .. }))
    );
    click(&mut rt, "rd-memories-search");
    let ticket = memory_ticket(&rt);
    deliver(
        &mut rt,
        Event::MemoryRecalled {
            ticket,
            evidence: scenes::memory_evidence(),
        },
    );
    assert_eq!(
        element(&rt, "rd-memories-status").text.as_deref(),
        Some("3 matching memories")
    );
    assert!(rt.find("rd-memory-mem_01jc8x2v7q-correct").is_none());
}

#[test]
fn a_memory_leads_back_to_the_conversation_it_came_from() {
    let mut rt = render_sized(scenes::settings_memories, false, (1280.0, 1500.0));
    // The first source is unfolded in the scene; the second is folded.
    assert!(rt.find("rd-memory-mem_01jc7m4k2d-session").is_none());
    click(&mut rt, "rd-memory-mem_01jc7m4k2d-source");
    click(&mut rt, "rd-memory-mem_01jc7m4k2d-session");
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::SelectSession {
            session_id: Some("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".into()),
        })
    );
}

#[test]
fn browse_memory_says_when_memory_is_off() {
    let mut rt = render(scenes::settings_memory, false);
    let mut off = scenes::memory_status(false);
    off.configuration.enabled = false;
    deliver(
        &mut rt,
        Event::Memory {
            bot_id: "default".into(),
            status: off,
        },
    );
    rt.update(|ui, _| ui.open_settings(Some(browse_page())));
    settle(&mut rt);
    assert!(screen_text(&rt).contains("Memory is off"));
    assert!(
        rt.state
            .sent
            .iter()
            .all(|c| !matches!(c, Command::BrowseMemory { .. }))
    );
}
