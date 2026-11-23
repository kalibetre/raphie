//! Headless checks of the main screens, in light and dark, through Rune's
//! `Runtime`: the same layout and input code as a window, on a virtual clock,
//! with no GPU and no network. Pixel snapshots are rendered separately with
//! `scripts/snapshots.sh` (they need a GPU); these checks run in CI.

use std::sync::Arc;

use raphie_core::attachments::{TOO_MANY, Upload};
use raphie_core::auth::Secret;
use raphie_core::channels::{Channel, ChannelChange, ChannelOutcome};
use raphie_core::contracts::ApprovalMode;
use raphie_core::contracts::AskAnswer;
use raphie_core::contracts::{
    BotProfile, ControlAction, Decision, MemoryPage, MemoryProvider, ModelSelection,
    SandboxProvider, Scope, TelegramPairingCode,
};
use raphie_core::contracts::{ReplyLength, ReplyStyle, ReplyWarmth};
use raphie_core::engine::{Command, ConnectionChange, SkillSource};
use raphie_core::flavor::Flavor;
use raphie_core::inbox::Target;
use raphie_core::jobs::JobAction;
use raphie_core::mcp::{McpAction, NewMcpConnection};
use raphie_core::memory::{KeyChange, MemoryUpdate};
use raphie_core::model::{AuthState, Event, Reach, SkillOutcome};
use raphie_core::model_library::PickerFilter;
use raphie_core::sandbox::SandboxUpdate;
use raphie_core::settings::ThemeChoice;
use raphie_core::updates::{ReleaseChannel, current_version};
use raphie_desktop::sections::{BotSection, Page};
use raphie_desktop::state::{self, Filter, InboxFilter, Screen};
use raphie_desktop::{Ui, scenes, view::view};
use rune::{ElementInfo, Env, ImageCache, Key, KeyEvent, Runtime, TextEdit};

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
fn raphie_on_this_mac_is_offered_when_another_address_is_in_the_field() {
    let mut rt = render(scenes::sign_in_this_mac, false);
    let text = screen_text(&rt);
    assert!(text.contains("Raphie is running on this Mac"), "{text}");
    assert!(text.contains("http://127.0.0.1:24320"));
    // One press puts it in the field and connects.
    click(&mut rt, "rd-use-local");
    assert_eq!(rt.state.origin_field.text, "http://127.0.0.1:24320");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::Connect { origin }) if origin.as_str() == "http://127.0.0.1:24320"
    ));
    // Not offered while connecting, nor when the field already holds it.
    assert!(rt.find("rd-local-install").is_none());
    deliver(&mut rt, Event::SignedOut { notice: None });
    assert!(rt.find("rd-local-install").is_none());
    // Back on the sign-in screen, the app looks again.
    assert_eq!(rt.state.sent.last(), Some(&Command::FindLocalInstall));
    // Nothing found: nothing offered.
    rt.update(|ui, _| ui.origin_field = TextEdit::new("https://raphie.example.ts.net"));
    deliver(&mut rt, Event::LocalInstall(None));
    assert!(rt.find("rd-local-install").is_none());
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
        assert_eq!(needs_you(&rt, "default").as_deref(), Some("Needs you"));
        assert_eq!(needs_you(&rt, "b-research").as_deref(), Some("Available"));
        // What waits on the owner is pinned above the team, and opens.
        assert!(inside(&rt, "rd-requests", "rd-roster"));
        let bots = element(&rt, "rd-bots").rect;
        assert!(element(&rt, "rd-requests").rect[1] < bots[1]);
        // The name over what the bot is doing, 5 points above and below.
        let row = element(&rt, "rd-bot-default").rect;
        assert!((row[3] - 50.75).abs() < 0.5, "{row:?}");
        assert!(text.contains("I’m ready when you are."), "the empty desk");

        click(&mut rt, "rd-bot-b-research");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectBot {
                bot_id: "b-research".into()
            })
        );
    }
}

/// What a bot's row in the roster says it is doing.
fn needs_you(rt: &Runtime<Ui>, bot_id: &str) -> Option<String> {
    rt.elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(&format!("rd-bot-{bot_id}-status")))
        .and_then(|e| e.text)
}

/// True when the element keyed `key` lies inside the one keyed `outer`.
fn inside(rt: &Runtime<Ui>, key: &str, outer: &str) -> bool {
    let [x, y, w, h] = element(rt, key).rect;
    let [ox, oy, ow, oh] = element(rt, outer).rect;
    x >= ox && y >= oy && x + w <= ox + ow + 0.5 && y + h <= oy + oh + 0.5
}

#[test]
fn the_selected_bots_conversations_are_in_the_roster_under_its_bots() {
    for (size, dark) in [((1280.0, 800.0), false), ((960.0, 560.0), true)] {
        let mut rt = render_sized(scenes::conversations, dark, size);
        // No conversations panel on the right, nor a button for one.
        for gone in [
            "rd-panel",
            "rd-toggle-panel",
            "rd-panel-resize",
            "rd-results",
        ] {
            assert!(rt.find(gone).is_none(), "{gone}");
        }
        for key in [
            "rd-conversations",
            "rd-new-conversation",
            "rd-search",
            "rd-filter-all",
            "rd-session-s-1",
        ] {
            assert!(inside(&rt, key, "rd-roster"), "{key} in the roster");
        }
        // Below the bots, and labelled with the bot's name.
        let bots = element(&rt, "rd-bots").rect;
        let list = element(&rt, "rd-conversations").rect;
        assert!(list[1] >= bots[1] + bots[3], "{bots:?} {list:?}");
        assert!(screen_text(&rt).contains("With Raphie"));
        assert!(!screen_text(&rt).contains("Most recent first"));

        // A row opens its conversation; the pen starts a new one.
        // (The second row: in the smaller window the third is scrolled
        // below the list's visible part.)
        click(&mut rt, "rd-session-s-2");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession {
                session_id: Some("s-2".into())
            })
        );
        click(&mut rt, "rd-new-conversation");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession { session_id: None })
        );
        // The team's last row creates a bot.
        click(&mut rt, "rd-add-teammate");
        assert_eq!(rt.state.screen, Screen::Settings(Page::NewBot));
    }
}

#[test]
fn a_fresh_install_is_onboarded_then_asks_for_a_model() {
    for dark in [false, true] {
        let mut rt = render(scenes::onboarding, dark);
        assert!(rt.state.shows_onboarding());
        assert!(
            rt.find("rd-roster").is_none(),
            "onboarding takes the window"
        );
        let text = screen_text(&rt);
        assert!(text.contains("Welcome to raphie"), "{text}");
        assert!(text.contains("Running on this Mac"), "{text}");

        // The teammate: renamed, described and recoloured.
        click(&mut rt, "rd-onboarding-next");
        assert_eq!(rt.state.onboarding, state::Onboarding::Teammate);
        assert!(screen_text(&rt).contains("Meet your new teammate"));
        rt.update(|ui, _| {
            ui.profile.name = TextEdit::new("Juniper");
            ui.profile.description = TextEdit::new("Keeps my week on track");
        });
        click(&mut rt, "rd-onboarding-color-teal");
        click(&mut rt, "rd-onboarding-next");

        // How they work, as a new teammate is asked; leaving saves it all.
        assert_eq!(rt.state.onboarding, state::Onboarding::Work);
        assert!(screen_text(&rt).contains("How should Juniper work?"));
        click(&mut rt, "rd-teammate-preset-analyst");
        click(&mut rt, "rd-onboarding-next");
        match rt.state.sent.last() {
            Some(Command::SaveProfile { bot_id, update }) => {
                assert_eq!(bot_id, "default");
                assert_eq!(update.name, "Juniper");
                assert_eq!(update.description, "Keeps my week on track");
                assert_eq!(update.color.as_deref(), Some("#83bcb4"));
                assert_eq!(update.personality, "Be precise.");
            }
            other => panic!("expected a profile save, got {other:?}"),
        }

        // The bot asks for a model; a service opens its form in Settings.
        assert_eq!(rt.state.onboarding, state::Onboarding::Provider);
        assert!(screen_text(&rt).contains("First, I need a way to think."));
        click(&mut rt, "rd-setup-openrouter");
        assert_eq!(
            rt.state.screen,
            Screen::Settings(Page::Bot {
                bot_id: "default".into(),
                section: BotSection::Providers,
            })
        );
    }
}

#[test]
fn onboarding_can_be_skipped_and_never_shows_once_work_exists() {
    let mut rt = render(scenes::onboarding_provider, false);
    // The last step has no way back, only on: skip it, or close the flow.
    assert!(rt.find("rd-onboarding-back").is_none());
    click(&mut rt, "rd-onboarding-skip");
    assert!(!rt.state.shows_onboarding());
    // Skipped: the bot's own setup, in the workspace.
    assert!(rt.find("rd-roster").is_some() && rt.find("rd-setup").is_some());

    // A bot that can already reply never sees it.
    let rt = render(scenes::new_conversation, false);
    assert!(!rt.state.shows_onboarding());
}

#[test]
fn onboarding_asks_for_the_built_in_personalities_before_they_are_needed() {
    let mut rt = render(scenes::onboarding, false);
    rt.update(|ui, _| ui.model.personality_presets = None);
    settle(&mut rt);
    click(&mut rt, "rd-onboarding-next");
    assert!(rt.state.sent.contains(&Command::LoadPersonalityPresets));
    // Still on their way: the step says so instead of showing nothing.
    click(&mut rt, "rd-onboarding-next");
    assert_eq!(rt.state.onboarding, state::Onboarding::Work);
    assert!(rt.find("rd-teammate-presets-loading").is_some());
}

#[test]
fn a_later_teammate_without_a_model_joins_through_the_same_flow() {
    // Research has no model and nothing said yet; Raphie is set up.
    let mut rt = render(scenes::teammate_setup, false);
    assert!(rt.state.shows_onboarding());
    assert!(!rt.state.first_run());
    // No welcome: the new teammate's three steps, on the last.
    assert_eq!(rt.state.onboarding_step(), state::Onboarding::Provider);
    assert_eq!(
        element(&rt, "rd-onboarding-progress").label.as_deref(),
        Some("Step 3 of 3: A way to think")
    );
    assert!(screen_text(&rt).contains("First, I need a way to think."));
    click(&mut rt, "rd-onboarding-close");
    assert!(
        rt.find("rd-roster").is_some(),
        "closing skips to the workspace"
    );
}

#[test]
fn a_narrow_window_shows_one_column_at_a_time() {
    const PHONE: (f32, f32) = (390.0, 780.0);
    for dark in [false, true] {
        // Home is the roster, the window's whole width.
        let mut rt = render_sized(scenes::conversations, dark, PHONE);
        assert!(rt.state.narrow());
        let roster = element(&rt, "rd-roster").rect;
        assert!((roster[2] - PHONE.0).abs() < 0.5, "{roster:?}");
        assert!(rt.find("rd-main").is_none() && rt.find("rd-roster-resize").is_none());

        // A conversation takes its place, with a way back.
        click(&mut rt, "rd-session-s-2");
        assert!(!rt.state.narrow_home);
        assert!(rt.find("rd-roster").is_none() && rt.find("rd-main").is_some());
        click(&mut rt, "rd-back-home");
        assert!(rt.find("rd-roster").is_some() && rt.find("rd-main").is_none());

        // So does a new conversation, from the pen above the list.
        click(&mut rt, "rd-new-conversation");
        assert!(rt.find("rd-main").is_some() && rt.find("rd-back-home").is_some());
    }
}

#[test]
fn narrow_settings_show_the_navigation_or_a_page() {
    let mut rt = render_sized(scenes::new_conversation, false, (390.0, 780.0));
    click(&mut rt, "rd-settings");
    // The gear opens on the navigation, which closes Settings itself.
    assert!(rt.find("rd-settings-nav").is_some() && rt.find("rd-settings-main").is_none());
    click(&mut rt, "rd-nav-appearance");
    assert!(rt.find("rd-settings-nav").is_none() && rt.find("rd-settings-main").is_some());
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Appearance")
    );
    click(&mut rt, "rd-toggle-settings-nav");
    assert!(rt.find("rd-settings-nav").is_some());
    click(&mut rt, "rd-close-settings");
    assert_eq!(rt.state.screen, Screen::Workspace);
}

#[test]
fn a_wide_window_keeps_both_columns() {
    let rt = render_sized(scenes::conversations, false, (960.0, 560.0));
    assert!(!rt.state.narrow());
    assert!(rt.find("rd-roster").is_some() && rt.find("rd-main").is_some());
}

#[test]
fn a_job_on_the_empty_desk_puts_its_request_in_the_composer() {
    for dark in [false, true] {
        let mut rt = render(scenes::new_conversation, dark);
        let text = screen_text(&rt);
        for job in [
            "Send me a morning briefing",
            "Keep an eye on my inbox",
            "Research something",
            "Help me think something through",
        ] {
            assert!(text.contains(job), "{job}: {text}");
        }
        click(&mut rt, &format!("rd-job-{}", "Research something".len()));
        assert_eq!(
            rt.state.composer.text,
            "Research this for me and write up what you find: "
        );
        // Nothing is sent until the owner sends it.
        assert!(
            !rt.state
                .sent
                .iter()
                .any(|c| matches!(c, Command::Send { .. }))
        );
    }
}

#[test]
fn a_bot_without_a_model_asks_for_one_instead_of_a_chat() {
    for dark in [false, true] {
        let mut rt = render(scenes::bot_setup, dark);
        let text = screen_text(&rt);
        assert!(text.contains("First, I need a way to think."), "{text}");
        assert!(rt.find("rd-setup").is_some());
        assert_eq!(needs_you(&rt, "b-research").as_deref(), Some("Needs setup"));
        // No empty chat, and no composer or model picker to type into.
        assert!(rt.find("rd-empty").is_none());
        assert!(rt.find("rd-composer").is_none());
        // Choosing a provider opens its form on the bot's Providers page.
        click(&mut rt, "rd-setup-openrouter");
        assert_eq!(
            rt.state.screen,
            Screen::Settings(Page::Bot {
                bot_id: "b-research".into(),
                section: BotSection::Providers,
            })
        );
        assert_eq!(rt.state.providers.provider, "openrouter");
        assert!(rt.state.providers.open.is_some());
    }
    // A bot that has models keeps its chat.
    let rt = render(scenes::new_conversation, false);
    assert!(rt.find("rd-setup").is_none() && rt.find("rd-composer").is_some());
}

#[test]
fn the_bots_take_at_most_two_fifths_of_the_window_and_scroll() {
    let mut rt = render_sized(scenes::conversations, false, (960.0, 560.0));
    rt.update(|ui, _| {
        let research = ui.model.bots[1].clone();
        for n in 0..12 {
            let mut bot = research.clone();
            bot.id = format!("b-more-{n}");
            bot.name = format!("Helper {n}");
            ui.model.bots.push(bot);
        }
    });
    settle(&mut rt);
    let bots = element(&rt, "rd-bots").rect;
    assert!(bots[3] <= 224.0 + 0.5, "{bots:?}");
    assert!(bots[3] > 200.0, "the bots use their share: {bots:?}");
    // The conversations keep the rest, rows and all.
    assert!(element(&rt, "rd-conversations").rect[3] > 150.0);
    assert!(inside(&rt, "rd-session-s-1", "rd-roster"));
}

#[test]
fn the_roster_opens_and_closes_with_its_conversations() {
    let mut rt = render(scenes::new_conversation, false);
    assert!(rt.find("rd-conversations").is_some());
    click(&mut rt, "rd-toggle-roster");
    assert!(rt.find("rd-roster").is_none());
    assert!(rt.find("rd-conversations").is_none());
    click(&mut rt, "rd-toggle-roster");
    assert!(rt.find("rd-roster").is_some());
}

#[test]
fn the_sidebar_lists_searches_and_filters_sessions() {
    for dark in [false, true] {
        let mut rt = render(scenes::new_conversation, dark);
        for id in ["s-1", "s-2", "s-3"] {
            assert!(rt.find(&format!("rd-session-{id}")).is_some(), "row {id}");
        }

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
        click(&mut rt, "rd-search-clear");
        assert!(rt.find("rd-session-s-1").is_some());

        click(&mut rt, "rd-session-s-2");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession {
                session_id: Some("s-2".into())
            })
        );
        // The title bar's own button starts one too.
        click(&mut rt, "rd-new");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession { session_id: None })
        );
    }
}

#[test]
fn the_sidebar_has_no_archived_or_new_replies_filter() {
    let rt = render(scenes::new_conversation, false);
    assert!(rt.find("rd-filter-archived").is_none());
    assert!(rt.find("rd-filter-new").is_none());
    assert!(rt.find("rd-filter-approvals").is_some());
}

#[test]
fn settings_archived_fetches_searches_opens_and_unarchives() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversation, dark);
        // Its page is listed under the bot, last.
        rt.update(|ui, _| ui.open_settings(None));
        settle(&mut rt);
        assert!(screen_text(&rt).contains("Archived"));
        // Opening the page fetches the bot's archived conversations.
        rt.update(|ui, _| {
            ui.open_settings(Some(Page::Bot {
                bot_id: "default".into(),
                section: BotSection::Archived,
            }));
        });
        settle(&mut rt);
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::LoadArchived {
                bot_id: "default".into()
            })
        );
        assert!(screen_text(&rt).contains("Loading archived conversations…"));

        let mut rt = render(scenes::settings_archived, dark);
        for id in ["s-4", "s-5"] {
            assert!(rt.find(&format!("rd-archived-{id}")).is_some(), "row {id}");
        }
        assert!(screen_text(&rt).contains("2 conversations · Most recent first"));

        // Search matches titles, whatever the case.
        click(&mut rt, "rd-archived-search");
        rt.paste("GIFT");
        settle(&mut rt);
        assert!(rt.find("rd-archived-s-5").is_some() && rt.find("rd-archived-s-4").is_none());
        assert!(screen_text(&rt).contains("1 conversation matching “GIFT”"));

        // Its button brings it back.
        let restore = element(&rt, "rd-archived-s-5-restore");
        assert_eq!(
            restore.label.as_deref(),
            Some("Unarchive Birthday gift ideas")
        );
        click(&mut rt, "rd-archived-s-5-restore");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Archive {
                bot_id: "default".into(),
                session_id: "s-5".into(),
                archived: false
            })
        );

        // Pressing the row leaves Settings for the conversation.
        click(&mut rt, "rd-archived-s-5");
        assert_eq!(rt.state.screen, Screen::Workspace);
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SelectSession {
                session_id: Some("s-5".into())
            })
        );

        let rt = render(scenes::settings_archived_empty, dark);
        assert!(screen_text(&rt).contains("No archived conversations."));
    }
}

#[test]
fn a_rows_button_archives_its_conversation() {
    let mut rt = render(scenes::new_conversation, false);
    let button = element(&rt, "rd-session-s-3-archive");
    assert_eq!(button.label.as_deref(), Some("Archive Tea preferences"));
    // Over the row's top-right corner, where its time is.
    let row = element(&rt, "rd-session-s-3").rect;
    let [x, y, w, h] = button.rect;
    assert!(
        x + w <= row[0] + row[2] && x > row[0] + row[2] / 2.0,
        "{row:?}"
    );
    assert!(
        y >= row[1] && y + h <= row[1] + row[3] / 2.0 + 4.0,
        "{row:?}"
    );
    let sent = rt.state.sent.len();
    click(&mut rt, "rd-session-s-3-archive");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Archive {
            bot_id: "default".into(),
            session_id: "s-3".into(),
            archived: true
        })
    );
    // The press archives only: it does not open the conversation.
    assert_eq!(rt.state.sent.len(), sent + 1);
}

#[test]
fn the_title_bar_archives_and_unarchives_the_open_conversation() {
    for dark in [false, true] {
        // A new conversation has nothing to archive.
        let rt = render(scenes::new_conversation, dark);
        assert!(rt.find("rd-archive").is_none());

        let mut rt = render(scenes::conversation, dark);
        assert_eq!(
            element(&rt, "rd-archive").label.as_deref(),
            Some("Archive conversation")
        );
        assert!(rt.find("rd-title-archived").is_none());
        click(&mut rt, "rd-archive");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Archive {
                bot_id: "default".into(),
                session_id: "s-1".into(),
                archived: true
            })
        );

        // Archived, it stays open, out of the list, and the same button
        // brings it back.
        let mut rt = render(scenes::conversation_archived, dark);
        assert_eq!(
            element(&rt, "rd-archive").label.as_deref(),
            Some("Unarchive conversation")
        );
        assert!(rt.find("rd-session-s-1").is_none());
        // Marked beside its title, as on the web.
        assert!(rt.find("rd-title-archived").is_some());
        assert_eq!(rt.state.attention_in("default"), 1, "only the approval");
        click(&mut rt, "rd-archive");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Archive {
                bot_id: "default".into(),
                session_id: "s-1".into(),
                archived: false
            })
        );
        rt.update(|ui, _| {
            ui.model.apply(Event::Archived {
                bot_id: "default".into(),
                session_id: "s-1".into(),
                archived_at: None,
            });
        });
        settle(&mut rt);
        assert_eq!(
            element(&rt, "rd-archive").label.as_deref(),
            Some("Archive conversation")
        );
    }
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

    // In a task another bot handed off, each call needs its own approval.
    let rt = render(
        |ui| {
            scenes::command_approval(ui);
            let conversation = ui.model.conversation.as_mut().unwrap();
            let observation = conversation.observation.as_mut().unwrap();
            observation.tool_approvals[0].each_call = true;
        },
        false,
    );
    assert!(rt.find(&format!("rd-approve-session-{id}")).is_none());
    assert!(rt.find(&format!("rd-approve-{id}")).is_some());
}

#[test]
fn finished_replies_show_their_tools_time_and_cost() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversation, dark);
        let text = screen_text(&rt);
        // Each reply is signed; its tokens and cost are on hover, not drawn.
        assert!(rt.find("rd-meta-t2").is_some());
        assert!(!text.contains("tokens"), "{text}");
        // What the bot did, in its words, under the reply.
        assert!(text.contains("Used read_file, used docs"), "{text}");
        let reply = element(&rt, "rd-reply-t2").rect;
        let toggle = element(&rt, "rd-steps-toggle-t2").rect;
        assert!(toggle[1] > reply[1], "the steps are inside the reply");
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
fn a_finished_reply_shows_no_step_as_running() {
    // The second call's end is missing from the journal, as when a nested
    // call leaves with its caller.
    for dark in [false, true] {
        let rt = render(scenes::tools_unfinished, dark);
        let text = screen_text(&rt);
        assert!(text.contains("finished"), "{text}");
        assert!(!text.contains("running"), "{text}");
    }
}

#[test]
fn a_failed_reply_says_why_once() {
    for dark in [false, true] {
        let rt = render(scenes::reply_failed, dark);
        let text = screen_text(&rt);
        assert!(
            text.contains("I couldn’t finish this reply. The model returned an error."),
            "{text}"
        );
        // Said under the message only, not again at the end.
        assert_eq!(text.matches("couldn’t finish").count(), 1, "{text}");
        // The provider's own words are folded under Details.
        assert!(!text.contains("429 Too Many Requests"), "{text}");
        let mut rt = rt;
        click(&mut rt, "rd-failed-more-t2");
        assert!(screen_text(&rt).contains("429 Too Many Requests"));
        let line = element(&rt, "rd-failed-t2").rect;
        let detail = element(&rt, "rd-failed-detail-t2").rect;
        assert!(detail[1] >= line[1] + line[3], "the detail sits below");
    }
}

#[test]
fn failed_runs_of_a_scheduled_job_in_a_row_read_as_one() {
    for dark in [false, true] {
        let rt = render(scenes::scheduled_failures, dark);
        let text = screen_text(&rt);
        assert!(
            text.contains("I couldn’t run Daily calendar briefing, after 3 tries."),
            "{text}"
        );
        assert_eq!(text.matches("didn’t run").count(), 1, "{text}");
        assert!(text.contains("3 attempts"), "{text}");
        // The latest failure says it; the earlier two are not drawn.
        assert!(rt.find("rd-scheduled-failure-t4").is_some());
        assert!(rt.find("rd-scheduled-failure-t2").is_none());
        assert!(rt.find("rd-turn-t3").is_none());
        // The run that worked keeps its marker and reply.
        assert!(rt.find("rd-turn-t1").is_some() && rt.find("rd-reply-t1").is_some());
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

        // Account, with sign-out, is a settings page; the roster has no
        // account buttons of its own.
        assert!(rt.find("rd-account-settings").is_none() && rt.find("rd-sign-out").is_none());
        click(&mut rt, "rd-settings");
        click(&mut rt, "rd-nav-account");
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
fn account_warns_when_raphie_stops_answering_and_offers_another_address() {
    let has =
        |rt: &Runtime<Ui>, key: &str| rt.elements().iter().any(|e| e.key.as_deref() == Some(key));
    // While Raphie answers: no warning, and the address can still change.
    let rt = render(scenes::settings_account, false);
    assert!(!has(&rt, "rd-account-unreachable"));
    assert!(screen_text(&rt).contains("· Connected"));
    assert!(has(&rt, "rd-account-change-address"));

    let mut rt = render(scenes::settings_account_runtime_down, false);
    assert!(has(&rt, "rd-account-unreachable"));
    let text = screen_text(&rt);
    assert!(text.contains("Raphie is not running"));
    assert!(text.contains("· Not answering"));
    // Trying again asks once, and says so until the answer comes.
    click(&mut rt, "rd-account-check");
    assert_eq!(rt.state.sent.last(), Some(&Command::CheckReach));
    assert!(screen_text(&rt).contains("Checking…"));
    let sent = rt.state.sent.len();
    click(&mut rt, "rd-account-check");
    assert_eq!(rt.state.sent.len(), sent);

    let mut rt = render(scenes::settings_account_unreachable, false);
    assert!(screen_text(&rt).contains("Can't reach Raphie"));
    click(&mut rt, "rd-account-change-address");
    assert_eq!(rt.state.sent.last(), Some(&Command::ChangeAddress));
    assert_eq!(rt.state.screen, Screen::Workspace);

    // The roster's status says so too, instead of where Raphie runs.
    let status = |rt: &Runtime<Ui>| element(rt, "rd-stream-status").text.unwrap_or_default();
    let mut rt = render(scenes::conversations, false);
    assert_eq!(status(&rt), "raphie.example.ts.net");
    rt.update(|ui, _| {
        ui.model.apply(Event::Reach(Reach::Unreachable(
            "error sending request".into(),
        )));
    });
    settle(&mut rt);
    assert_eq!(status(&rt), "Not answering");
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

#[test]
fn only_the_dev_build_says_dev_beside_the_brand() {
    let has_badge = |rt: &Runtime<Ui>| {
        rt.elements()
            .iter()
            .any(|e| e.key.as_deref() == Some("rd-dev-badge"))
    };
    let mut rt = render(scenes::dev_build, false);
    assert!(has_badge(&rt));
    rt.update(|ui, _| ui.flavor = Flavor::Release);
    settle(&mut rt);
    assert!(!has_badge(&rt));
    // The sign-in screen too.
    let mut rt = render(scenes::sign_in, false);
    rt.update(|ui, _| ui.flavor = Flavor::Dev);
    settle(&mut rt);
    assert!(has_badge(&rt));
}

#[test]
fn a_nightly_says_nightly_beside_the_brand_and_on_about() {
    let has =
        |rt: &Runtime<Ui>, key: &str| rt.elements().iter().any(|e| e.key.as_deref() == Some(key));
    let mut rt = render(scenes::nightly_build, false);
    assert!(has(&rt, "rd-nightly-badge"));
    assert!(screen_text(&rt).contains("NIGHTLY"));
    // A stable release says nothing; a dev build says DEV, not NIGHTLY.
    rt.update(|ui, _| ui.release_channel = ReleaseChannel::Stable);
    settle(&mut rt);
    assert!(!has(&rt, "rd-nightly-badge") && !has(&rt, "rd-dev-badge"));
    rt.update(|ui, _| {
        ui.release_channel = ReleaseChannel::Nightly;
        ui.flavor = Flavor::Dev;
    });
    settle(&mut rt);
    assert!(has(&rt, "rd-dev-badge") && !has(&rt, "rd-nightly-badge"));
    // The badge sits after macOS's window buttons, which end about 76
    // points in, and stays inside the roster at any width.
    rt.set_titlebar_inset(76.0);
    let inside = |rt: &Runtime<Ui>, key: &str| {
        let [x, _, w, _] = element(rt, key).rect;
        let [rx, _, rw, _] = element(rt, "rd-roster").rect;
        x + w <= rx + rw - 12.0
    };
    for flavor in [Flavor::Release, Flavor::Dev] {
        let (key, word) = if flavor.is_dev() {
            ("rd-dev-badge", "DEV")
        } else {
            ("rd-nightly-badge", "NIGHTLY")
        };
        rt.update(|ui, _| {
            ui.flavor = flavor;
            ui.roster_width = 300.0;
        });
        settle(&mut rt);
        assert!(
            inside(&rt, key) && screen_text(&rt).contains(word),
            "{word} in full"
        );
        // The badge has the band beside the window's buttons to itself, so
        // even the narrowest roster keeps its word.
        rt.update(|ui, _| ui.roster_width = state::ROSTER_MIN);
        settle(&mut rt);
        assert!(inside(&rt, key), "{word} stays inside the narrowest roster");
        assert!(screen_text(&rt).contains(word));
    }
    rt.update(|ui, _| {
        ui.flavor = Flavor::Release;
        ui.roster_width = state::ROSTER_WIDTH;
    });
    settle(&mut rt);

    // The sign-in screen too.
    let mut rt = render(scenes::sign_in, false);
    rt.update(|ui, _| {
        ui.flavor = Flavor::Release;
        ui.release_channel = ReleaseChannel::Nightly;
    });
    settle(&mut rt);
    assert!(has(&rt, "rd-nightly-badge"));

    // About names the channel.
    let channel = |rt: &Runtime<Ui>| element(rt, "rd-release-channel").text.unwrap_or_default();
    let mut rt = render(scenes::settings_about_nightly, false);
    assert_eq!(channel(&rt), "Nightly");
    assert!(screen_text(&rt).contains("Built from the latest main."));
    rt.update(|ui, _| ui.release_channel = ReleaseChannel::Stable);
    settle(&mut rt);
    assert_eq!(channel(&rt), "Stable");
    rt.update(|ui, _| ui.flavor = Flavor::Dev);
    settle(&mut rt);
    assert_eq!(channel(&rt), "Dev build");
}

#[test]
fn about_shows_the_version_and_checks_for_updates() {
    // About has its own page in the navigation.
    let mut rt = render(scenes::settings_appearance, false);
    assert!(!screen_text(&rt).contains("Raphie Desktop version"));
    click(&mut rt, "rd-nav-about");
    assert_eq!(rt.state.screen, Screen::Settings(Page::About));
    let text = screen_text(&rt);
    assert!(text.contains(current_version()), "{text}");
    assert!(text.contains("Not checked yet."), "{text}");
    // Until the signed-in Raphie says which release it runs.
    let host = |rt: &Runtime<Ui>| element(rt, "rd-host-version").text.unwrap_or_default();
    assert_eq!(host(&rt), "Unknown");
    deliver(&mut rt, Event::HostVersion("v0.0.5".into()));
    assert_eq!(host(&rt), "0.0.5");
    deliver(&mut rt, Event::HostVersion("development".into()));
    assert_eq!(host(&rt), "Development");

    click(&mut rt, "rd-check-updates");
    assert_eq!(rt.state.sent, vec![Command::CheckForUpdates]);
    assert!(screen_text(&rt).contains("Checking GitHub"));
    // While a check runs, a second press asks nothing more.
    rt.update(|ui, _| ui.check_for_updates());
    assert_eq!(rt.state.sent.len(), 1);

    deliver(&mut rt, Event::UpdateChecked(Ok(None)));
    assert!(screen_text(&rt).contains("This is the newest release."));
    deliver(
        &mut rt,
        Event::UpdateChecked(Err("Could not reach GitHub.".into())),
    );
    assert!(screen_text(&rt).contains("Could not check: Could not reach GitHub."));
}

#[test]
fn a_newer_release_opens_its_page() {
    let mut rt = render(scenes::settings_about_update, false);
    assert!(screen_text(&rt).contains("Raphie v0.0.5 is available."));
    click(&mut rt, "rd-view-release");
    assert_eq!(
        rt.state.opened,
        vec!["https://github.com/kalibetre/raphie/releases/tag/v0.0.5".to_owned()]
    );
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
        rules: Vec::new(),
        id: "b-research".into(),
        name: "Research".into(),
        description: description.into(),
        color: None,
        personality: "Be brief.".into(),
        reply_style: Default::default(),
        self_updates: None,
        changed_by: None,
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
fn revision_history_lists_saved_versions_and_unfolds_them() {
    let mut rt = render_sized(research_profile, false, (1280.0, 2100.0));
    click(&mut rt, "rd-profile-history");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadBotHistory {
            bot_id: "b-research".into()
        })
    );
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Revision history")
    );
    assert!(screen_text(&rt).contains("Loading revisions…"));
    deliver(
        &mut rt,
        Event::BotHistory {
            bot_id: "b-research".into(),
            items: scenes::bot_revisions(),
        },
    );
    // The current revision is marked and starts unfolded; older ones fold.
    let text = screen_text(&rt);
    assert!(text.contains("Current"));
    assert!(text.contains("Prefer the primary source"));
    assert!(text.contains("Research · Reads and summarises. · Color: Automatic"));
    assert!(rt.find("rd-revision-2-personality").is_none());
    click(&mut rt, "rd-revision-2");
    let text = screen_text(&rt);
    assert!(text.contains("Research · Reads papers · Color: #83bcb4"));
    click(&mut rt, "rd-revision-3");
    assert!(rt.find("rd-revision-3-personality").is_none());

    // The link over the title goes back to Profile, where the nav stayed.
    click(&mut rt, "rd-history-back");
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Profile")
    );
}

#[test]
fn a_teammate_is_added_through_a_flow_not_a_settings_page() {
    let mut rt = render(scenes::conversations, false);
    click(&mut rt, "rd-add-teammate");
    assert_eq!(rt.state.screen, Screen::Settings(Page::NewBot));
    assert!(
        rt.find("rd-settings-nav").is_none(),
        "the flow takes the window"
    );
    assert!(screen_text(&rt).contains("Meet your new teammate"));
    // A colour no teammate wears yet is chosen for them.
    assert!(rt.state.profile.color.is_some());

    // A name first.
    click(&mut rt, "rd-add-next");
    assert!(!rt.state.adding_work, "a teammate needs a name");
    rt.update(|ui, _| {
        ui.profile.name = TextEdit::new(" Travel ");
        ui.profile.description = TextEdit::new("Plans trips");
    });
    settle(&mut rt);
    click(&mut rt, "rd-add-next");
    assert!(rt.state.adding_work);
    assert!(screen_text(&rt).contains("How should Travel work?"));

    // Adding sends the bot; it may change its personality, not you.
    click(&mut rt, "rd-add-create");
    let Some(Command::CreateBot { bot }) = rt.state.sent.last() else {
        panic!("the bot is sent");
    };
    assert_eq!(
        (bot.name.as_str(), bot.description.as_str()),
        ("Travel", "Plans trips")
    );
    assert_eq!(
        bot.self_updates,
        Some(raphie_core::contracts::SelfUpdates::NEW_BOT)
    );
    assert!(screen_text(&rt).contains("Adding…"));

    // A refusal keeps the flow; success opens the new teammate.
    deliver(
        &mut rt,
        Event::BotCreateFailed {
            message: "A bot with this name already exists.".into(),
        },
    );
    assert!(screen_text(&rt).contains("A bot with this name already exists."));
    assert_eq!(rt.state.screen, Screen::Settings(Page::NewBot));
    click(&mut rt, "rd-add-create");
    let mut created = research("Plans trips", 1);
    created.id = "b-travel".into();
    created.name = "Travel".into();
    deliver(&mut rt, Event::BotCreated(created));
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert!(rt.state.sent.contains(&Command::SelectBot {
        bot_id: "b-travel".into()
    }));

    // Closing leaves without adding and drops the draft.
    click(&mut rt, "rd-add-teammate");
    rt.update(|ui, _| ui.profile.name = TextEdit::new("Scratch"));
    settle(&mut rt);
    click(&mut rt, "rd-add-close");
    assert_eq!(rt.state.screen, Screen::Workspace);
    click(&mut rt, "rd-add-teammate");
    assert!(rt.state.profile.name.text.is_empty());

    // Settings no longer creates bots.
    click(&mut rt, "rd-add-close");
    click(&mut rt, "rd-settings");
    assert!(rt.find("rd-nav-new-bot").is_none());
}

#[test]
fn a_bot_is_deleted_only_after_its_name_is_typed() {
    // The default bot cannot be deleted, so it is not offered.
    let rt = render_sized(scenes::settings_profile, false, (1280.0, 1700.0));
    assert!(rt.find("rd-delete-bot").is_none());

    let mut rt = render_sized(research_profile, false, (1280.0, 2100.0));
    // Unsaved edits block it: the confirmation must name the saved bot.
    rt.update(|ui, _| ui.profile.description = TextEdit::new("Edited"));
    settle(&mut rt);
    click(&mut rt, "rd-delete-bot-open");
    assert!(rt.find("rd-delete-bot-form").is_none());
    rt.update(|ui, _| ui.discard_profile());
    settle(&mut rt);

    click(&mut rt, "rd-delete-bot-open");
    assert!(rt.find("rd-delete-bot-form").is_some());
    assert!(screen_text(&rt).contains("Delete Research?"));
    // Anything but the exact name leaves the button dead.
    let before = rt.state.sent.len();
    for wrong in ["", "research", "Research "] {
        rt.update(|ui, _| ui.delete_confirmation = TextEdit::new(wrong));
        settle(&mut rt);
        click(&mut rt, "rd-delete-bot-confirm");
        assert_eq!(rt.state.sent.len(), before, "{wrong:?}");
    }
    rt.update(|ui, _| ui.delete_confirmation = TextEdit::new("Research"));
    settle(&mut rt);
    click(&mut rt, "rd-delete-bot-confirm");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::DeleteBot {
            bot_id: "b-research".into(),
            name: "Research".into(),
            revision: 3,
        })
    );
    // While it is on its way the dialog cannot be dismissed.
    click(&mut rt, "rd-delete-bot-cancel");
    assert!(rt.find("rd-delete-bot-form").is_some());

    // A refusal is shown in the dialog and deletes nothing.
    deliver(
        &mut rt,
        Event::BotDeleteFailed {
            message: "This bot changed. Reload and try again.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-delete-bot-error").text.as_deref(),
        Some("This bot changed. Reload and try again.")
    );
    assert!(rt.state.model.bots.iter().any(|bot| bot.id == "b-research"));

    // Once deleted, its pages close and the default bot is selected.
    rt.update(|ui, _| ui.select_bot("b-research"));
    click(&mut rt, "rd-delete-bot-confirm");
    deliver(
        &mut rt,
        Event::BotDeleted {
            bot_id: "b-research".into(),
        },
    );
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert!(rt.state.model.bots.iter().all(|bot| bot.id != "b-research"));
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("default"));
    assert!(rt.state.delete_confirmation.text.is_empty());
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
        assert_eq!(update.personality, "Be brief.");
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
fn diagnostics_is_an_app_page_and_folding_a_bot_keeps_the_page() {
    let mut rt = render(scenes::settings_account, false);
    // Diagnostics is listed with Account and Appearance, not under a bot.
    assert!(rt.find("rd-nav-default-telemetry").is_none());
    click(&mut rt, "rd-nav-diagnostics");
    assert_eq!(rt.state.screen, Screen::Settings(Page::Diagnostics));
    let text = screen_text(&rt);
    assert!(text.contains("App-wide"), "{text}");
    assert!(rt.find("rd-telemetry").is_some());
    assert!(rt.state.opened.is_empty(), "every page is in the app now");

    // Folding a bot hides its pages without leaving the page.
    rt.update(|ui, _| {
        ui.open_settings(Some(Page::Bot {
            bot_id: "b-research".into(),
            section: BotSection::Activity,
        }));
    });
    settle(&mut rt);
    assert!(rt.find("rd-nav-b-research-activity").is_some());
    click(&mut rt, "rd-nav-bot-b-research");
    assert!(rt.find("rd-nav-b-research-activity").is_none());
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Activity")
    );
}

#[test]
fn traces_load_filter_unfold_and_switch_window() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 1800.0));
    click(&mut rt, "rd-nav-diagnostics");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadTraces {
            bot_id: "default".into(),
            hours: 1,
        })
    );
    assert_eq!(
        element(&rt, "rd-traces-empty-title").text.as_deref(),
        Some("Loading traces…")
    );
    deliver(
        &mut rt,
        Event::Traces {
            bot_id: "default".into(),
            hours: 1,
            data: Box::new(scenes::trace_diagnostics(false)),
        },
    );
    assert_eq!(
        element(&rt, "rd-traces-count").text.as_deref(),
        Some("3 spans · OTLP")
    );
    let text = screen_text(&rt);
    for expected in [
        "Latest 500 spans",
        // Each span says whose it is, by the bot's name.
        "Research · Error · 804.0 ms",
        "Raphie · 3120.4 ms",
        "Trace export is disabled. Showing retained traces only.",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }

    // A row unfolds into its facts and attributes.
    let failed = "rd-span-4bf92f3577b34da6a3ce929d0e0e4736:c7ad6b7169203331";
    assert!(rt.find(&format!("{failed}-detail")).is_none());
    click(&mut rt, failed);
    let text = screen_text(&rt);
    for expected in [
        "00f067aa0ba902b7",
        "\"execution.outcome\": \"timeout\"",
        "Started",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    click(&mut rt, failed);
    assert!(rt.find(&format!("{failed}-detail")).is_none());

    // The filter looks in names, ids, status and attributes.
    rt.update(|ui, _| ui.spans.filter = TextEdit::new("claude"));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-traces-count").text.as_deref(),
        Some("1 spans · OTLP")
    );
    // A bot's name finds its spans.
    rt.update(|ui, _| ui.spans.filter = TextEdit::new("research"));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-traces-count").text.as_deref(),
        Some("1 spans · OTLP")
    );
    rt.update(|ui, _| ui.spans.filter = TextEdit::new("nothing like this"));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-traces-empty-title").text.as_deref(),
        Some("No matching spans")
    );

    // Another window empties the list and asks for it; a late answer for
    // the old window is dropped.
    click(&mut rt, "rd-traces-24h");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadTraces {
            bot_id: "default".into(),
            hours: 24,
        })
    );
    deliver(
        &mut rt,
        Event::Traces {
            bot_id: "default".into(),
            hours: 1,
            data: Box::new(scenes::trace_diagnostics(true)),
        },
    );
    assert!(rt.state.model.traces.data.is_none());
    // A backend that does not answer says so.
    deliver(
        &mut rt,
        Event::TracesFailed {
            bot_id: "default".into(),
            hours: 24,
        },
    );
    assert_eq!(
        element(&rt, "rd-traces-empty-title").text.as_deref(),
        Some("Trace backend unavailable")
    );
}

#[test]
fn the_telemetry_switch_and_exports_go_through_the_engine() {
    let mut rt = render_sized(scenes::settings_diagnostics, false, (1280.0, 1800.0));
    assert_eq!(
        element(&rt, "rd-telemetry-state").text.as_deref(),
        Some("Trace collection is on.")
    );
    click(&mut rt, "rd-telemetry");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::SetTelemetry {
            bot_id: "default".into(),
            enabled: false,
        })
    );
    // One change at a time.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-telemetry");
    assert_eq!(rt.state.sent.len(), before);
    deliver(
        &mut rt,
        Event::TelemetryFailed {
            message: "Wait for active turns to finish.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-telemetry-state").text.as_deref(),
        Some("Wait for active turns to finish.")
    );
    let mut off = scenes::model_settings();
    off.telemetry_enabled = false;
    click(&mut rt, "rd-telemetry");
    deliver(
        &mut rt,
        Event::TelemetrySet {
            bot_id: "default".into(),
            settings: Box::new(off),
        },
    );
    assert_eq!(
        element(&rt, "rd-telemetry-state").text.as_deref(),
        Some("Trace collection is off.")
    );

    // The export is the runtime's JSON, written by the engine.
    click(&mut rt, "rd-traces-export");
    let Some(Command::SaveExport { name, contents }) = rt.state.sent.last() else {
        panic!("an export is sent");
    };
    assert!(name.starts_with("raphie-traces-") && name.ends_with(".json"));
    let exported: serde_json::Value = serde_json::from_str(contents).expect("the export is JSON");
    assert_eq!(exported["spanLimit"], 500);
    assert_eq!(exported["spans"][2]["status"], "error");
    assert_eq!(
        exported["spans"][0]["traceId"],
        "4bf92f3577b34da6a3ce929d0e0e4736"
    );
    deliver(
        &mut rt,
        Event::ExportSaved {
            saved_as: "raphie-traces-1.json".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-export-saved").text.as_deref(),
        Some("Saved to your Downloads folder as raphie-traces-1.json.")
    );

    // While the page shows it asks again every few seconds.
    let loads = |rt: &Runtime<Ui>| {
        let sent = rt.state.sent.iter();
        sent.filter(|c| matches!(c, Command::LoadTraces { .. }))
            .count()
    };
    let before = loads(&rt);
    rt.update(|ui, _| {
        assert!(ui.refresh_inspection(100.0));
        ui.refresh_inspection(102.0);
        ui.open_settings(Some(Page::Account));
        assert!(!ui.refresh_inspection(200.0));
    });
    assert_eq!(loads(&rt), before + 1);
}

#[test]
fn activity_lists_events_newest_first_and_filters_and_exports_them() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 1600.0));
    click(&mut rt, "rd-nav-default-activity");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadBotActivity {
            bot_id: "default".into()
        })
    );
    assert_eq!(
        element(&rt, "rd-activity-status").text.as_deref(),
        Some("Loading activity…")
    );
    deliver(
        &mut rt,
        Event::BotActivityFailed {
            bot_id: "default".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-activity-status").text.as_deref(),
        Some("Couldn’t load activity. It will retry automatically.")
    );
    deliver(
        &mut rt,
        Event::BotActivity {
            bot_id: "default".into(),
            items: scenes::bot_events(),
        },
    );
    assert_eq!(
        element(&rt, "rd-activity-count").text.as_deref(),
        Some("4 events")
    );
    // Newest first: the last event the runtime listed is the first row.
    let text = screen_text(&rt);
    let newest = text.find("model completed").expect("the newest event");
    let oldest = text.find("model started").expect("the oldest event");
    assert!(newest < oldest, "newest first");

    click(&mut rt, "rd-event-4103");
    let text = screen_text(&rt);
    for expected in [
        "tool.failed",
        "call-88",
        "att-7c1",
        "\"error\": \"timeout\"",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    rt.update(|ui, _| ui.events.filter = TextEdit::new("CALENDAR"));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-activity-count").text.as_deref(),
        Some("2 events")
    );
    rt.update(|ui, _| ui.events.filter = TextEdit::new("zzz"));
    settle(&mut rt);
    assert!(screen_text(&rt).contains("No matching events."));

    // The export carries every event, not only the filtered ones.
    click(&mut rt, "rd-activity-export");
    let Some(Command::SaveExport { name, contents }) = rt.state.sent.last() else {
        panic!("an export is sent");
    };
    assert!(name.starts_with("raphie-activity-"));
    let exported: serde_json::Value = serde_json::from_str(contents).expect("the export is JSON");
    assert_eq!(exported["events"].as_array().map(Vec::len), Some(4));
    assert_eq!(exported["events"][1]["type"], "tool.started");
    assert!(
        exported["exportedAt"]
            .as_str()
            .is_some_and(|at| at.ends_with('Z'))
    );
    deliver(
        &mut rt,
        Event::ExportFailed {
            message: "This machine has no Downloads folder to save to.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-export-error").text.as_deref(),
        Some("This machine has no Downloads folder to save to.")
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
            text: "Thanks!".into(),
            attachments: Vec::new(),
            model: None,
            approval_mode: None,
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

#[test]
fn the_sandbox_page_loads_and_describes_the_active_provider() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 2000.0));
    click(&mut rt, "rd-nav-default-sandbox");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadSandbox {
            bot_id: "default".into()
        })
    );
    assert!(screen_text(&rt).contains("Loading sandbox details…"));
    deliver(
        &mut rt,
        Event::Sandbox {
            bot_id: "default".into(),
            info: Box::new(scenes::sandbox_info(false)),
        },
    );
    let text = screen_text(&rt);
    for expected in [
        "Active · Version 2.9.0 · Shell commands over a virtual filesystem",
        "Checkpoint policy",
        "1 running or waiting · 8 admitted operations per bot · 4 simultaneous workers across the runtime",
        "120 seconds, including worker startup",
        "64.0 KiB command source · 1.0 MiB output",
        "18.0 MiB used of 100.0 MiB · 1,284 of 10,000 checkpoint entries",
        "403.0 KiB used of 10.0 MiB.",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    // just-bash needs no acknowledgement, and a clean form has no save bar.
    assert!(rt.find("rd-sandbox-acknowledge").is_none());
    assert!(rt.find("rd-save-bar").is_none());

    // A failed refresh keeps the details and says they may be stale.
    deliver(
        &mut rt,
        Event::SandboxFailed {
            bot_id: "default".into(),
            message: "offline".into(),
        },
    );
    assert!(rt.find("rd-sandbox-stale").is_some());
    assert!(screen_text(&rt).contains("Checkpoint policy"));

    // "Browse files" goes to the bot's Workspace page.
    click(&mut rt, "rd-sandbox-browse");
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Workspace")
    );
}

#[test]
fn a_container_needs_the_acknowledgement_before_it_can_be_saved() {
    let mut rt = render_sized(scenes::settings_sandbox, false, (1280.0, 2000.0));
    rt.update(|ui, _| ui.sandbox.provider = SandboxProvider::Container);
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-sandbox-error").text.as_deref(),
        Some("Acknowledge host and local network access to use Container.")
    );
    let before = rt.state.sent.len();
    click(&mut rt, "rd-sandbox-save");
    assert_eq!(rt.state.sent.len(), before, "nothing is sent yet");

    click(&mut rt, "rd-sandbox-acknowledge");
    // A bad number is named too.
    rt.update(|ui, _| ui.sandbox.idle = TextEdit::new("0"));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-sandbox-error").text.as_deref(),
        Some("Idle minutes are a whole number from 1 to 1440.")
    );
    rt.update(|ui, _| {
        ui.sandbox.idle = TextEdit::new("45");
        ui.sandbox.quota = TextEdit::new("2048");
    });
    settle(&mut rt);
    assert!(rt.find("rd-sandbox-error").is_none());
    click(&mut rt, "rd-sandbox-save");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::SaveSandbox {
            bot_id: "default".into(),
            update: SandboxUpdate {
                provider: SandboxProvider::Container,
                host_network_acknowledged: true,
                idle_minutes: 45,
                disk_quota_mib: Some(2048),
                revision: 3,
            },
        })
    );
    assert_eq!(
        element(&rt, "rd-sandbox-save").label.as_deref(),
        Some("Saving…")
    );

    // The save lands: the form shows the new revision with nothing to save.
    let mut saved = scenes::sandbox_info(true).settings;
    saved.idle_minutes = 45;
    saved.disk_quota_mib = Some(2048);
    saved.revision = 4;
    deliver(
        &mut rt,
        Event::SandboxSaved {
            bot_id: "default".into(),
            settings: saved,
        },
    );
    assert!(!rt.state.sandbox.is_dirty());
    assert_eq!(
        element(&rt, "rd-sandbox-status").text.as_deref(),
        Some("Saved revision 4.")
    );
}

#[test]
fn sandbox_settings_changed_elsewhere_keep_the_draft_and_block_saving() {
    let mut rt = render_sized(scenes::settings_sandbox_container, false, (1280.0, 2000.0));
    assert_eq!(
        element(&rt, "rd-sandbox-status").text.as_deref(),
        Some("Unsaved changes")
    );
    // Another client saved revision 4 while this form has edits.
    let mut newer = scenes::sandbox_info(true);
    newer.settings.revision = 4;
    newer.settings.idle_minutes = 10;
    deliver(
        &mut rt,
        Event::Sandbox {
            bot_id: "default".into(),
            info: Box::new(newer),
        },
    );
    assert_eq!(rt.state.sandbox.idle.text, "90", "the draft is kept");
    let error = element(&rt, "rd-sandbox-error").text.unwrap_or_default();
    assert!(error.contains("changed elsewhere"), "{error}");
    let before = rt.state.sent.len();
    click(&mut rt, "rd-sandbox-save");
    assert_eq!(rt.state.sent.len(), before);

    // Discard loads the latest revision and the bar goes away.
    click(&mut rt, "rd-sandbox-discard");
    assert_eq!(rt.state.sandbox.idle.text, "10");
    assert!(rt.find("rd-save-bar").is_none());

    // With no edits, a newer revision is simply shown.
    let mut newest = scenes::sandbox_info(true);
    newest.settings.revision = 5;
    newest.settings.idle_minutes = 20;
    deliver(
        &mut rt,
        Event::Sandbox {
            bot_id: "default".into(),
            info: Box::new(newest),
        },
    );
    assert_eq!(rt.state.sandbox.idle.text, "20");
}

#[test]
fn the_sandbox_page_asks_again_every_few_seconds_while_it_shows() {
    let mut rt = render(scenes::settings_sandbox, false);
    let loads = |rt: &Runtime<Ui>| {
        let sent = rt.state.sent.iter();
        sent.filter(|c| matches!(c, Command::LoadSandbox { .. }))
            .count()
    };
    let opened = loads(&rt);
    rt.update(|ui, _| {
        assert!(ui.refresh_sandbox(100.0));
        ui.refresh_sandbox(102.0);
        ui.refresh_sandbox(105.5);
        ui.open_settings(Some(Page::Account));
        assert!(!ui.refresh_sandbox(200.0));
    });
    assert_eq!(loads(&rt), opened + 2);
}

#[test]
fn workspace_folders_open_and_lead_back_up() {
    let mut rt = render_sized(scenes::settings_sandbox, false, (1280.0, 1400.0));
    click(&mut rt, "rd-nav-default-workspace");
    assert!(rt.state.sent.contains(&Command::LoadWorkspaceFiles {
        bot_id: "default".into(),
        path: "/workspace".into(),
    }));
    assert!(rt.find("rd-files-loading").is_some());
    assert!(rt.find("rd-files-up").is_some());
    deliver(
        &mut rt,
        Event::WorkspaceFiles {
            bot_id: "default".into(),
            listing: scenes::workspace_listing(false),
        },
    );
    assert_eq!(
        element(&rt, "rd-files-summary").text.as_deref(),
        Some("4 items · Checkpoint 41 · 18.0 MiB of 100.0 MiB")
    );
    let text = screen_text(&rt);
    for expected in [
        "Folder · ",
        "1.2 KiB · ",
        "Symbolic link · not followed · ",
        "2.3 MiB · ",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    // Only files can be downloaded.
    assert!(rt.find("rd-file-/workspace/README.md-download").is_some());
    assert!(rt.find("rd-file-/workspace/reports-download").is_none());
    assert!(rt.find("rd-file-/workspace/latest-download").is_none());

    // A folder's name opens it; the list empties until its files arrive.
    click(&mut rt, "rd-file-/workspace/reports");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadWorkspaceFiles {
            bot_id: "default".into(),
            path: "/workspace/reports".into(),
        })
    );
    assert_eq!(
        element(&rt, "rd-files-path").text.as_deref(),
        Some("/workspace/reports")
    );
    assert!(rt.find("rd-files-loading").is_some());
    // A late answer for the folder the owner left is dropped.
    deliver(
        &mut rt,
        Event::WorkspaceFiles {
            bot_id: "default".into(),
            listing: scenes::workspace_listing(false),
        },
    );
    assert!(rt.find("rd-files-loading").is_some());
    deliver(
        &mut rt,
        Event::WorkspaceFiles {
            bot_id: "default".into(),
            listing: scenes::workspace_listing(true),
        },
    );
    assert!(screen_text(&rt).contains("q3-summary.csv"));

    // Up, by the arrow or by the first crumb.
    click(&mut rt, "rd-files-up");
    assert_eq!(rt.state.model.files.path, "/workspace");
    click(&mut rt, "rd-files-sandbox");
    assert_eq!(
        element(&rt, "rd-settings-page-name").text.as_deref(),
        Some("Sandbox")
    );
}

#[test]
fn a_workspace_file_downloads_once_at_a_time_and_says_where_it_went() {
    let mut rt = render_sized(scenes::settings_workspace, false, (1280.0, 1400.0));
    click(&mut rt, "rd-file-/workspace/README.md-download");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::DownloadWorkspaceFile {
            bot_id: "default".into(),
            path: "/workspace/README.md".into(),
            name: "README.md".into(),
            revision: 41,
        })
    );
    assert!(rt.find("rd-files-downloading").is_some());
    // The other files wait for this one.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-file-/workspace/plan-2027.xlsx-download");
    assert_eq!(rt.state.sent.len(), before);

    deliver(
        &mut rt,
        Event::FileDownloaded {
            saved_as: "README (1).md".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-files-saved").text.as_deref(),
        Some("Saved to your Downloads folder as README (1).md.")
    );
    click(&mut rt, "rd-file-/workspace/plan-2027.xlsx-download");
    deliver(
        &mut rt,
        Event::FileDownloadFailed {
            message: "The workspace changed. Refresh and try again.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-files-download-error").text.as_deref(),
        Some("The workspace changed. Refresh and try again.")
    );
    assert!(rt.find("rd-files-saved").is_none());

    // Refresh asks for the folder and the sandbox details again.
    click(&mut rt, "rd-files-refresh");
    assert!(rt.find("rd-files-download-error").is_none());
    let tail = &rt.state.sent[rt.state.sent.len() - 2..];
    assert!(matches!(tail[0], Command::LoadWorkspaceFiles { .. }));
    assert!(matches!(tail[1], Command::LoadSandbox { .. }));
}

#[test]
fn a_failed_listing_keeps_the_files_but_stops_downloads() {
    let mut rt = render_sized(scenes::settings_workspace, false, (1280.0, 1400.0));
    deliver(
        &mut rt,
        Event::WorkspaceFilesFailed {
            bot_id: "default".into(),
            path: "/workspace".into(),
            message: "Could not reach Raphie.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-files-error").text.as_deref(),
        Some("Could not reach Raphie. Use Refresh to retry or open a parent folder.")
    );
    assert!(screen_text(&rt).contains("README.md"));
    let before = rt.state.sent.len();
    click(&mut rt, "rd-file-/workspace/README.md-download");
    assert_eq!(rt.state.sent.len(), before, "the listing may be stale");

    // The page asks again by itself every few seconds while it shows.
    rt.update(|ui, _| {
        ui.model.files.loading = false;
        assert!(ui.watch_files(100.0));
        ui.watch_files(102.0);
    });
    assert_eq!(rt.state.sent.len(), before + 1);
    rt.update(|ui, _| {
        ui.open_settings(Some(Page::Account));
        assert!(!ui.watch_files(200.0));
    });
}

#[test]
fn jobs_are_listed_with_their_state_and_what_can_be_done() {
    let mut rt = render_sized(scenes::settings_account, false, (1280.0, 2000.0));
    click(&mut rt, "rd-nav-default-jobs");
    assert!(rt.state.sent.contains(&Command::LoadJobs {
        bot_id: "default".into()
    }));
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadJobRuns {
            job_id: None,
            before: None,
            ..
        })
    ));
    assert!(screen_text(&rt).contains("Loading jobs…"));
    deliver(
        &mut rt,
        Event::Jobs {
            bot_id: "default".into(),
            items: scenes::scheduled_jobs(),
        },
    );
    let badge = |rt: &Runtime<Ui>, id: &str| {
        let key = format!("rd-job-{id}-badge");
        element(rt, &key).text.unwrap_or_default()
    };
    assert_eq!(badge(&rt, "job-brief"), "Active");
    assert_eq!(badge(&rt, "job-renewal"), "Failed");
    assert_eq!(badge(&rt, "job-digest"), "Paused");
    let text = screen_text(&rt);
    for expected in [
        "Every 1440 minutes · Next: ",
        "Last run: Completed · ",
        "One-time reminder",
        "No runs yet",
        "Loading run history…",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }
    // A finished one-time job has nothing to pause; only a job with a
    // conversation can open one.
    assert!(rt.find("rd-job-job-renewal-toggle").is_none());
    assert!(rt.find("rd-job-job-renewal-open").is_none());
    assert_eq!(
        element(&rt, "rd-job-job-digest-toggle").label.as_deref(),
        Some("Resume")
    );

    click(&mut rt, "rd-job-job-brief-run");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::ChangeJob {
            bot_id: "default".into(),
            id: "job-brief".into(),
            action: JobAction::Run,
        })
    );
    // One change at a time: the other buttons wait for the answer.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-job-job-digest-remove");
    assert_eq!(rt.state.sent.len(), before);
    deliver(
        &mut rt,
        Event::JobChanged {
            bot_id: "default".into(),
            items: scenes::scheduled_jobs(),
            ran: true,
        },
    );
    assert_eq!(
        element(&rt, "rd-jobs-message").text.as_deref(),
        Some("Run queued. Its result will appear in the job's conversation.")
    );
    click(&mut rt, "rd-job-job-digest-remove");
    deliver(
        &mut rt,
        Event::JobChangeFailed {
            message: "Scheduled job not found.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-jobs-error").text.as_deref(),
        Some("Scheduled job not found.")
    );

    // A job's conversation opens in the workspace.
    click(&mut rt, "rd-job-job-brief-open");
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::SelectSession {
            session_id: Some("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b".into()),
        })
    );
}

/// The ticket of the runs load the page last asked for.
fn runs_ticket(rt: &Runtime<Ui>) -> u64 {
    match rt.state.sent.last() {
        Some(Command::LoadJobRuns { ticket, .. }) => *ticket,
        other => panic!("the last command is not a runs load: {other:?}"),
    }
}

#[test]
fn run_history_pages_filters_by_job_and_refreshes() {
    let mut rt = render_sized(scenes::settings_jobs, false, (1280.0, 2400.0));
    let text = screen_text(&rt);
    for expected in [
        "Running · Late",
        "Reply in progress; tool actions may be waiting for your approval.",
        "No model configured. Connect a model provider in Settings.",
        "The reply is ready in its conversation.",
    ] {
        assert!(text.contains(expected), "missing {expected:?}");
    }

    // Older runs load from the button, after the cursor.
    click(&mut rt, "rd-runs-older");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadJobRuns { before: Some(cursor), .. }) if cursor == "cursor-older"
    ));
    let ticket = runs_ticket(&rt);
    deliver(
        &mut rt,
        Event::JobRunsFailed {
            ticket,
            older: true,
            message: "offline".into(),
        },
    );
    assert!(rt.find("rd-runs-older-error").is_some());
    assert_eq!(
        element(&rt, "rd-runs-older").label.as_deref(),
        Some("Retry loading older runs")
    );
    assert!(rt.find("rd-run-run-104").is_some(), "the runs stay");

    // "Run history" on a job narrows the list to it; a late answer for
    // every job's runs is dropped.
    let stale = runs_ticket(&rt);
    click(&mut rt, "rd-job-job-renewal-history");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadJobRuns { job_id: Some(id), before: None, .. }) if id == "job-renewal"
    ));
    assert!(rt.find("rd-runs-loading").is_some());
    deliver(
        &mut rt,
        Event::JobRuns {
            ticket: stale,
            older: false,
            page: scenes::job_runs(),
        },
    );
    assert!(rt.find("rd-runs-loading").is_some());
    let ticket = runs_ticket(&rt);
    let mut one = scenes::job_runs();
    one.items.retain(|run| run.job_id == "job-renewal");
    one.next = None;
    deliver(
        &mut rt,
        Event::JobRuns {
            ticket,
            older: false,
            page: one,
        },
    );
    assert!(rt.find("rd-run-run-101").is_some());
    assert!(rt.find("rd-run-run-104").is_none());
    assert!(rt.find("rd-runs-older").is_none());
    click(&mut rt, "rd-runs-all");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadJobRuns { job_id: None, .. })
    ));

    // While the page shows it asks again every few seconds.
    let ticket = runs_ticket(&rt);
    deliver(
        &mut rt,
        Event::JobRuns {
            ticket,
            older: false,
            page: scenes::job_runs(),
        },
    );
    let before = rt.state.sent.len();
    rt.update(|ui, _| {
        assert!(ui.refresh_jobs(100.0));
        ui.refresh_jobs(102.0);
    });
    // The jobs and the newest runs, once.
    assert_eq!(rt.state.sent.len(), before + 2);

    // A run with a conversation opens it.
    click(&mut rt, "rd-run-run-104");
    assert_eq!(rt.state.screen, Screen::Workspace);
}

#[test]
fn a_job_is_created_in_a_dialog_that_keeps_a_draft() {
    let mut rt = render_sized(scenes::settings_jobs_empty, false, (1280.0, 1200.0));
    let text = screen_text(&rt);
    assert!(text.contains("No scheduled jobs yet."));
    assert!(text.contains("No tracked runs yet."));
    assert!(rt.find("rd-job-form").is_none());
    click(&mut rt, "rd-jobs-create");
    assert!(rt.find("rd-job-form").is_some());
    // Nothing typed: nothing to schedule, and Cancel closes it.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-job-schedule");
    assert_eq!(rt.state.sent.len(), before);
    assert_eq!(
        element(&rt, "rd-job-discard").label.as_deref(),
        Some("Cancel")
    );
    click(&mut rt, "rd-job-discard");
    assert!(rt.find("rd-job-form").is_none());

    // A draft keeps the dialog open when it is dismissed.
    click(&mut rt, "rd-jobs-create");
    rt.update(|ui, _| {
        ui.job.name = TextEdit::new("Friday wrap-up");
        ui.job.prompt = TextEdit::new("Summarize what shipped this week.");
        ui.job.date = TextEdit::new("next Friday");
        ui.close_job_form();
    });
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-job-error").text.as_deref(),
        Some("Discard your draft before closing.")
    );
    // A date that is not one is caught before anything is sent.
    click(&mut rt, "rd-job-schedule");
    let error = element(&rt, "rd-job-error").text.unwrap_or_default();
    assert!(error.contains("valid first-run time"), "{error}");
    assert_eq!(rt.state.sent.len(), before);

    // A single run carries no interval.
    click(&mut rt, "rd-job-once");
    assert!(rt.find("rd-job-minutes").is_none());
    rt.update(|ui, _| {
        ui.job.date = TextEdit::new("2027-03-05");
        ui.job.time = TextEdit::new("16:30");
    });
    settle(&mut rt);
    click(&mut rt, "rd-job-schedule");
    let Some(Command::AddJob { job, .. }) = rt.state.sent.last() else {
        panic!("the job is sent");
    };
    assert_eq!(job.name, "Friday wrap-up");
    assert_eq!(job.every_minutes, None);
    assert_eq!(
        element(&rt, "rd-job-schedule").label.as_deref(),
        Some("Scheduling…")
    );

    // A refusal keeps the dialog and the draft; success closes it.
    deliver(
        &mut rt,
        Event::JobChangeFailed {
            message: "Choose a first run in the future.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-job-error").text.as_deref(),
        Some("Choose a first run in the future.")
    );
    assert_eq!(rt.state.job.name.text, "Friday wrap-up");
    click(&mut rt, "rd-job-schedule");
    deliver(
        &mut rt,
        Event::JobAdded {
            bot_id: "default".into(),
            items: scenes::scheduled_jobs(),
        },
    );
    assert!(rt.find("rd-job-form").is_none());
    assert!(rt.state.job.name.text.is_empty());
    assert_eq!(
        element(&rt, "rd-jobs-message").text.as_deref(),
        Some("Job scheduled. The runtime must be running when it is due.")
    );
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

#[test]
fn files_wait_in_the_composer_and_go_with_the_message() {
    let mut rt = render(scenes::attachments, false);
    let c = "c".repeat(64);
    let d = "d".repeat(64);
    // A pill's text is set apart with invisible direction marks.
    let shown = screen_text(&rt).replace(['\u{2068}', '\u{2069}'], "");
    assert!(shown.contains("site-photo.png") && shown.contains("2.2 MB"));
    assert!(shown.contains("measurements.csv") && shown.contains("812 B"));

    // Removing one leaves the other.
    click(&mut rt, &format!("rd-attachment-{c}-action"));
    assert!(rt.find(&format!("rd-attachment-{c}")).is_none());
    assert!(rt.find(&format!("rd-attachment-{d}")).is_some());

    // Files alone are a message: with the text cleared, Send still works.
    rt.state.composer = TextEdit::new("");
    settle(&mut rt);
    click(&mut rt, "rd-send");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Send {
            text: String::new(),
            attachments: vec![d.clone()],
            model: None,
            approval_mode: None,
        })
    );
    // The file stays until the runtime admits the message, then leaves.
    assert!(rt.find(&format!("rd-attachment-{d}")).is_some());
    rt.update(|ui, _| {
        ui.model.apply(Event::MessageAccepted {
            receipt: serde_json::from_value(
                serde_json::json!({ "id": "turn-new", "sessionId": "s-1" }),
            )
            .unwrap(),
        });
    });
    settle(&mut rt);
    assert!(rt.find("rd-attachments").is_none());
}

#[test]
fn files_are_attached_by_picker_drop_and_paste_up_to_four() {
    let mut rt = render(scenes::conversation, false);
    let attached = |rt: &Runtime<Ui>| match rt.state.sent.last() {
        Some(Command::Attach { bot_id, uploads }) => {
            assert_eq!(bot_id, "default");
            uploads.clone()
        }
        other => panic!("expected an Attach, got {other:?}"),
    };
    // What the engine would answer: one file filed, then the end.
    let mut next = 0;
    let mut uploaded = |rt: &mut Runtime<Ui>, name: &str| {
        next += 1;
        let file = serde_json::from_value(serde_json::json!({
            "id": format!("{next}").repeat(64), "name": name, "size": 10,
        }))
        .unwrap();
        rt.update(|ui, _| {
            ui.model.apply(Event::Attached {
                bot_id: "default".into(),
                file,
            });
            ui.model.apply(Event::AttachFinished {
                bot_id: "default".into(),
            });
        });
        settle(rt);
    };

    // The paperclip opens the system's picker; the chosen file goes up.
    click(&mut rt, "rd-attach");
    assert!(rt.file_dialog().is_some(), "the picker is open");
    rt.resolve_file_dialog(Some("/tmp/report.pdf".into()))
        .unwrap();
    settle(&mut rt);
    assert_eq!(attached(&rt), [Upload::File("/tmp/report.pdf".into())]);
    assert!(screen_text(&rt).contains("Uploading to workspace…"));
    // Nothing else can be chosen until the upload is over.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-attach");
    assert!(rt.file_dialog().is_none());
    assert_eq!(rt.state.sent.len(), before);
    uploaded(&mut rt, "report.pdf");
    assert!(screen_text(&rt).contains("report.pdf"));

    // Closing the picker attaches nothing.
    click(&mut rt, "rd-attach");
    rt.resolve_file_dialog(None).unwrap();
    settle(&mut rt);
    assert_eq!(rt.state.sent.len(), before);

    // Files dropped on the conversation go up together.
    let (x, y) = rt.find("rd-main").unwrap();
    rt.drop_files(vec!["/tmp/a.txt".into(), "/tmp/b.txt".into()], Some((x, y)));
    settle(&mut rt);
    assert_eq!(
        attached(&rt),
        [
            Upload::File("/tmp/a.txt".into()),
            Upload::File("/tmp/b.txt".into())
        ]
    );
    uploaded(&mut rt, "a.txt");
    uploaded(&mut rt, "b.txt");

    // A pasted screenshot is attached instead of pasted as text.
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    let image = rune::ClipboardImage::from_png(png.clone()).expect("a PNG header");
    click(&mut rt, "rd-composer");
    rt.paste_content(rune::ClipboardContent::new("").with_image(image));
    settle(&mut rt);
    assert_eq!(
        attached(&rt),
        [Upload::Bytes {
            name: "Pasted image.png".into(),
            bytes: png.into(),
        }]
    );
    assert_eq!(rt.state.composer.text, "");
    uploaded(&mut rt, "Pasted image.png");

    // Four is the most: the paperclip is off, and a fifth says why.
    let before = rt.state.sent.len();
    click(&mut rt, "rd-attach");
    assert!(rt.file_dialog().is_none());
    let (x, y) = rt.find("rd-main").unwrap();
    rt.drop_files(vec!["/tmp/fifth.txt".into()], Some((x, y)));
    settle(&mut rt);
    assert_eq!(rt.state.sent.len(), before);
    assert_eq!(
        element(&rt, "rd-attach-error").text.as_deref(),
        Some(TOO_MANY)
    );
}

#[test]
fn a_messages_file_is_saved_from_its_card() {
    let mut rt = render(scenes::attachments, true);
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    click(&mut rt, &format!("rd-file-t1-{a}-action"));
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::DownloadAttachment {
            bot_id: "default".into(),
            id: a.clone(),
            name: "floor-plan.png".into(),
        })
    );
    // One save at a time: the other card waits.
    let before = rt.state.sent.len();
    click(&mut rt, &format!("rd-file-t1-{b}-action"));
    assert_eq!(rt.state.sent.len(), before);
    rt.update(|ui, _| {
        ui.model.apply(Event::AttachmentSaved {
            saved_as: "floor-plan.png".into(),
        });
    });
    settle(&mut rt);
    assert!(screen_text(&rt).contains("Saved to your Downloads folder as floor-plan.png."));
}

#[test]
fn the_model_picker_changes_an_open_conversations_model() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversation, dark);
        deliver(
            &mut rt,
            Event::BotSettings {
                bot_id: "default".into(),
                settings: Box::new(scenes::model_settings()),
            },
        );
        // The button names the bot's default until the session has its own.
        assert_eq!(
            element(&rt, "rd-model").label.as_deref(),
            Some("Choose model: Claude Fable Latest")
        );
        assert!(rt.find("rd-model-picker").is_none());
        click(&mut rt, "rd-model");
        assert_eq!(element(&rt, "rd-model-count").text.as_deref(), Some("5"));
        let shown = screen_text(&rt);
        assert!(shown.contains("Personal · claude-fable · $10 / $50 per M · New-session default"));
        assert!(shown.contains("Work · openai/gpt-next · $2.5 / $0.075 per M"));
        assert!(shown.contains("Via Personal"));

        // Typing narrows the list: the caret is already in the search.
        rt.paste("opus");
        settle(&mut rt);
        assert_eq!(element(&rt, "rd-model-count").text.as_deref(), Some("1"));
        click(&mut rt, "rd-model-choice-c-router:anthropic/claude-opus");
        let chosen = ModelSelection {
            provider: "c-router".into(),
            model_id: "anthropic/claude-opus".into(),
        };
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::ChooseModel {
                session_id: "s-1".into(),
                model: chosen.clone(),
            })
        );
        // The list stays, saying it is saving, until the host agrees.
        assert!(screen_text(&rt).contains("Saving…"));
        deliver(
            &mut rt,
            Event::ModelChosen {
                session_id: "s-1".into(),
                model: chosen,
            },
        );
        assert!(rt.find("rd-model-picker").is_none());
        assert_eq!(
            element(&rt, "rd-model").label.as_deref(),
            Some("Choose model: Anthropic: Claude Opus")
        );
    }
}

#[test]
fn a_refused_model_says_why_and_pressing_outside_closes_the_picker() {
    let mut rt = render(scenes::model_picker, false);
    click(&mut rt, "rd-model-choice-c-direct:claude-haiku");
    deliver(
        &mut rt,
        Event::ModelChoiceFailed {
            message: "That model is not available.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-model-error").text.as_deref(),
        Some("That model is not available.")
    );
    assert!(rt.find("rd-model-picker").is_some());
    // A press on the page, away from the list (which covers the middle).
    rt.pointer_down(1200.0, 120.0);
    rt.pointer_up(1200.0, 120.0);
    settle(&mut rt);
    assert!(rt.find("rd-model-picker").is_none());
}

#[test]
fn a_new_conversation_starts_with_the_model_picked_for_it() {
    let mut rt = render(scenes::new_conversation, false);
    deliver(
        &mut rt,
        Event::BotSettings {
            bot_id: "default".into(),
            settings: Box::new(scenes::model_settings()),
        },
    );
    click(&mut rt, "rd-model");
    let before = rt.state.sent.len();
    click(&mut rt, "rd-model-choice-c-direct:claude-haiku");
    // Nothing is sent to the host yet: there is no session to change.
    assert_eq!(rt.state.sent.len(), before);
    assert!(rt.find("rd-model-picker").is_none());
    assert_eq!(
        element(&rt, "rd-model").label.as_deref(),
        Some("Choose model: Claude Haiku Latest")
    );
    click(&mut rt, "rd-composer");
    rt.paste("Hello");
    settle(&mut rt);
    click(&mut rt, "rd-send");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Send {
            text: "Hello".into(),
            attachments: Vec::new(),
            model: Some(ModelSelection {
                provider: "c-direct".into(),
                model_id: "claude-haiku".into(),
            }),
            // A new conversation asks before commands unless told otherwise.
            approval_mode: Some(ApprovalMode::Ask),
        })
    );
}

#[test]
fn starred_models_are_listed_under_favorites() {
    let mut rt = render(scenes::model_picker, false);
    click(&mut rt, "rd-model-favorites");
    assert_eq!(element(&rt, "rd-model-count").text.as_deref(), Some("1"));
    assert!(screen_text(&rt).contains("OpenAI: GPT Next"));
    // Unstarring the only favourite empties the list and says how to fill it.
    click(&mut rt, "rd-model-star-c-router:openai/gpt-next");
    assert_eq!(
        element(&rt, "rd-model-empty").text.as_deref(),
        Some("Star a model to keep it here.")
    );
    click(&mut rt, "rd-model-all");
    click(&mut rt, "rd-model-star-c-direct:claude-haiku");
    assert_eq!(rt.state.favorites, ["c-direct:claude-haiku"]);

    // "Manage connection" leaves for the bot's Providers page.
    click(&mut rt, "rd-model-manage");
    assert!(matches!(
        &rt.state.screen,
        Screen::Settings(Page::Bot {
            section: BotSection::Providers,
            ..
        })
    ));
}

#[test]
fn command_permissions_load_and_change_for_an_open_conversation() {
    for dark in [false, true] {
        let mut rt = render(scenes::conversation, dark);
        // The first event after a conversation opens asks for its mode.
        deliver(
            &mut rt,
            Event::BotSettings {
                bot_id: "default".into(),
                settings: Box::new(scenes::model_settings()),
            },
        );
        assert!(rt.state.sent.contains(&Command::LoadApprovalMode {
            session_id: "s-1".into()
        }));
        assert_eq!(
            element(&rt, "rd-permissions").label.as_deref(),
            Some("Permissions: Loading")
        );
        click(&mut rt, "rd-permissions");
        assert!(screen_text(&rt).contains("Loading permissions…"));
        // Nothing can be chosen until the mode is known: the options are
        // disabled, and choosing sends nothing.
        let before = rt.state.sent.len();
        rt.update(|ui, _| ui.set_command_mode(ApprovalMode::FullAccess));
        settle(&mut rt);
        assert_eq!(rt.state.sent.len(), before);

        deliver(
            &mut rt,
            Event::ApprovalMode {
                session_id: "s-1".into(),
                mode: ApprovalMode::Ask,
            },
        );
        assert_eq!(
            element(&rt, "rd-permissions").label.as_deref(),
            Some("Permissions: Ask")
        );
        assert_eq!(rt.state.shown_command_mode(), Some(ApprovalMode::Ask));
        click(&mut rt, "rd-permissions-full");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::SetApprovalMode {
                session_id: "s-1".into(),
                mode: ApprovalMode::FullAccess,
            })
        );
        deliver(
            &mut rt,
            Event::ApprovalModeSaved {
                session_id: "s-1".into(),
                mode: ApprovalMode::FullAccess,
            },
        );
        assert_eq!(
            element(&rt, "rd-permissions").label.as_deref(),
            Some("Permissions: Full access")
        );
        assert_eq!(
            rt.state.shown_command_mode(),
            Some(ApprovalMode::FullAccess)
        );

        // A refused change says so and leaves the mode as it was.
        click(&mut rt, "rd-permissions-ask");
        deliver(
            &mut rt,
            Event::ApprovalModeSaveFailed {
                session_id: "s-1".into(),
            },
        );
        assert_eq!(
            element(&rt, "rd-permissions-save-error").text.as_deref(),
            Some("Could not save permissions. Please retry.")
        );
        assert_eq!(
            rt.state.shown_command_mode(),
            Some(ApprovalMode::FullAccess)
        );
    }
}

#[test]
fn a_failed_load_of_command_permissions_can_be_retried() {
    let mut rt = render(scenes::conversation, false);
    deliver(
        &mut rt,
        Event::ApprovalModeFailed {
            session_id: "s-1".into(),
        },
    );
    // That first event asked for the mode; now the load fails.
    deliver(
        &mut rt,
        Event::ApprovalModeFailed {
            session_id: "s-1".into(),
        },
    );
    click(&mut rt, "rd-permissions");
    assert!(screen_text(&rt).contains("Could not load permissions."));
    let loads = |rt: &Runtime<Ui>| {
        rt.state
            .sent
            .iter()
            .filter(|command| matches!(command, Command::LoadApprovalMode { .. }))
            .count()
    };
    let before = loads(&rt);
    click(&mut rt, "rd-permissions-retry");
    assert_eq!(loads(&rt), before + 1);
    assert!(screen_text(&rt).contains("Loading permissions…"));
}

#[test]
fn a_new_conversation_starts_with_the_command_mode_chosen_for_it() {
    let mut rt = render(scenes::new_conversation, false);
    // No session yet, so the mode is this client's and starts at Ask.
    assert_eq!(
        element(&rt, "rd-permissions").label.as_deref(),
        Some("Permissions: Ask")
    );
    click(&mut rt, "rd-permissions");
    let before = rt.state.sent.len();
    click(&mut rt, "rd-permissions-full");
    assert_eq!(rt.state.sent.len(), before, "nothing to tell the host yet");
    assert_eq!(
        rt.state.shown_command_mode(),
        Some(ApprovalMode::FullAccess)
    );
    // A press on the page closes the list.
    rt.pointer_down(1200.0, 120.0);
    rt.pointer_up(1200.0, 120.0);
    settle(&mut rt);
    assert!(rt.find("rd-permissions-list").is_none());

    click(&mut rt, "rd-composer");
    rt.paste("Tidy the downloads folder");
    settle(&mut rt);
    click(&mut rt, "rd-send");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Send {
            text: "Tidy the downloads folder".into(),
            attachments: Vec::new(),
            model: None,
            approval_mode: Some(ApprovalMode::FullAccess),
        })
    );
}

#[test]
fn replies_not_read_yet_are_marked_counted_and_listed_first() {
    for dark in [false, true] {
        let mut rt = render(scenes::unread, dark);
        let shown = screen_text(&rt);
        assert!(shown.contains("2 new replies"));
        assert!(rt.find("rd-session-s-1-dot").is_some());
        // A conversation read to its end has no marker.
        assert!(rt.find("rd-session-s-3-dot").is_none());
        // Two conversations have something for the owner: one with new
        // replies, one waiting for approval.
        assert_eq!(needs_you(&rt, "default").as_deref(), Some("Needs you"));

        // The list is most recent first, with new replies ahead of the
        // rest: a new reply in the oldest conversation lifts it to the top.
        let top = |rt: &Runtime<Ui>, key: &str| element(rt, key).rect[1];
        assert!(top(&rt, "rd-session-s-1") < top(&rt, "rd-session-s-2"));
        assert!(top(&rt, "rd-session-s-2") < top(&rt, "rd-session-s-3"));
        rt.update(|ui, _| {
            for session in &mut ui.model.sessions {
                if session.id == "s-3" {
                    session.reply_count = Some(2);
                }
            }
        });
        settle(&mut rt);
        assert!(top(&rt, "rd-session-s-3") < top(&rt, "rd-session-s-2"));
        assert!(top(&rt, "rd-session-s-1") < top(&rt, "rd-session-s-2"));
    }
}

#[test]
fn opening_a_conversation_reads_its_replies_only_at_its_end_in_the_front_window() {
    let mut rt = render(scenes::unread, false);
    let unread = |rt: &Runtime<Ui>| {
        let session = rt
            .state
            .model
            .session_list()
            .find(|session| session.id == "s-1")
            .cloned()
            .unwrap();
        rt.state.unread(&session)
    };
    assert_eq!(unread(&rt), 2);
    click(&mut rt, "rd-session-s-1");
    // The next news from the engine finds the conversation on screen.
    deliver(
        &mut rt,
        Event::BotSettings {
            bot_id: "default".into(),
            settings: Box::new(scenes::model_settings()),
        },
    );
    assert_eq!(unread(&rt), 0);
    assert!(rt.find("rd-session-s-1-dot").is_none());

    // A reply that arrives while another app is in front stays new...
    let arrive = |rt: &mut Runtime<Ui>, count: u32| {
        rt.update(|ui, _| {
            for session in &mut ui.model.sessions {
                if session.id == "s-1" {
                    session.reply_count = Some(count);
                }
            }
            ui.mark_read();
        });
        settle(rt);
    };
    rt.update(|ui, _| ui.window_focused = false);
    arrive(&mut rt, 4);
    assert_eq!(unread(&rt), 1);
    assert!(screen_text(&rt).contains("1 new reply"));
    // ...until the window is looked at again.
    rt.update(|ui, _| {
        ui.window_focused = true;
        ui.mark_read();
    });
    settle(&mut rt);
    assert_eq!(unread(&rt), 0);

    // So does one that arrives while the owner has scrolled up to read.
    rt.update(|ui, _| ui.at_bottom = false);
    arrive(&mut rt, 5);
    assert_eq!(unread(&rt), 1);
    rt.update(|ui, _| {
        ui.at_bottom = true;
        ui.mark_read();
    });
    settle(&mut rt);
    assert_eq!(unread(&rt), 0);

    // Settings in front of the conversation does not read it either.
    rt.update(|ui, _| ui.open_settings(None));
    arrive(&mut rt, 6);
    assert_eq!(unread(&rt), 1);
}

#[test]
fn the_bell_counts_updates_and_opens_the_inbox_across_bots() {
    for dark in [false, true] {
        let mut rt = render(scenes::unread, dark);
        // One conversation with new replies and one approval, both Raphie's.
        assert!(rt.find("rd-bell-count").is_some());
        assert_eq!(rt.state.notifications().1, 2);
        click(&mut rt, "rd-bell");
        assert!(rt.state.inbox_open);
        assert_eq!(
            element(&rt, "rd-inbox-count").text.as_deref(),
            Some("2 new")
        );
        // The composer gives way to the inbox.
        assert!(rt.find("rd-composer").is_none());
        click(&mut rt, "rd-inbox-back");
        assert!(rt.find("rd-composer").is_some());
    }
}

#[test]
fn the_inbox_lists_filters_opens_and_dismisses_updates() {
    let mut rt = render(scenes::inbox, false);
    let shown = screen_text(&rt);
    assert_eq!(
        element(&rt, "rd-inbox-count").text.as_deref(),
        Some("5 new")
    );
    for expected in [
        "Today",
        "Earlier",
        "2 new replies",
        "Needs your approval",
        "Action required",
        "Scheduled job interrupted",
        "Scheduled job failed",
        "No model configured. Connect a model provider in Settings.",
        "All three argue for smaller, cheaper evaluation sets.",
    ] {
        assert!(shown.contains(expected), "missing: {expected}");
    }
    // The other bot's row in the roster counts its conversation too.
    assert_eq!(needs_you(&rt, "b-research").as_deref(), Some("1 new reply"));

    click(&mut rt, "rd-inbox-jobs");
    assert_eq!(rt.state.inbox_filter, InboxFilter::Jobs);
    assert!(rt.find("rd-notice-job:default:run-2").is_some());
    assert!(rt.find("rd-notice-reply:default:s-1").is_none());
    click(&mut rt, "rd-inbox-approvals");
    assert!(rt.find("rd-notice-approval:default:s-2").is_some());
    assert!(rt.find("rd-notice-job:default:run-2").is_none());

    // Dismissing a job tells the runtime; it leaves once the runtime agrees.
    click(&mut rt, "rd-inbox-all");
    click(&mut rt, "rd-notice-job:default:run-2-dismiss");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::AcknowledgeRun {
            bot_id: "default".into(),
            run_id: "run-2".into(),
        })
    );
    deliver(
        &mut rt,
        Event::RunAcknowledged {
            bot_id: "default".into(),
            run_id: "run-2".into(),
        },
    );
    assert!(rt.find("rd-notice-job:default:run-2").is_none());
    assert_eq!(
        element(&rt, "rd-inbox-count").text.as_deref(),
        Some("4 new")
    );
    // A refused dismissal says so.
    click(&mut rt, "rd-notice-job:b-research:run-1-dismiss");
    deliver(&mut rt, Event::RunAcknowledgeFailed);
    assert!(screen_text(&rt).contains("Couldn’t dismiss the update. Please try again."));

    // Another bot's update opens that bot's conversation and closes the inbox.
    click(&mut rt, "rd-notice-reply:b-research:r-1");
    assert!(!rt.state.inbox_open);
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("b-research"));
    assert!(rt.state.sent.contains(&Command::SelectSession {
        session_id: Some("r-1".into())
    }));
}

#[test]
fn an_empty_inbox_says_so_and_failed_job_updates_can_be_retried() {
    let mut rt = render(scenes::inbox_empty, false);
    assert_eq!(
        element(&rt, "rd-inbox-empty").text.as_deref(),
        Some("You’re all caught up.")
    );
    assert!(rt.find("rd-inbox-count").is_none());
    click(&mut rt, "rd-inbox-replies");
    assert_eq!(
        element(&rt, "rd-inbox-empty").text.as_deref(),
        Some("No updates in this view.")
    );
    deliver(
        &mut rt,
        Event::JobUpdatesFailed {
            bot_id: "default".into(),
        },
    );
    assert!(screen_text(&rt).contains("Some job updates couldn’t be loaded."));
    click(&mut rt, "rd-inbox-retry");
    assert!(matches!(
        rt.state.sent.last(),
        Some(Command::LoadInbox { .. })
    ));
}

#[test]
fn the_inbox_is_asked_for_every_fifteen_seconds_for_the_right_bots() {
    let mut rt = render(scenes::conversation, false);
    let loads = |rt: &Runtime<Ui>| -> Vec<Command> {
        let sent = &rt.state.sent;
        sent.iter()
            .filter(|c| matches!(c, Command::LoadInbox { .. }))
            .cloned()
            .collect()
    };
    rt.update(|ui, _| {
        assert!(ui.refresh_inbox(100.0));
        // Five seconds later is too soon to ask again.
        assert!(ui.refresh_inbox(105.0));
    });
    // The selected bot's conversations come on its stream, so only the
    // other bot's are asked for; job updates are asked of both.
    assert_eq!(
        loads(&rt),
        [Command::LoadInbox {
            session_bots: vec!["b-research".into()],
            job_bots: vec!["default".into(), "b-research".into()],
        }]
    );
    rt.update(|ui, _| {
        ui.refresh_inbox(115.5);
    });
    assert_eq!(loads(&rt).len(), 2);
}

#[test]
fn updates_that_arrive_behind_another_app_are_announced_by_the_system_once() {
    let mut rt = render(scenes::unread, false);
    let arrive = |rt: &mut Runtime<Ui>, replies: u32| {
        rt.update(|ui, _| {
            for session in &mut ui.model.sessions {
                if session.id == "s-3" {
                    session.reply_count = Some(replies);
                }
            }
            ui.announce();
        });
    };
    // What already waited when the app started is not news.
    rt.update(|ui, _| ui.announce());
    assert!(rt.state.posted.is_empty());

    // In front, a new reply shows on the bell and is not announced...
    arrive(&mut rt, 2);
    assert!(rt.state.posted.is_empty());
    // ...nor announced later for having been seen there.
    rt.update(|ui, _| {
        ui.window_focused = false;
        ui.announce();
    });
    assert!(rt.state.posted.is_empty());

    // Behind another app, the next reply is announced, once.
    arrive(&mut rt, 3);
    rt.update(|ui, _| ui.announce());
    let posted = &rt.state.posted;
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0].title, "Raphie · Tea preferences");
    assert_eq!(posted[0].body, "2 new replies");
    assert_eq!(
        posted[0].target,
        Target {
            bot_id: "default".into(),
            session_id: Some("s-3".into()),
            run_id: None,
        }
    );
}

fn target(bot_id: &str, session_id: Option<&str>, run_id: Option<&str>) -> Target {
    Target {
        bot_id: bot_id.into(),
        session_id: session_id.map(Into::into),
        run_id: run_id.map(Into::into),
    }
}

#[test]
fn a_clicked_notification_opens_its_conversation_from_anywhere() {
    // From Settings, with the inbox open: the conversation replaces both.
    let mut rt = render(scenes::settings_appearance, false);
    rt.update(|ui, _| ui.open_target(&target("default", Some("s-3"), None)));
    settle(&mut rt);
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert!(!rt.state.inbox_open);
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("default"));
    let open = rt
        .state
        .model
        .conversation
        .as_ref()
        .map(|c| c.session_id.as_str());
    assert_eq!(open, Some("s-3"));
}

#[test]
fn a_clicked_job_notification_dismisses_the_run_as_the_inbox_does() {
    let mut rt = render(scenes::conversations, false);
    rt.update(|ui, _| ui.open_target(&target("default", Some("s-1"), Some("run-1"))));
    settle(&mut rt);
    assert!(rt.state.sent.contains(&Command::AcknowledgeRun {
        bot_id: "default".into(),
        run_id: "run-1".into(),
    }));
    let open = rt
        .state
        .model
        .conversation
        .as_ref()
        .map(|c| c.session_id.as_str());
    assert_eq!(open, Some("s-1"));
}

#[test]
fn a_notification_with_nothing_to_open_shows_the_inbox() {
    // A job run with no conversation.
    let mut rt = render(scenes::settings_appearance, false);
    rt.update(|ui, _| ui.open_target(&target("default", None, Some("run-9"))));
    settle(&mut rt);
    assert_eq!(rt.state.screen, Screen::Workspace);
    assert!(rt.state.inbox_open);

    // A bot deleted since: nothing is sent about it.
    let mut rt = render(scenes::conversations, false);
    let before = rt.state.sent.len();
    rt.update(|ui, _| ui.open_target(&target("b-gone", Some("s-1"), Some("run-1"))));
    settle(&mut rt);
    assert!(rt.state.inbox_open);
    assert_eq!(rt.state.sent.len(), before);
}

#[test]
fn a_notification_clicked_after_signing_out_opens_nothing() {
    let mut rt = render(scenes::sign_in, false);
    rt.update(|ui, _| ui.open_target(&target("default", Some("s-1"), None)));
    settle(&mut rt);
    assert!(rt.state.sent.is_empty());
    assert!(rt.find("rd-sign-in").is_some());
}

#[test]
fn image_attachments_ask_for_their_pictures_once_and_files_do_not() {
    let mut rt = render(scenes::attachments, false);
    let previews = |rt: &Runtime<Ui>| -> Vec<String> {
        rt.state
            .sent
            .iter()
            .filter_map(|command| match command {
                Command::LoadPreview { id, .. } => Some(id.clone()),
                _ => None,
            })
            .collect()
    };
    // The scene's pictures count as fetched: nothing is asked again.
    rt.update(|ui, _| ui.ask_previews());
    assert!(previews(&rt).is_empty());

    // Forgotten, they are asked for: the sent floor plan and the photo in
    // the composer, but not the PDF or the CSV.
    rt.update(|ui, _| {
        ui.model.previews = Default::default();
        ui.ask_previews();
        ui.ask_previews();
    });
    assert_eq!(previews(&rt), vec!["c".repeat(64), "a".repeat(64)]);

    // Without a decoder (as here) a sent image keeps its icon in the band.
    let plan = format!("rd-file-t1-{}-preview", "a".repeat(64));
    assert!(rt.find(&plan).is_some());
}

/// The attachments scene with its pictures decoded, as in a window.
fn with_pictures(rt: &mut Runtime<Ui>) {
    rt.update(|ui, _| {
        ui.use_images(ImageCache::new(Arc::new(|| {})));
        ui.decode_previews();
        ui.wait_for_pictures();
    });
    settle(rt);
}

#[test]
fn a_picture_opens_enlarged_and_closes_with_its_button_or_escape() {
    let mut rt = render(scenes::attachments, false);
    with_pictures(&mut rt);
    let plan = format!("rd-file-t1-{}-preview", "a".repeat(64));
    click(&mut rt, &plan);
    let shown = rt.state.viewer.clone().expect("the viewer opened");
    assert_eq!(shown.name, "floor-plan.png");
    assert!(rt.find("rd-viewer-picture").is_some());

    click(&mut rt, "rd-viewer-close");
    assert_eq!(rt.state.viewer, None);
    assert!(rt.find("rd-viewer").is_none());

    // The composer's photo opens too, and Escape closes it.
    click(
        &mut rt,
        &format!("rd-attachment-{}-preview", "c".repeat(64)),
    );
    assert!(rt.state.viewer.is_some());
    let on_key = raphie_desktop::spec().on_key.expect("window keys");
    let escape = KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    };
    rt.update(|ui, tx| {
        assert!(on_key(ui, &escape, tx));
    });
    settle(&mut rt);
    assert_eq!(rt.state.viewer, None);
}

#[test]
fn a_picture_that_is_not_ready_cannot_be_opened_and_shows_nothing() {
    // No decoder: the cards keep their icons and are not buttons.
    let mut rt = render(scenes::attachments, false);
    let plan = format!("rd-file-t1-{}-preview", "a".repeat(64));
    click(&mut rt, &plan);
    assert_eq!(rt.state.viewer, None);
    // A viewer for a picture that is gone draws nothing.
    rt.update(|ui, _| ui.open_viewer("default", "gone", "gone.png"));
    settle(&mut rt);
    assert!(rt.find("rd-viewer").is_none());
}

/// Drags the handle keyed `key` sideways by `dx` points.
fn drag(rt: &mut Runtime<Ui>, key: &str, dx: f32) {
    let (x, y) = rt
        .find(key)
        .unwrap_or_else(|| panic!("no element keyed {key}"));
    rt.pointer_down(x, y);
    for step in 1..=4 {
        rt.pointer_move(x + dx * step as f32 / 4.0, y);
        rt.frame(1.0 / 60.0);
    }
    rt.pointer_up(x + dx, y);
    settle(rt);
}

#[test]
fn the_roster_resizes_by_its_edge_within_the_webs_limits() {
    let mut rt = render(scenes::conversations, false);
    assert_eq!(rt.state.roster_width, 264.0);

    // The roster's edge moves right to widen it.
    drag(&mut rt, "rd-roster-resize", 60.0);
    assert!(
        (rt.state.roster_width - 324.0).abs() < 1.0,
        "{}",
        rt.state.roster_width
    );
    assert!((element(&rt, "rd-roster").rect[2] - 324.0).abs() < 1.0);

    // Never past the limits: 220 to 480.
    drag(&mut rt, "rd-roster-resize", -400.0);
    assert_eq!(rt.state.roster_width, 220.0);
    drag(&mut rt, "rd-roster-resize", 400.0);
    assert_eq!(rt.state.roster_width, 480.0);
}

#[test]
fn a_window_too_small_for_the_chosen_widths_draws_them_narrower() {
    let mut rt = render_sized(scenes::conversations, false, (1100.0, 700.0));
    rt.update(|ui, _| {
        ui.roster_width = 480.0;
        ui.roster_open = true;
    });
    settle(&mut rt);
    // 1100 less the conversation's 320 leaves 780: 480 fits.
    assert_eq!(rt.state.visible_roster_width(), 480.0);
    // The chosen width is kept while a narrower window draws less. (Below
    // 768 the window shows one column at a time instead.)
    rt.update(|ui, _| ui.workspace_width = 790.0);
    assert_eq!(rt.state.visible_roster_width(), 470.0);
    assert_eq!(rt.state.roster_width, 480.0);
}

#[test]
fn the_model_picker_narrows_to_one_family() {
    let mut rt = render(scenes::model_picker, false);
    let count = |rt: &Runtime<Ui>| element(rt, "rd-model-count").text.unwrap_or_default();
    assert_eq!(count(&rt), "5");
    click(&mut rt, "rd-model-family-trigger");
    assert!(rt.state.model_picker.family_open);
    let openai = element_with_label(&rt, "openai");
    click(&mut rt, &openai);
    assert_eq!(
        rt.state.model_picker.filter,
        PickerFilter::Family("openai".into())
    );
    assert!(!rt.state.model_picker.family_open);
    assert_eq!(count(&rt), "1");
    // The rail's All goes back to every family.
    click(&mut rt, "rd-model-all");
    assert_eq!(rt.state.model_picker.filter, PickerFilter::All);
    assert_eq!(count(&rt), "5");
}

#[test]
fn up_and_down_move_between_the_model_picker_rows() {
    let rt = render(scenes::model_picker, false);
    let rows = rt.state.picker_rows();
    assert_eq!(rows.len(), 5);
    let ui = &rt.state;
    // From the search box, Down goes to the first row and Up to the last.
    assert_eq!(
        ui.picker_step(Some("rd-model-search"), 1),
        Some(rows[0].clone())
    );
    assert_eq!(
        ui.picker_step(Some("rd-model-search"), -1),
        Some(rows[4].clone())
    );
    // Between rows, and around at the ends.
    assert_eq!(ui.picker_step(Some(&rows[0]), 1), Some(rows[1].clone()));
    assert_eq!(ui.picker_step(Some(&rows[4]), 1), Some(rows[0].clone()));
    assert_eq!(ui.picker_step(Some(&rows[0]), -1), Some(rows[4].clone()));
    // Focus elsewhere is left alone.
    assert_eq!(ui.picker_step(Some("rd-composer"), 1), None);
    assert_eq!(ui.picker_step(None, 1), None);

    // The window's key handler moves the focus.
    let mut rt = rt;
    click(&mut rt, "rd-model-search");
    let on_key = raphie_desktop::spec().on_key.expect("window keys");
    let down = KeyEvent {
        key: Key::Down,
        mods: Default::default(),
    };
    rt.update(|ui, tx| {
        assert!(on_key(ui, &down, tx));
    });
    settle(&mut rt);
    assert!(element(&rt, &rows[0]).focused);
}

#[test]
fn reading_is_shared_with_the_runtime_once_and_its_count_reads_here() {
    let mut rt = render(scenes::unread, false);
    let shared_reads = |rt: &Runtime<Ui>| -> Vec<u32> {
        rt.state
            .sent
            .iter()
            .filter_map(|command| match command {
                Command::MarkRead { reply_count, .. } => Some(*reply_count),
                _ => None,
            })
            .collect()
    };
    // A runtime that keeps read counts says nothing was read of "Tea
    // preferences" (s-3) yet; another client then reads its one reply.
    rt.update(|ui, _| {
        for session in &mut ui.model.sessions {
            if session.id == "s-3" {
                session.reply_count = Some(2);
                session.read_reply_count = Some(2);
            }
        }
    });
    settle(&mut rt);
    let unread = |rt: &Runtime<Ui>| {
        let session = rt
            .state
            .model
            .sessions
            .iter()
            .find(|s| s.id == "s-3")
            .cloned()
            .unwrap();
        rt.state.unread(&session)
    };
    // This computer had read one of two, but another client read both.
    assert_eq!(unread(&rt), 0);

    // Reading "Plan the week" here (3 replies, the runtime knows of none)
    // is shared once, however often the view looks.
    rt.update(|ui, _| {
        for session in &mut ui.model.sessions {
            if session.id == "s-1" {
                session.read_reply_count = Some(0);
            }
        }
    });
    click(&mut rt, "rd-session-s-1");
    rt.update(|ui, _| {
        ui.mark_read();
        ui.mark_read();
    });
    assert_eq!(shared_reads(&rt), [3]);

    // A runtime too old to keep read counts is not asked.
    let mut rt = render(scenes::unread, false);
    click(&mut rt, "rd-session-s-1");
    rt.update(|ui, _| ui.mark_read());
    assert!(shared_reads(&rt).is_empty());
}

#[test]
fn a_subscription_signs_in_through_the_providers_form() {
    let mut rt = render(scenes::settings_providers_sign_in, false);
    let text = screen_text(&rt);
    assert!(text.contains("Connect OpenAI"), "{text}");
    assert!(text.contains("Open it again"));
    // The page opens by itself when the runtime reports it, once however
    // often the sign-in is reported.
    let waiting = || {
        Event::ProviderSignIn {
        bot_id: "default".into(),
        sign_in: serde_json::from_value(serde_json::json!({
            "id": "sign-in-1", "provider": "openai", "name": "OpenAI 1",
            "status": "waiting",
            "events": [{"type": "auth_url", "url": "https://auth.openai.com/oauth/authorize?state=x"}],
            "prompt": {"id": "p-1", "type": "manual_code", "message": "Paste the final redirect URL here:"}
        }))
        .unwrap(),
    }
    };
    deliver(&mut rt, waiting());
    deliver(&mut rt, waiting());
    assert_eq!(
        rt.state.opened,
        ["https://auth.openai.com/oauth/authorize?state=x"]
    );
    // No key field: a subscription signs in instead.
    assert!(rt.find("rd-connection-key").is_none());
    assert!(rt.find("rd-connection-save").is_none());

    // The pasted address goes as the answer to the question asked, and
    // the field forgets it.
    rt.update(|ui, _| {
        ui.providers.answer =
            TextEdit::new("http://127.0.0.1:1455/auth/callback?code=c&state=x").secure();
    });
    settle(&mut rt);
    click(&mut rt, "rd-sign-in-continue");
    let answered = rt.state.sent.iter().find_map(|command| match command {
        Command::AnswerProviderSignIn {
            id,
            prompt_id,
            value,
            ..
        } => Some((id.clone(), prompt_id.clone(), value.expose().to_owned())),
        _ => None,
    });
    assert_eq!(
        answered,
        Some((
            "sign-in-1".into(),
            "p-1".into(),
            "http://127.0.0.1:1455/auth/callback?code=c&state=x".into()
        ))
    );
    assert!(rt.state.providers.answer.text.is_empty());

    // Connected: the form closes and the settings are loaded again.
    deliver(
        &mut rt,
        Event::ProviderSignIn {
            bot_id: "default".into(),
            sign_in: serde_json::from_value(serde_json::json!({
                "id": "sign-in-1", "provider": "openai", "name": "OpenAI 1",
                "status": "connected", "events": [], "connectionId": "openai_1"
            }))
            .unwrap(),
        },
    );
    assert!(rt.state.providers.open.is_none());
    assert!(rt.state.sent.contains(&Command::LoadSettings {
        bot_id: "default".into()
    }));
    assert!(screen_text(&rt).contains("Signed in."));
}

#[test]
fn closing_a_sign_in_form_cancels_it_and_a_new_one_starts_with_its_name() {
    let mut rt = render(scenes::settings_providers_sign_in, false);
    click(&mut rt, "rd-connection-close");
    assert!(rt.state.sent.contains(&Command::CancelProviderSignIn {
        bot_id: "default".into(),
        id: "sign-in-1".into()
    }));
    assert!(rt.state.model.sign_in.is_none());

    // Again: choosing OpenAI renames the suggestion and the button starts.
    rt.update(|ui, _| {
        ui.add_connection("default");
        ui.choose_connection_provider("openai");
    });
    settle(&mut rt);
    assert_eq!(rt.state.providers.name.text, "OpenAI 1");
    assert!(screen_text(&rt).contains("Sign in with ChatGPT"));
    click(&mut rt, "rd-sign-in-start");
    assert!(rt.state.sent.contains(&Command::StartProviderSignIn {
        bot_id: "default".into(),
        provider: "openai".into(),
        name: "OpenAI 1".into(),
        connection_id: None
    }));
}

#[test]
fn an_expired_subscription_asks_to_sign_in_again() {
    // Tall enough for the third card and its form.
    let mut rt = render_sized(
        scenes::settings_providers_subscription,
        false,
        (1280.0, 1800.0),
    );
    assert!(rt.find("rd-connection-sign-in-badge-openai_1").is_some());
    click(&mut rt, "rd-connection-edit-openai_1");
    assert!(rt.find("rd-sign-in-expired").is_some());
    click(&mut rt, "rd-sign-in-start");
    assert!(rt.state.sent.contains(&Command::StartProviderSignIn {
        bot_id: "default".into(),
        provider: "openai".into(),
        name: "ChatGPT".into(),
        connection_id: Some("openai_1".into())
    }));
}

/// The text shown inside the element keyed `key` (its first text child).
fn text_inside(rt: &Runtime<Ui>, key: &str) -> ElementInfo {
    let elements = rt.elements();
    let parent = elements
        .iter()
        .position(|e| e.key.as_deref() == Some(key))
        .unwrap_or_else(|| panic!("no element keyed {key}"));
    elements
        .into_iter()
        .find(|e| e.parent == Some(parent) && e.text.is_some())
        .unwrap_or_else(|| panic!("no text in {key}"))
}

#[test]
fn the_context_ring_says_how_full_the_models_context_is() {
    for dark in [false, true] {
        // Unknown until the bot's models load: no ring.
        let rt = render(scenes::conversation, dark);
        assert!(rt.find("rd-context").is_none());

        // The latest model call used 1,210 of the model's million tokens;
        // the conversation's three calls used 1,938 and cost $0.0127.
        let rt = render(scenes::composer, dark);
        let ring = element(&rt, "rd-context");
        assert_eq!(
            ring.label.as_deref(),
            Some("Context: 1.2k of 1M tokens (0%). This conversation: 1,938 tokens, $0.01.")
        );
        let help = ring.help.unwrap_or_default();
        assert!(
            help.starts_with("Context: 1.2k of 1M tokens (0%)"),
            "{help}"
        );
        assert!(
            help.ends_with("This conversation: 1,938 tokens, $0.01"),
            "{help}"
        );
        // It sits between the permissions and Send.
        let x = |key: &str| element(&rt, key).rect[0];
        assert!(x("rd-permissions") < x("rd-context") && x("rd-context") < x("rd-send"));

        let rt = render(scenes::composer_context, dark);
        assert!(
            element(&rt, "rd-context")
                .label
                .unwrap_or_default()
                .starts_with("Context: 620k of 1M tokens (62%).")
        );
        let rt = render(scenes::composer_nearly_full, dark);
        assert!(
            element(&rt, "rd-context")
                .label
                .unwrap_or_default()
                .starts_with("Context: 850k of 1M tokens (85%).")
        );
    }
    // A new conversation has used nothing yet, and has spent nothing.
    let mut rt = render(scenes::new_conversation, false);
    deliver(
        &mut rt,
        Event::BotSettings {
            bot_id: "default".into(),
            settings: Box::new(scenes::model_settings()),
        },
    );
    assert_eq!(
        element(&rt, "rd-context").label.as_deref(),
        Some("Context: 0 of 1M tokens (0%).")
    );
}

#[test]
fn the_model_button_drops_the_makers_name() {
    let mut rt = render(scenes::composer, false);
    assert_eq!(
        text_inside(&rt, "rd-model").text.as_deref(),
        Some("Claude Fable Latest")
    );
    click(&mut rt, "rd-model");
    click(&mut rt, "rd-model-choice-c-router:anthropic/claude-opus");
    deliver(
        &mut rt,
        Event::ModelChosen {
            session_id: "s-1".into(),
            model: ModelSelection {
                provider: "c-router".into(),
                model_id: "anthropic/claude-opus".into(),
            },
        },
    );
    // A screen reader still hears the whole name.
    assert_eq!(
        element(&rt, "rd-model").label.as_deref(),
        Some("Choose model: Anthropic: Claude Opus")
    );
    assert_eq!(
        text_inside(&rt, "rd-model").text.as_deref(),
        Some("Claude Opus")
    );
}

#[test]
fn full_access_reads_in_the_attention_colour() {
    for (dark, amber) in [(false, "#a2670f"), (true, "#e0a54a")] {
        let rt = render(scenes::composer, dark);
        let ask = text_inside(&rt, "rd-permissions");
        assert_eq!(ask.text.as_deref(), Some("Ask"));
        assert_ne!(&ask.text_color.unwrap().hex()[..7], amber);
        let rt = render(scenes::composer_full_access, dark);
        let full = text_inside(&rt, "rd-permissions");
        assert_eq!(full.text.as_deref(), Some("Full access"));
        assert_eq!(&full.text_color.unwrap().hex()[..7], amber);
    }
}

#[test]
fn the_composer_toolbar_stays_one_row_in_the_smallest_window() {
    // The window's smallest size, and the default.
    for size in [(960.0, 560.0), (1280.0, 800.0)] {
        let rt = render_sized(scenes::composer_full_access, false, size);
        let card = element(&rt, "rd-composer-card").rect;
        let controls = [
            "rd-attach",
            "rd-model",
            "rd-permissions",
            "rd-context",
            "rd-send",
        ];
        let rects: Vec<[f32; 4]> = controls.iter().map(|key| element(&rt, key).rect).collect();
        let middle = |r: &[f32; 4]| r[1] + r[3] / 2.0;
        for (key, rect) in controls.iter().zip(&rects) {
            assert!(
                (middle(rect) - middle(&rects[0])).abs() < 1.0,
                "{key} left the row at {size:?}: {rect:?}"
            );
            assert!(rect[0] + rect[2] <= card[0] + card[2], "{key} overflows");
        }
        // In order, none overlapping the next.
        for pair in rects.windows(2) {
            assert!(pair[0][0] + pair[0][2] <= pair[1][0] + 0.5, "{pair:?}");
        }
        // The permissions keep their whole name.
        assert_eq!(
            text_inside(&rt, "rd-permissions").text.as_deref(),
            Some("Full access")
        );
    }
}

#[test]
fn a_handoff_shows_its_card_and_cancels_once() {
    for dark in [false, true] {
        let mut rt = render(scenes::handoff_working, dark);
        let text = screen_text(&rt);
        assert!(text.contains("Asked Research"));
        assert!(
            text.contains("Research is on it"),
            "the composer says who works"
        );
        assert!(rt.find("rd-turn-t1").is_some());

        click(&mut rt, "rd-handoff-cancel-h-1");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::CancelHandoff {
                bot_id: "default".into(),
                id: "h-1".into(),
            })
        );
        // While the cancel is on its way, a second press sends nothing.
        click(&mut rt, "rd-handoff-cancel-h-1");
        let cancels = rt
            .state
            .sent
            .iter()
            .filter(|c| matches!(c, Command::CancelHandoff { .. }))
            .count();
        assert_eq!(cancels, 1);
    }
}

#[test]
fn a_waiting_handoff_asks_for_review_and_opens_the_other_bot() {
    let mut rt = render(scenes::handoff_waiting, false);
    let text = screen_text(&rt);
    assert!(text.contains("Research is waiting for your approval."));
    assert!(text.contains("Research needs you"));
    click(&mut rt, "rd-handoff-review-h-1");
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("b-research"));
}

#[test]
fn a_result_comes_back_as_the_other_bots_report() {
    let mut rt = render(scenes::handoff_result, false);
    let text = screen_text(&rt);
    assert!(text.contains("Research finished"));
    assert!(text.contains("Hide report"));
    click(&mut rt, "rd-report-toggle-t2");
    assert!(!rt.state.open_reports.contains("t2"));
    assert!(screen_text(&rt).contains("Show report"));
}

#[test]
fn the_composer_lists_every_bot_at_work_waiting_ones_first() {
    let rt = render(scenes::handoff_several, false);
    let text = screen_text(&rt);
    assert!(text.contains("Finance needs you · 3 more working"));
    assert!(text.contains("Handed off 3 tasks"));
    let finance = element(&rt, "rd-delegate-h-4");
    let research = element(&rt, "rd-delegate-h-1");
    assert!(
        finance.rect[1] < research.rect[1],
        "waiting bots come first"
    );
    assert!(rt.find("rd-delegate-review-h-4").is_some());
    assert!(rt.find("rd-delegate-review-h-1").is_none());
}

#[test]
fn the_owner_can_continue_a_task_another_bot_handed_off() {
    let mut rt = render(scenes::handoff_task, false);
    let text = screen_text(&rt);
    assert!(text.contains("Handed off by"));
    assert!(text.contains("What you write here stays here."));
    // The composer is there, under the note.
    let note = element(&rt, "rd-handoff-note");
    let card = element(&rt, "rd-composer-card");
    assert!(
        note.rect[1] < card.rect[1],
        "the note sits above the composer"
    );
    // Full access stays off: each command needs the owner's approval.
    click(&mut rt, "rd-permissions");
    assert!(screen_text(&rt).contains("Not in a task from Raphie"));
    let before = rt.state.sent.len();
    click(&mut rt, "rd-permissions-full");
    assert_eq!(rt.state.sent.len(), before, "full access is not offered");
    rt.update(|ui, _| ui.permissions_open = false);
    settle(&mut rt);
    // The task is done here, never handed on: "@" offers no bots, though
    // Research could hand tasks to Raphie and Writer elsewhere.
    rt.update(|ui, _| {
        ui.model.apply(raphie_core::model::Event::Handoffs {
            bot_id: "b-research".into(),
            list: serde_json::from_value(serde_json::json!({
                "targets": [
                    { "id": "default", "name": "Raphie" },
                    { "id": "b-writer", "name": "Writer" }
                ],
                "items": []
            }))
            .unwrap(),
        });
    });
    settle(&mut rt);
    assert!(!rt.state.handoff_targets().is_empty());
    rt.update(|ui, _| {
        ui.composer = rune::TextEdit::new("Ask @");
        ui.composer.focused = true;
    });
    settle(&mut rt);
    assert!(rt.state.mention_options().is_empty());
    assert!(rt.find("rd-mentions").is_none());
    // "Open Raphie" goes back to the conversation that handed it off.
    click(&mut rt, "rd-handoff-note-open");
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("default"));
    assert!(rt.state.sent.ends_with(&[Command::SelectSession {
        session_id: Some("s-asked".into()),
    }]));
}

#[test]
fn typing_an_at_offers_bots_and_return_completes_the_name() {
    let mut rt = render(scenes::mentions, false);
    assert!(rt.find("rd-mention-b-research").is_some());
    assert!(
        rt.find("rd-mention-b-writer").is_none(),
        "only names that match"
    );
    let enter = KeyEvent {
        key: Key::Enter,
        mods: Default::default(),
    };
    rt.update(|ui, _| {
        assert!(ui.mention_key(&enter));
    });
    settle(&mut rt);
    assert_eq!(rt.state.composer.text, "Ask @Research ");
    assert!(rt.find("rd-mentions").is_none());
    assert!(
        !rt.state
            .sent
            .iter()
            .any(|c| matches!(c, Command::Send { .. })),
        "choosing a bot does not send"
    );
}

#[test]
fn escape_closes_the_at_menu_until_another_at() {
    let mut rt = render(scenes::mentions, true);
    let escape = KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    };
    rt.update(|ui, _| {
        assert!(ui.mention_key(&escape));
    });
    settle(&mut rt);
    assert!(rt.find("rd-mentions").is_none());
    assert!(rt.state.mention_options().is_empty());
}

#[test]
fn a_named_bot_shows_as_its_name_without_the_at() {
    let rt = render(scenes::handoff_several, false);
    // Each chip's label is isolated for screen readers (U+2068 … U+2069).
    let text = screen_text(&rt).replace(['\u{2068}', '\u{2069}'], "");
    assert!(
        text.contains("pricing from Research, a draft from Writer"),
        "{text}"
    );
    assert!(!text.contains("@Writer"));
}

#[test]
fn choosing_a_bot_again_reopens_the_conversation_last_open_with_it() {
    let mut rt = render(scenes::handoff_task, false);
    let research = rt
        .state
        .model
        .conversation
        .as_ref()
        .map(|c| c.session_id.clone())
        .expect("a Research conversation is open");
    // Raphie has no last conversation yet: it opens on a new one.
    click(&mut rt, "rd-bot-default");
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("default"));
    assert!(rt.state.model.conversation.is_none());
    // Back to Research: the conversation that was open, not a new one.
    click(&mut rt, "rd-bot-b-research");
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("b-research"));
    assert_eq!(
        rt.state
            .model
            .conversation
            .as_ref()
            .map(|c| c.session_id.as_str()),
        Some(research.as_str())
    );
    assert!(rt.state.sent.contains(&Command::SelectSession {
        session_id: Some(research.clone()),
    }));
    // "Open Raphie" from a link goes the same way: back to the one last
    // open there.
    click(&mut rt, "rd-bot-default");
    rt.update(|ui, _| ui.select_session(Some("s-raphie")));
    rt.update(|ui, _| ui.choose_bot("b-research"));
    rt.update(|ui, _| ui.open_bot("default", None));
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("default"));
    assert!(rt.state.sent.ends_with(&[Command::SelectSession {
        session_id: Some("s-raphie".into()),
    }]));
}

#[test]
fn a_reply_that_read_another_bots_session_links_to_it() {
    let mut rt = render(scenes::handoff_read, false);
    let text = screen_text(&rt);
    assert!(text.contains("Read from Research"));
    assert!(text.contains("Agent memory research"));
    assert!(text.contains("View in Research"));
    // Under the reply's text, above its time and tokens.
    let pill = element(&rt, "rd-read-h-1");
    let reply = element(&rt, "rd-reply-t2");
    assert!(pill.rect[1] > reply.rect[1]);
    click(&mut rt, "rd-read-h-1");
    assert_eq!(rt.state.model.bot_id.as_deref(), Some("b-research"));
    assert!(rt.state.sent.ends_with(&[Command::SelectSession {
        session_id: Some("s-research".into()),
    }]));
}

#[test]
fn a_summary_of_earlier_messages_shows_above_the_turn_and_opens() {
    let mut rt = render(scenes::compaction, false);
    let text = screen_text(&rt);
    assert!(text.contains("Earlier messages summarized"));
    assert!(text.contains("View summary"));
    assert!(!text.contains("Review the launch plan"));
    // Between the earlier turn and the one that summarized it.
    let pill = element(&rt, "rd-summary-t3");
    assert!(pill.rect[1] > element(&rt, "rd-reply-t2").rect[1]);
    click(&mut rt, "rd-summary-t3");
    let text = screen_text(&rt);
    assert!(text.contains("Hide summary"));
    assert!(text.contains("Review the launch plan question by question."));
    assert!(text.contains("getting long for the model"));
    click(&mut rt, "rd-summary-t3");
    assert!(!screen_text(&rt).contains("Review the launch plan"));
}

#[test]
fn a_bots_question_takes_one_press_and_sends_one_answer() {
    for dark in [false, true] {
        let mut rt = render(scenes::ask, dark);
        let text = screen_text(&rt);
        assert!(text.contains("Waiting for your answer"));
        assert!(text.contains("Dr. Amare has three openings next week. Which one?"));
        assert!(text.contains("Answer in your own words"));

        click(&mut rt, "rd-ask-ask-1-1");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::Answer {
                ask_id: "ask-1".into(),
                answer: AskAnswer::Choice { choice: 1 },
            })
        );
        // The answer shows at once, and the buttons are gone.
        let text = screen_text(&rt);
        assert!(
            text.contains("You picked") && text.contains("Wed 14:00"),
            "{text}"
        );
        assert!(!text.contains("Tue 9:30"));
    }
}

#[test]
fn a_question_takes_the_owners_own_words_and_confirms_with_the_action() {
    let mut rt = render(scenes::ask_own_words, false);
    click(&mut rt, "rd-ask-send-ask-1");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::Answer {
            ask_id: "ask-1".into(),
            answer: AskAnswer::Text {
                text: "Any morning works".into()
            },
        })
    );
    assert!(screen_text(&rt).contains("You answered"));

    let rt = render(scenes::ask_rows, true);
    let text = screen_text(&rt);
    assert!(text.contains("Bole") && text.contains("12 minutes away"));

    let rt = render(scenes::ask_confirm, false);
    let text = screen_text(&rt);
    assert!(text.contains("Delete 214") && text.contains("Keep them"));

    let text = screen_text(&render(scenes::ask_answered, false));
    assert!(text.contains("You picked") && text.contains("Wed 14:00"));
}

#[test]
fn a_card_shows_under_its_reply_and_its_links_open_the_browser() {
    for dark in [false, true] {
        let mut rt = render(scenes::card_list, dark);
        let text = screen_text(&rt);
        assert!(text.contains("Seven open, one blocked on the vendor."));
        for part in [
            "AF board · open",
            "Jira · as of",
            "In progress",
            "AF-512",
            "Retry failed webhook deliveries",
            "High",
            "Waiting on vendor",
            "and 3 more in To do · Open in Jira",
        ] {
            assert!(text.contains(part), "{part} is missing from: {text}");
        }
        // Under the reply only, not under the owner's message as well.
        assert_eq!(text.matches("AF board · open").count(), 1, "{text}");
        click(&mut rt, "rd-card-card-1-title");
        click(&mut rt, "rd-card-card-1-0-0-title");
        click(&mut rt, "rd-card-card-1-more");
        assert_eq!(
            rt.state.opened,
            [
                "https://example.atlassian.net/boards/7",
                "https://example.atlassian.net/browse/AF-512",
                "https://example.atlassian.net/boards/7?status=todo",
            ]
        );
    }
}

#[test]
fn a_board_card_counts_its_columns_and_an_item_card_opens_one_task() {
    for dark in [false, true] {
        let mut rt = render(scenes::card_board, dark);
        let text = screen_text(&rt);
        for part in [
            "ALX - FIT",
            "Fizzy · as of",
            "Priority",
            "In Review",
            "Done",
            "No column",
            "#107",
            "docs",
            "2/5",
            "KB",
            "MT",
            "Due tomorrow",
            "Overdue 3d",
            "7 more in In Review",
        ] {
            assert!(text.contains(part), "{part} is missing from: {text}");
        }
        // A column with nothing in it is counted, not listed.
        assert_eq!(text.matches("Done").count(), 1, "{text}");
        click(&mut rt, "rd-card-card-1-0-0-title");
        assert_eq!(rt.state.opened, ["https://app.fizzy.example/cards/107"]);

        let text = screen_text(&render(scenes::card_item, dark));
        for part in [
            "#107 · Fizzy · as of",
            "Column",
            "Assigned",
            "Kalkidan Betre",
            "Due tomorrow",
            "Board",
            "Fold the notes from the AI 200 update",
            "Steps · 2 of 6",
            "Update the glossary",
            "1 more",
            "4 comments · last from Mara, Nov 12",
        ] {
            assert!(text.contains(part), "{part} is missing from: {text}");
        }
    }
}

#[test]
fn a_card_fits_a_narrow_window() {
    for scene in [scenes::card_narrow, scenes::card_board_narrow] {
        let rt = render_sized(scene, false, (360.0, 900.0));
        // `rect` is [x, y, width, height]. The card clips what overflows
        // it, so its rows' own parts are checked too.
        let card = element(&rt, "rd-card-card-1").rect;
        assert!(
            card[0] >= 0.0 && card[0] + card[2] <= 360.0,
            "the card stays inside the window: {card:?}"
        );
        let inside = rt
            .elements()
            .into_iter()
            .filter(|e| {
                e.key
                    .as_deref()
                    .is_some_and(|key| key.starts_with("rd-card-card-1-"))
            })
            .collect::<Vec<_>>();
        assert!(inside.len() > 3, "the card's rows are keyed");
        for part in inside {
            assert!(
                part.rect[0] >= card[0] && part.rect[0] + part.rect[2] <= card[0] + card[2] + 0.5,
                "{:?} stays inside the card: {:?} in {card:?}",
                part.key,
                part.rect
            );
        }
    }
}

#[test]
fn a_timeline_card_places_now_and_names_each_source() {
    let mut rt = render(scenes::card_timeline, false);
    let text = screen_text(&rt);
    for part in [
        "Work calendar",
        "Personal calendar",
        "Side-project calendar couldn't be read",
        "Standup",
        "Now · ",
        "Free until ",
        "Overlaps",
        "Team farewell call",
    ] {
        assert!(text.contains(part), "{part} is missing from: {text}");
    }
    // The line for now comes after the event that is over.
    assert!(text.find("Standup") < text.find("Now · "), "{text}");
    // A meeting's second link opens too.
    click(&mut rt, "rd-card-card-1-4-link");
    assert_eq!(rt.state.opened, ["https://meet.example.com/abc"]);

    let text = screen_text(&render(scenes::card_sources, true));
    assert!(text.contains("GitHub") && text.contains("Bitbucket") && text.contains("Checks fail"));
}

#[test]
fn a_reply_style_is_chosen_and_saved_with_the_profile() {
    for dark in [false, true] {
        // Tall enough to show the Replies card under the personality and
        // the standing rules.
        let mut rt = render_sized(research_profile, dark, (1280.0, 2200.0));
        assert_eq!(
            rt.state.profile.reply_style,
            ReplyStyle::default(),
            "a bot starts with short replies"
        );
        click(&mut rt, "rd-reply-length-detailed");
        click(&mut rt, "rd-reply-emoji");
        assert_eq!(
            element(&rt, "rd-reply-length-value").text.as_deref(),
            Some("Detailed")
        );
        // The sample reply follows the settings.
        assert_eq!(
            element(&rt, "rd-reply-sample-lead").text.as_deref(),
            Some("Wed 14:00 at Bole clinic works. 🦷")
        );
        assert!(screen_text(&rt).contains("he's away from Friday"));
        assert_eq!(
            element(&rt, "rd-profile-status").text.as_deref(),
            Some("Unsaved changes")
        );
        click(&mut rt, "rd-profile-save");
        let Some(Command::SaveProfile { update, .. }) = rt.state.sent.last().cloned() else {
            panic!("no save was sent");
        };
        assert_eq!(
            update.reply_style,
            ReplyStyle {
                length: ReplyLength::Detailed,
                emoji: true,
                ..ReplyStyle::default()
            }
        );
    }
}

#[test]
fn a_reply_slider_follows_a_drag_along_its_track() {
    let mut rt = render_sized(research_profile, false, (1280.0, 1800.0));
    let [x, y, w, h] = element(&rt, "rd-reply-warmth-track").rect;
    let mid = y + h / 2.0;
    // From the middle stop, dragged past the right end: Warm.
    rt.pointer_down(x + w / 2.0, mid);
    rt.pointer_move(x + w / 2.0 + 20.0, mid);
    rt.pointer_move(x + w + 30.0, mid);
    rt.pointer_up(x + w + 30.0, mid);
    settle(&mut rt);
    assert_eq!(rt.state.profile.reply_style.warmth, ReplyWarmth::Warm);
    // Then dragged back towards the left end: Plain.
    rt.pointer_down(x + w - 12.0, mid);
    rt.pointer_move(x + w - 40.0, mid);
    rt.pointer_move(x + 4.0, mid);
    rt.pointer_up(x + 4.0, mid);
    settle(&mut rt);
    assert_eq!(rt.state.profile.reply_style.warmth, ReplyWarmth::Plain);
    assert_eq!(
        element(&rt, "rd-reply-warmth-value").text.as_deref(),
        Some("Plain")
    );
    // The press focused the slider; the arrow keys step it.
    assert!(element(&rt, "rd-reply-warmth-track").focused);
    for key in [Key::Right, Key::Right, Key::Right] {
        rt.key(KeyEvent {
            key,
            mods: Default::default(),
        });
        settle(&mut rt);
    }
    assert_eq!(rt.state.profile.reply_style.warmth, ReplyWarmth::Warm);
    rt.key(KeyEvent {
        key: Key::Home,
        mods: Default::default(),
    });
    settle(&mut rt);
    assert_eq!(rt.state.profile.reply_style.warmth, ReplyWarmth::Plain);
}

#[test]
fn a_profile_opened_before_its_bot_loads_fills_in_when_it_arrives() {
    fn opened_early(ui: &mut Ui) {
        scenes::settings_account(ui);
        let bots = ui.model.bots.clone();
        let others = bots.into_iter().filter(|b| b.id != "b-research").collect();
        ui.model.apply(Event::Bots(others));
        ui.open_settings(Some(Page::Bot {
            bot_id: "b-research".into(),
            section: BotSection::Profile,
        }));
    }
    let mut rt = render_sized(opened_early, false, (1280.0, 1800.0));
    assert!(rt.state.profile.saved.is_none());
    let mut bots = rt.state.model.bots.clone();
    bots.push(research("Reads and summarises.", 3));
    deliver(&mut rt, Event::Bots(bots));
    assert_eq!(rt.state.profile.personality.text, "Be brief.");
    assert_eq!(rt.state.profile.problem(), None);
    // A change can be saved straight away.
    click(&mut rt, "rd-reply-length-detailed");
    assert!(rt.state.can_save_profile());
}

#[test]
fn you_is_listed_first_under_the_app_and_loads_the_owner() {
    let mut rt = render(scenes::settings_account, false);
    assert!(screen_text(&rt).lines().any(|line| line == "You"));
    assert!(
        !screen_text(&rt).contains("About you"),
        "the page is \"You\""
    );
    let owner = element(&rt, "rd-nav-owner");
    let account = element(&rt, "rd-nav-account");
    assert!(owner.rect[1] < account.rect[1], "You comes first");
    click(&mut rt, "rd-nav-owner");
    assert_eq!(rt.state.screen, Screen::Settings(Page::Owner));
    assert_eq!(rt.state.sent.last(), Some(&Command::LoadOwner));
    assert!(screen_text(&rt).contains("Loading…"));
    deliver(&mut rt, Event::Owner(scenes::owner_profile()));
    assert_eq!(rt.state.owner.name.text, "Hana Girma");
    assert!(rt.find("rd-save-bar").is_none(), "a clean page is quiet");
    assert!(screen_text(&rt).contains("Africa/Addis Ababa"));
}

#[test]
fn about_you_is_edited_saved_and_shown_as_saved() {
    for dark in [false, true] {
        let mut rt = render(scenes::settings_owner, dark);
        click(&mut rt, "rd-owner-call-me-input");
        rt.key(KeyEvent {
            key: Key::Text("!".into()),
            mods: Default::default(),
        });
        settle(&mut rt);
        assert_eq!(rt.state.owner.call_me.text, "Hana!");
        assert_eq!(
            element(&rt, "rd-owner-status").text.as_deref(),
            Some("Unsaved changes")
        );
        click(&mut rt, "rd-owner-save");
        let Some(Command::SaveOwner { owner }) = rt.state.sent.last().cloned() else {
            panic!("no save was sent");
        };
        assert_eq!(owner.call_me, "Hana!");
        assert_eq!(owner.time_zone, "Africa/Addis_Ababa");
        // A second press while saving sends nothing more.
        click(&mut rt, "rd-owner-save");
        let saves = rt
            .state
            .sent
            .iter()
            .filter(|c| matches!(c, Command::SaveOwner { .. }))
            .count();
        assert_eq!(saves, 1);

        let mut saved = scenes::owner_profile();
        saved.call_me = "Hana!".into();
        saved.updated_at = Some(1_794_650_100_000.0);
        deliver(&mut rt, Event::OwnerSaved(saved));
        assert_eq!(
            element(&rt, "rd-owner-status").text.as_deref(),
            Some("Saved. Every bot uses it from its next reply.")
        );
        assert!(!rt.state.owner.is_dirty());
    }
}

#[test]
fn a_time_zone_is_chosen_from_the_list_and_discard_restores_it() {
    let mut rt = render(scenes::settings_owner, false);
    click(&mut rt, "rd-owner-time-zone-value-trigger");
    assert!(rt.state.owner.zones.is_open());
    click(&mut rt, "rd-owner-time-zone-option-none");
    assert_eq!(rt.state.owner.time_zone, "");
    assert!(rt.state.owner.is_dirty());
    click(&mut rt, "rd-owner-discard");
    assert_eq!(rt.state.owner.time_zone, "Africa/Addis_Ababa");
    assert!(rt.find("rd-save-bar").is_none());
}

#[test]
fn a_failed_owner_save_says_why_and_keeps_the_draft() {
    let mut rt = render(scenes::settings_owner_edited, false);
    click(&mut rt, "rd-owner-save");
    deliver(
        &mut rt,
        Event::OwnerSaveFailed {
            message: "Raphie refused the profile.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-owner-error").text.as_deref(),
        Some("Raphie refused the profile.")
    );
    assert_eq!(rt.state.owner.time_zone, "Europe/Berlin");
}

#[test]
fn skills_are_listed_after_mcp_tools_and_turned_on_or_off() {
    let mut rt = render(scenes::settings_account, false);
    let mcp = element(&rt, "rd-nav-default-mcp");
    let skills = element(&rt, "rd-nav-default-skills");
    assert!(mcp.rect[1] < skills.rect[1], "Skills follows MCP tools");
    click(&mut rt, "rd-nav-default-skills");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadSkills {
            bot_id: "default".into()
        })
    );
    deliver(
        &mut rt,
        Event::Skills {
            bot_id: "default".into(),
            items: scenes::skill_list(),
        },
    );
    assert!(screen_text(&rt).contains("3 skills · 1 on."));
    assert!(screen_text(&rt).contains("SKILL.md has no description."));
    click(&mut rt, "rd-skill-literature-review-toggle");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::EnableSkill {
            bot_id: "default".into(),
            name: "literature-review".into(),
            enabled: true,
        })
    );
    // A broken skill cannot be turned on.
    rt.state.model.changing_skill = false;
    let before = rt.state.sent.len();
    click(&mut rt, "rd-skill-notes-toggle");
    assert_eq!(rt.state.sent.len(), before);
}

#[test]
fn a_skill_is_opened_edited_and_saved() {
    for dark in [false, true] {
        let mut rt = render(scenes::settings_skills, dark);
        click(&mut rt, "rd-skill-weekly-report-edit");
        assert_eq!(
            rt.state.sent.last(),
            Some(&Command::LoadSkill {
                bot_id: "default".into(),
                name: "weekly-report".into(),
            })
        );
        assert!(screen_text(&rt).contains("Loading skill…"));
        deliver(
            &mut rt,
            Event::Skill {
                bot_id: "default".into(),
                detail: Box::new(scenes::skill_detail()),
            },
        );
        assert!(rt.find("rd-save-bar").is_none(), "a clean editor is quiet");
        click(&mut rt, "rd-skill-file-1");
        assert_eq!(
            element(&rt, "rd-skill-open-path").text.as_deref(),
            Some("assets/template.md")
        );
        click(&mut rt, "rd-skill-text");
        rt.key(KeyEvent {
            key: Key::Text("!".into()),
            mods: Default::default(),
        });
        settle(&mut rt);
        // Back is refused while there are edits.
        click(&mut rt, "rd-skills-back");
        assert_eq!(
            element(&rt, "rd-skill-status").text.as_deref(),
            Some("Save or discard your changes first.")
        );
        click(&mut rt, "rd-skill-save");
        let Some(Command::SaveSkill {
            bot_id,
            name,
            skill,
            create,
        }) = rt.state.sent.last().cloned()
        else {
            panic!("no save was sent");
        };
        assert_eq!(
            (bot_id.as_str(), name.as_str(), create),
            ("default", "weekly-report", false)
        );
        // Files that are not text are not sent; the runtime keeps them.
        let paths: Vec<_> = skill.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["SKILL.md", "assets/template.md"]);
        deliver(
            &mut rt,
            Event::SkillChanged {
                bot_id: "default".into(),
                outcome: SkillOutcome::Saved(Box::new(scenes::skill_detail())),
            },
        );
        assert_eq!(
            element(&rt, "rd-skill-status").text.as_deref(),
            Some("Saved. The bot uses it from its next message.")
        );
        click(&mut rt, "rd-skills-back");
        assert!(
            rt.find("rd-skill-weekly-report").is_some(),
            "back on the list"
        );
    }
}

#[test]
fn a_new_skill_is_created_from_the_template() {
    let mut rt = render(scenes::settings_skills_new, false);
    assert_eq!(
        element(&rt, "rd-skill-status").text.as_deref(),
        Some("A new skill")
    );
    click(&mut rt, "rd-skill-save");
    let Some(Command::SaveSkill { name, create, .. }) = rt.state.sent.last().cloned() else {
        panic!("no create was sent");
    };
    assert_eq!((name.as_str(), create), ("my-skill", true));
    deliver(
        &mut rt,
        Event::SkillChangeFailed {
            message: "A skill named my-skill already exists.".into(),
        },
    );
    assert_eq!(
        element(&rt, "rd-skill-error").text.as_deref(),
        Some("A skill named my-skill already exists.")
    );
    click(&mut rt, "rd-skill-save");
    let mut created = scenes::skill_detail();
    created.summary.name = "my-skill".into();
    deliver(
        &mut rt,
        Event::SkillChanged {
            bot_id: "default".into(),
            outcome: SkillOutcome::Saved(Box::new(created)),
        },
    );
    assert_eq!(
        rt.state.skills.mode,
        raphie_desktop::skills::SkillsMode::List
    );
}

#[test]
fn skills_are_imported_from_a_github_link() {
    let mut rt = render(scenes::settings_skills_import, false);
    click(&mut rt, "rd-skills-import-replace");
    click(&mut rt, "rd-skills-import-confirm");
    let Some(Command::ImportSkills {
        source, replace, ..
    }) = rt.state.sent.last().cloned()
    else {
        panic!("no import was sent");
    };
    assert_eq!(
        source,
        SkillSource::GitHub {
            url: "https://github.com/acme/skills/tree/main/skills/pdf".into()
        }
    );
    assert!(replace);
    deliver(
        &mut rt,
        Event::SkillChanged {
            bot_id: "default".into(),
            outcome: SkillOutcome::Imported(vec!["pdf".into()]),
        },
    );
    assert!(
        rt.find("rd-skills-import-dialog").is_none(),
        "the dialog closes"
    );
}

#[test]
fn the_skill_editor_grows_with_its_text_and_links_back_from_the_header() {
    let mut rt = render(scenes::settings_skills_editor, false);
    click(&mut rt, "rd-skill-file-0");
    let short = element(&rt, "rd-skill-text-box").rect[3];
    let long: String = (1..=120)
        .map(|n| format!("{n}. A step of the skill.\n"))
        .collect();
    rt.update(move |ui, _| {
        if let Some(editor) = &mut ui.skills.editor {
            editor.files[0].1 = TextEdit::new(long.clone());
        }
    });
    settle(&mut rt);
    let tall = element(&rt, "rd-skill-text-box").rect[3];
    assert!(
        tall > short * 3.0,
        "{short} → {tall}: the box grows with the text"
    );
    // The way back is in the page header, above the skill's name.
    let back = element(&rt, "rd-skills-back");
    let title = rt
        .elements()
        .into_iter()
        .find(|e| e.text.as_deref() == Some("weekly-report"))
        .expect("the header names the skill");
    assert!(back.rect[1] < title.rect[1]);
    click(&mut rt, "rd-skills-back");
    assert!(
        rt.state.skills.editor.is_some(),
        "unsaved edits keep the editor open"
    );
}

/// A new conversation with the default bot's skills loaded.
fn with_skills(ui: &mut Ui) {
    scenes::new_conversation(ui);
    ui.model.apply(Event::Skills {
        bot_id: "default".into(),
        items: scenes::skill_list(),
    });
}

#[test]
fn typing_slash_offers_commands_and_skills() {
    for dark in [false, true] {
        let mut rt = render(with_skills, dark);
        click(&mut rt, "rd-composer");
        rt.paste("/");
        settle(&mut rt);
        assert!(rt.find("rd-slash").is_some());
        assert!(rt.find("rd-slash-new").is_some() && rt.find("rd-slash-model").is_some());
        // Skills that are off or broken are not offered.
        assert!(rt.find("rd-slash-literature-review").is_none());
        assert!(rt.find("rd-slash-notes").is_none());
        rt.paste("we");
        settle(&mut rt);
        assert!(rt.find("rd-slash-new").is_none(), "the list narrows");
        rt.key(KeyEvent {
            key: Key::Enter,
            mods: Default::default(),
        });
        settle(&mut rt);
        assert_eq!(rt.state.composer.text, "/weekly-report ");
        assert!(rt.find("rd-slash").is_none(), "a space closes the menu");
    }
}

#[test]
fn slash_commands_act_without_sending() {
    let mut rt = render(with_skills, false);
    click(&mut rt, "rd-composer");
    rt.paste("/mo");
    settle(&mut rt);
    rt.key(KeyEvent {
        key: Key::Enter,
        mods: Default::default(),
    });
    settle(&mut rt);
    assert!(rt.state.model_picker.open, "/model opens the picker");
    assert_eq!(rt.state.composer.text, "");
    assert!(
        !rt.state
            .sent
            .iter()
            .any(|c| matches!(c, Command::Send { .. })),
        "nothing was sent"
    );
    rt.update(|ui, _| ui.model_picker.open = false);
    settle(&mut rt);
    click(&mut rt, "rd-composer");
    rt.paste("/");
    settle(&mut rt);
    rt.key(KeyEvent {
        key: Key::Escape,
        mods: Default::default(),
    });
    settle(&mut rt);
    assert!(rt.find("rd-slash").is_none(), "Escape closes it");
    rt.paste("n");
    settle(&mut rt);
    assert!(
        rt.find("rd-slash-new").is_some(),
        "typing more opens it again"
    );
}

#[test]
fn a_message_that_invoked_a_skill_shows_the_skill() {
    let rt = render(scenes::conversation_skill, false);
    // A pill's text is set apart with invisible direction marks.
    let shown = screen_text(&rt).replace(['\u{2068}', '\u{2069}'], "");
    assert!(
        shown.contains("weekly-report for the design team"),
        "the skill is named without its slash"
    );
    assert!(!shown.contains("/weekly-report"));
}

#[test]
fn the_slash_menu_says_what_return_does_and_links_to_skills() {
    let mut rt = render(with_skills, false);
    click(&mut rt, "rd-composer");
    rt.paste("/");
    settle(&mut rt);
    let text = screen_text(&rt);
    assert!(text.contains("↵ run") && text.contains("↵ use"));
    click(&mut rt, "rd-slash-manage");
    assert_eq!(
        rt.state.screen,
        Screen::Settings(Page::Bot {
            bot_id: "default".into(),
            section: BotSection::Skills,
        })
    );
    assert_eq!(rt.state.composer.text, "", "the / is not left behind");
}

#[test]
fn slash_new_leaves_an_open_conversation_for_a_new_one() {
    let mut rt = render(scenes::conversation_skill, false);
    rt.update(|ui, _| {
        ui.model.apply(Event::Skills {
            bot_id: "default".into(),
            items: scenes::skill_list(),
        });
    });
    assert!(
        rt.state.model.conversation.is_some(),
        "a conversation is open"
    );
    click(&mut rt, "rd-composer");
    rt.paste("/new");
    settle(&mut rt);
    rt.key(KeyEvent {
        key: Key::Enter,
        mods: Default::default(),
    });
    settle(&mut rt);
    assert!(
        rt.state.model.conversation.is_none(),
        "/new opens a new conversation, as the button does"
    );
    assert_eq!(rt.state.composer.text, "");
}

#[test]
fn a_preset_fills_the_editor_and_self_updates_are_saved_with_the_profile() {
    let mut rt = render_sized(scenes::settings_profile_presets, false, (1280.0, 2600.0));
    // Six cards, three to a row; the bot's own change is named over the
    // editor.
    let candid = element(&rt, "rd-profile-preset-candid");
    let coach = element(&rt, "rd-profile-preset-coach");
    let creative = element(&rt, "rd-profile-preset-creative");
    assert!(coach.rect[1] > candid.rect[1], "a second row");
    assert!(
        (creative.rect[2] - candid.rect[2]).abs() < 0.5,
        "equal widths"
    );
    assert_eq!(
        element(&rt, "rd-profile-revision").text.as_deref(),
        Some("Revision 4 · edited by Research")
    );
    assert!(screen_text(&rt).contains("Pick a starting point above"));

    click(&mut rt, "rd-profile-preset-coach");
    let coach = scenes::personality_presets()[3].personality.clone();
    assert_eq!(rt.state.profile.personality.text, coach);
    assert!(rt.state.profile.is_dirty());

    click(&mut rt, "rd-self-update-owner-switch");
    click(&mut rt, "rd-self-update-skills-switch");
    click(&mut rt, "rd-profile-save");
    let Some(Command::SaveProfile { bot_id, update }) = rt.state.sent.last() else {
        panic!("a save, not {:?}", rt.state.sent.last());
    };
    assert_eq!(bot_id, "b-research");
    assert_eq!(update.personality, coach);
    assert_eq!(update.revision, 4);
    assert_eq!(
        update.self_updates,
        Some(raphie_core::contracts::SelfUpdates {
            personality: true,
            owner: true,
            skills: false,
        })
    );
}

#[test]
fn self_updates_are_hidden_for_a_runtime_too_old_to_say() {
    let mut rt = render_sized(research_profile, false, (1280.0, 2600.0));
    assert!(rt.find("rd-self-updates").is_none());
    assert!(rt.find("rd-profile-presets").is_none(), "no presets loaded");
    deliver(
        &mut rt,
        Event::PersonalityPresets(scenes::personality_presets()),
    );
    assert!(rt.find("rd-profile-presets").is_some());
}

#[test]
fn revision_history_tags_the_bots_changes_and_restores_an_older_one() {
    let mut rt = render_sized(scenes::settings_history_restore, false, (1280.0, 1700.0));
    assert!(rt.find("rd-revision-4-by-bot").is_some());
    assert!(rt.find("rd-revision-4-preset").is_some());
    let text = screen_text(&rt);
    assert!(text.contains("by Research"), "{text}");
    assert!(text.contains("Analyst"), "the preset's name, not its id");
    assert!(text.contains("Restoring one saves it as a new revision."));
    // The current personality has nothing to restore.
    assert!(rt.find("rd-revision-4-restore").is_none());
    click(&mut rt, "rd-revision-3-restore");
    let Some(Command::SaveProfile { bot_id, update }) = rt.state.sent.last() else {
        panic!("a save, not {:?}", rt.state.sent.last());
    };
    assert_eq!(bot_id, "b-research");
    assert_eq!(update.revision, 4, "saved over the current revision");
    assert_eq!(update.personality, scenes::bot_revisions()[0].personality);
    assert_eq!(update.self_updates, None, "the switches are kept");
    assert!(rt.state.model.saving_profile);
}

#[test]
fn a_reply_notes_what_the_bot_changed_with_a_way_to_see_or_undo_it() {
    let mut rt = render(scenes::conversation_self_updates, false);
    let text = screen_text(&rt);
    assert!(text.contains("Updated its personality"), "{text}");
    assert!(text.contains("Updated what it knows about you"));
    // Undo goes back to the revision before the bot's.
    click(&mut rt, "rd-self-update-op-p-undo");
    let Some(Command::SaveProfile { bot_id, update }) = rt.state.sent.last().cloned() else {
        panic!("a save, not {:?}", rt.state.sent.last());
    };
    assert_eq!(bot_id, "default");
    assert_eq!(update.revision, 4);
    assert!(
        update
            .personality
            .starts_with("Be thoughtful and candid. Explain")
    );
    // Once the undo is saved, the bot's change is no longer current.
    let mut undone = rt.state.model.bots[0].clone();
    undone.revision = 5;
    undone.changed_by = Some("owner".into());
    deliver(&mut rt, Event::ProfileSaved(undone));
    assert!(rt.find("rd-self-update-op-p-undo").is_none());
    assert!(rt.find("rd-self-update-op-p-see").is_some());

    click(&mut rt, "rd-self-update-op-p-see");
    assert_eq!(
        rt.state.screen,
        Screen::Settings(Page::Bot {
            bot_id: "default".into(),
            section: BotSection::History,
        })
    );
    let mut rt = render(scenes::conversation_self_updates, false);
    click(&mut rt, "rd-self-update-op-o-review");
    assert_eq!(rt.state.screen, Screen::Settings(Page::Owner));
}

/// The pill keys of the scene's `save_skill` notes, in order.
fn skill_note_keys(rt: &Runtime<Ui>) -> Vec<String> {
    rt.state
        .self_update_notes()
        .iter()
        .map(|note| format!("rd-self-update-{}", note.key()))
        .collect()
}

#[test]
fn a_reply_notes_the_skill_the_bot_saved_with_a_way_to_open_or_undo_it() {
    let mut rt = render(scenes::conversation_skill_notes, false);
    let text = screen_text(&rt);
    assert!(text.contains("New skill"), "{text}");
    assert!(text.contains("release-notes"));
    assert!(text.contains("Updated skill"));
    assert!(text.contains("weekly-report"));
    let [created, edited] = &skill_note_keys(&rt)[..] else {
        panic!("two skill notes");
    };

    click(&mut rt, &format!("{edited}-undo"));
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::UndoSkillChange {
            bot_id: "default".into(),
            id: "c-op-s2".into(),
        })
    );
    assert!(rt.state.model.undoing_skill_change);
    // Once undone, the note says so and offers no second undo.
    let undone = |note: &str| {
        let notes = rt.state.self_update_notes();
        let note = notes.iter().find(|n| n.id == note).unwrap();
        note.key()
    };
    let key = undone("op-s2");
    deliver(&mut rt, Event::SkillChangeUndone { error: None });
    let change = rt.state.model.skill_changes[&key]
        .clone()
        .map(|mut change| {
            change.undoable = false;
            change.undone = true;
            change
        });
    deliver(&mut rt, Event::SkillChangeFound { note: key, change });
    assert!(screen_text(&rt).contains("Undid change to"));
    assert!(rt.find(&format!("{edited}-undo")).is_none());

    click(&mut rt, &format!("{created}-open"));
    assert_eq!(
        rt.state.screen,
        Screen::Settings(Page::Bot {
            bot_id: "default".into(),
            section: BotSection::Skills,
        })
    );
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::LoadSkill {
            bot_id: "default".into(),
            name: "release-notes".into(),
        })
    );
}

#[test]
fn a_skill_note_asks_what_its_call_saved_and_asks_again_when_skills_change() {
    let mut rt = render(scenes::conversation_skill_notes, false);
    let asked = |rt: &Runtime<Ui>| {
        rt.state
            .sent
            .iter()
            .filter(|command| matches!(command, Command::LoadSkillChange { .. }))
            .count()
    };
    // The first event in asks for each note once.
    let listed = rt.state.model.skills["default"].clone();
    deliver(
        &mut rt,
        Event::Skills {
            bot_id: "default".into(),
            items: listed.clone(),
        },
    );
    let before = asked(&rt);
    assert_eq!(before, 2, "each note asked once: {:?}", rt.state.sent);
    // Nothing changed: no new asks.
    deliver(
        &mut rt,
        Event::Skills {
            bot_id: "default".into(),
            items: listed.clone(),
        },
    );
    assert_eq!(asked(&rt), before);
    // The owner saved weekly-report: its change is no longer the bot's.
    let mut items = listed;
    for item in &mut items {
        if item.name == "weekly-report" {
            item.bot_change = None;
        }
    }
    deliver(
        &mut rt,
        Event::Skills {
            bot_id: "default".into(),
            items,
        },
    );
    assert_eq!(asked(&rt), before + 2);
}

#[test]
fn skills_the_bot_wrote_say_so_in_settings() {
    let rt = render(scenes::settings_skills_by_bot, false);
    let author = |name: &str| {
        element(&rt, &format!("rd-skill-{name}-author"))
            .text
            .clone()
    };
    assert!(
        author("release-notes").is_some_and(|text| text.starts_with("Written by Raphie · ")),
        "{:?}",
        author("release-notes")
    );
    assert!(author("weekly-report").is_some_and(|text| text.starts_with("Edited by Raphie · ")));
    assert!(
        rt.find("rd-skill-notes-author").is_none(),
        "the owner's own"
    );
}

#[test]
fn a_self_update_that_saved_nothing_shows_no_note() {
    let mut rt = render(scenes::conversation_self_updates, false);
    // The owner changed the profile again since: the bot's save is gone.
    let mut owner = scenes::owner_profile();
    owner.updated_at = Some(owner.updated_at.unwrap() + 1.0e9);
    deliver(&mut rt, Event::Owner(owner));
    assert!(rt.find("rd-self-update-op-o").is_none());
    // No revision of the bot's: the personality note goes too.
    deliver(
        &mut rt,
        Event::BotHistory {
            bot_id: "default".into(),
            items: vec![],
        },
    );
    assert!(rt.find("rd-self-update-op-p").is_none());
}

#[test]
fn rules_for_every_bot_are_typed_on_you_and_saved_with_the_profile() {
    let mut rt = render_sized(scenes::settings_owner, false, (1280.0, 1700.0));
    assert!(screen_text(&rt).contains("Rules for every bot"));
    assert_eq!(
        element(&rt, "rd-owner-rules-count").text.as_deref(),
        Some("One rule a line · 2 of 20 · Rules say how to work and grant nothing.")
    );
    assert!(rt.find("rd-save-bar").is_none(), "a clean page is quiet");
    // Typing in the box adds to the last rule; Return starts another.
    click(&mut rt, "rd-owner-rules");
    for key in [Key::Enter, Key::Text("- Be brief.".into())] {
        rt.key(KeyEvent {
            key,
            mods: Default::default(),
        });
    }
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-owner-rules-count").text.as_deref(),
        Some("One rule a line · 3 of 20 · Rules say how to work and grant nothing.")
    );
    click(&mut rt, "rd-owner-save");
    let Some(Command::SaveOwner { owner }) = rt.state.sent.last().cloned() else {
        panic!("no save was sent");
    };
    assert_eq!(
        owner.rules,
        Some(vec![
            "Give times on a 12-hour clock, in my time zone.".to_owned(),
            "Leave all-day events out of my schedule.".to_owned(),
            "Be brief.".to_owned(),
        ])
    );
    let mut saved = scenes::owner_profile();
    saved.rules.push("Be brief.".into());
    saved.updated_at = Some(1_794_650_100_000.0);
    deliver(&mut rt, Event::OwnerSaved(saved));
    assert!(!rt.state.owner.is_dirty());
    assert_eq!(
        element(&rt, "rd-owner-rules-count").text.as_deref(),
        Some("One rule a line · 3 of 20 · Rules say how to work and grant nothing.")
    );
}

#[test]
fn too_many_rules_are_refused_before_anything_is_sent() {
    let mut rt = render_sized(scenes::settings_owner, false, (1280.0, 2200.0));
    let many: Vec<String> = (0..21).map(|n| format!("Rule {n}.")).collect();
    rt.update(move |ui, _| ui.owner.rules = TextEdit::new(many.join("\n")));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-owner-rules-count").text.as_deref(),
        Some("Keep to 20 rules; there are 21.")
    );
    assert_eq!(
        element(&rt, "rd-owner-error").text.as_deref(),
        Some("Keep to 20 rules; there are 21.")
    );
    let before = rt.state.sent.len();
    click(&mut rt, "rd-owner-save");
    assert_eq!(rt.state.sent.len(), before, "nothing is sent");
    // One rule too long says which.
    rt.update(|ui, _| ui.owner.rules = TextEdit::new(format!("Be brief.\n{}", "x".repeat(301))));
    settle(&mut rt);
    assert_eq!(
        element(&rt, "rd-owner-rules-count").text.as_deref(),
        Some("Rule 2 is over 300 characters.")
    );
    click(&mut rt, "rd-owner-discard");
    assert!(rt.find("rd-save-bar").is_none());
}

#[test]
fn a_bots_standing_rules_are_saved_with_its_profile_and_follow_the_host() {
    for dark in [false, true] {
        let mut rt = render_sized(scenes::settings_profile_rules, dark, (1280.0, 1700.0));
        assert!(screen_text(&rt).contains("Standing rules"));
        // The card sits between the personality and the replies.
        let rules = element(&rt, "rd-profile-rules-box");
        let personality = element(&rt, "rd-profile-personality-box");
        assert!(personality.rect[1] < rules.rect[1]);
        assert_eq!(
            element(&rt, "rd-profile-rules-count").text.as_deref(),
            Some("One rule a line · 3 of 20 · Rules say how to work and grant nothing.")
        );
        assert_eq!(
            element(&rt, "rd-profile-status").text.as_deref(),
            Some("Unsaved changes")
        );
        click(&mut rt, "rd-profile-save");
        let Some(Command::SaveProfile { bot_id, update }) = rt.state.sent.last().cloned() else {
            panic!("no save was sent");
        };
        assert_eq!(bot_id, "default");
        assert_eq!(
            update.rules,
            Some(vec![
                "Use Executor for my calendar, mail and tickets.".to_owned(),
                "Answer with a card when I ask about my day.".to_owned(),
                "Launch T3 threads with automatic permissions.".to_owned(),
            ])
        );
        // What was saved is shown, at its new revision.
        let mut saved = rt
            .state
            .model
            .bots
            .iter()
            .find(|bot| bot.id == "default")
            .cloned()
            .expect("the default bot");
        saved.rules = update.rules.clone().unwrap();
        saved.revision += 1;
        deliver(&mut rt, Event::ProfileSaved(saved.clone()));
        assert!(!rt.state.profile.is_dirty());
        // The bot saves a rule itself: a clean form follows it.
        let mut bots = rt.state.model.bots.clone();
        for bot in &mut bots {
            if bot.id == "default" {
                *bot = saved.clone();
                bot.rules.push("Never book before 9.".into());
                bot.revision += 1;
            }
        }
        deliver(&mut rt, Event::Bots(bots));
        assert!(
            rt.state
                .profile
                .rules
                .text
                .ends_with("Never book before 9.")
        );
        assert!(!rt.state.profile.is_dirty());
        // A rule too long blocks the save and says why.
        rt.update(|ui, _| ui.profile.rules = TextEdit::new("x".repeat(301)));
        settle(&mut rt);
        assert_eq!(
            element(&rt, "rd-profile-error").text.as_deref(),
            Some("Rule 1 is over 300 characters.")
        );
        assert!(!rt.state.can_save_profile());
        click(&mut rt, "rd-profile-discard");
        assert!(
            rt.state
                .profile
                .rules
                .text
                .ends_with("Never book before 9.")
        );
    }
}

#[test]
fn what_a_connection_is_for_is_typed_saved_and_follows_the_host() {
    let mut rt = render_sized(scenes::settings_mcp, false, (1280.0, 1900.0));
    assert!(screen_text(&rt).contains("What Calendar is for"));
    assert_eq!(
        rt.state.mcp.purposes["mcp-calendar"].edit.text,
        "My work and personal calendars, and booking meetings"
    );
    // Nothing typed: no Save or Discard.
    assert!(rt.find("rd-mcp-mcp-docs-purpose-save").is_none());
    click(&mut rt, "rd-mcp-mcp-docs-purpose-input");
    rt.key(KeyEvent {
        key: Key::Text(" Specs and notes ".into()),
        mods: Default::default(),
    });
    settle(&mut rt);
    assert!(rt.find("rd-mcp-mcp-docs-purpose-discard").is_some());
    // The list arriving again, as it does every few seconds, keeps it.
    deliver(
        &mut rt,
        Event::Mcp {
            bot_id: "default".into(),
            items: scenes::mcp_connections(),
        },
    );
    assert_eq!(
        rt.state.mcp.purposes["mcp-docs"].edit.text,
        " Specs and notes "
    );
    click(&mut rt, "rd-mcp-mcp-docs-purpose-save");
    assert_eq!(
        rt.state.sent.last(),
        Some(&Command::DescribeMcp {
            bot_id: "default".into(),
            id: "mcp-docs".into(),
            purpose: "Specs and notes".into(),
        })
    );
    // A second press while saving sends nothing more.
    let sent = rt.state.sent.len();
    click(&mut rt, "rd-mcp-mcp-docs-purpose-save");
    assert_eq!(rt.state.sent.len(), sent);
    let mut items = scenes::mcp_connections();
    items[1].purpose = Some("Specs and notes".into());
    deliver(
        &mut rt,
        Event::McpChanged {
            bot_id: "default".into(),
            items,
        },
    );
    assert_eq!(
        rt.state.mcp.purposes["mcp-docs"].edit.text,
        "Specs and notes"
    );
    assert!(rt.find("rd-mcp-mcp-docs-purpose-save").is_none());

    // Discard puts the saved text back.
    rt.update(|ui, _| {
        ui.mcp.purposes.get_mut("mcp-calendar").unwrap().edit = TextEdit::new("Something else");
    });
    settle(&mut rt);
    click(&mut rt, "rd-mcp-mcp-calendar-purpose-discard");
    assert!(!rt.state.mcp.purposes["mcp-calendar"].is_changed());
    assert!(rt.find("rd-mcp-mcp-calendar-purpose-save").is_none());
}

#[test]
fn a_purpose_typed_for_a_new_connection_is_sent_with_it() {
    let mut rt = render_sized(scenes::settings_mcp_empty, false, (1280.0, 1500.0));
    rt.update(|ui, _| {
        ui.mcp.name = TextEdit::new("Executor");
        ui.mcp.address = TextEdit::new("https://executor.example.com/mcp");
    });
    settle(&mut rt);
    click(&mut rt, "rd-mcp-purpose-input");
    rt.key(KeyEvent {
        key: Key::Text(" calendar, mail and tickets ".into()),
        mods: Default::default(),
    });
    settle(&mut rt);
    click(&mut rt, "rd-mcp-connect");
    let Some(Command::AddMcp { connection, .. }) = rt.state.sent.last() else {
        panic!("the form is sent");
    };
    assert!(matches!(
        connection,
        NewMcpConnection::Http { purpose: Some(purpose), .. }
            if purpose == "calendar, mail and tickets"
    ));
    // Added: the form is empty again, and the new connection has its field.
    deliver(
        &mut rt,
        Event::McpAdded {
            bot_id: "default".into(),
            items: scenes::mcp_connections(),
        },
    );
    assert!(rt.state.mcp.purpose.text.is_empty());
    assert!(rt.find("rd-mcp-mcp-calendar-purpose-input").is_some());
}
