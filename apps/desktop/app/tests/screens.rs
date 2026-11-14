//! Headless checks of the main screens, in light and dark, through Rune's
//! `Runtime`: the same layout and input code as a window, on a virtual clock,
//! with no GPU and no network. Pixel snapshots are rendered separately with
//! `scripts/snapshots.sh` (they need a GPU); these checks run in CI.

use raphie_core::contracts::{BotProfile, ControlAction, Decision, Scope};
use raphie_core::engine::Command;
use raphie_core::model::{AuthState, Event};
use raphie_core::settings::ThemeChoice;
use raphie_desktop::sections::{BotSection, Page};
use raphie_desktop::state::{self, Filter, Screen};
use raphie_desktop::{Ui, scenes, view::view};
use rune::{ElementInfo, Env, Runtime};

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
    assert!(
        text.contains("Model connections only Research can use"),
        "{text}"
    );
    click(&mut rt, "rd-bot-page-web");
    assert_eq!(
        rt.state.opened,
        ["https://raphie.example.ts.net/?view=settings&section=providers&bot=b-research"]
    );
    // Folding a bot hides its pages without leaving the page.
    click(&mut rt, "rd-nav-bot-b-research");
    assert!(rt.find("rd-nav-b-research-providers").is_none());
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Providers")
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
    click(&mut rt, "rd-models-retry");
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
