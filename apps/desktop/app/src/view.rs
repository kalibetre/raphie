//! What the window shows, as a function of state: `view(&Ui) -> El`.
//!
//! Rune calls `view` after every change and diffs the result against the last
//! one, animating whatever moved. A view never changes state itself; buttons
//! carry closures (`on_press`, `on_select`, ...) that Rune runs *between*
//! frames with `&mut Ui`, after which it calls `view` again.
//!
//! Element keys made here start with `rd-`, because rune-kit keys the parts of
//! its components (`label`, `value`, ...) in the same namespace.

use raphie_core::contracts::{
    BotProfile, Decision, RunPhase, SessionApproval, SessionSummary, SessionTurn, TurnStatus,
};
use raphie_core::model::{AuthState, Conversation, StreamStatus};
use rune::{Color, Cx, El, Icon, LiveRegion, ScrollSpec, Tx, col, el, oklch, row, text};
use rune_kit::shell::{RowStatus, Sidebar, SidebarRow, SidebarSection, SplitView, Toolbar};
use rune_kit::{Button, ButtonVariant, Kit, Markdown, Spinner, TextArea, TextInput};

use crate::format;
use crate::state::Ui;

static PLUS: Icon = Icon {
    name: "rd-plus",
    view: 16.0,
    body: r#"<path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"#,
};

/// The widest a line of conversation gets, so text stays readable on wide windows.
const READING_WIDTH: f32 = 760.0;

pub fn view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    // The theme follows the OS: `system_dark` changes when the owner switches
    // appearance, and Rune re-runs the view and springs the colours across.
    let k = Kit::neutral(cx.system_dark());
    match &s.model.auth {
        AuthState::SignedIn => workspace(s, cx, &k),
        _ => sign_in(s, cx, &k),
    }
}

// ───────────────────────────── Sign-in ─────────────────────────────

fn sign_in(s: &Ui, cx: &mut Cx<Ui>, k: &Kit) -> El {
    let c = &k.c;
    let body = match &s.model.auth {
        AuthState::AwaitingApproval(code) => approve_device(code, k),
        state => {
            let connecting = matches!(state, AuthState::Connecting);
            let notice = match state {
                AuthState::SignedOut { notice } => notice.as_deref(),
                _ => None,
            };
            choose_origin(s, connecting, notice, k)
        }
    };
    col()
        .key("rd-sign-in")
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .padding(24.0)
        .pt(cx.titlebar_inset().max(24.0))
        .center()
        // A band along the top moves the window, since the title bar is ours.
        .child(
            el().key("rd-drag")
                .w_full()
                .h(40.0)
                .absolute(0.0, 0.0)
                .window_drag(),
        )
        .child(
            col()
                .key("rd-sign-in-card")
                .w_full()
                .max_w(440.0)
                .gap(18.0)
                .padding(28.0)
                .radius(k.radius.xl)
                .fill(c.surface_raised_base)
                .border(1.0, c.border_muted)
                .child(text("Raphie").font(k.ty.body_medium).color(c.text_base))
                .child(body),
        )
}

fn choose_origin(s: &Ui, connecting: bool, notice: Option<&str>, k: &Kit) -> El {
    let c = &k.c;
    let mut card = col()
        .key("rd-origin")
        .w_full()
        .gap(12.0)
        .child(
            text("Connect this device to your Raphie web host. Use its HTTPS address, or http://127.0.0.1 when it runs on this machine.")
                .font(k.ty.ui)
                .color(c.text_muted)
                .wrap(),
        )
        .child(
            TextInput::new(&s.origin_field)
                .label("Raphie address")
                .placeholder("https://raphie.your-tailnet.ts.net")
                // Kit fields default to a fixed 280 pt; `None` fills the card.
                .width(None)
                .disabled(connecting)
                .on_edit(|s: &mut Ui| &mut s.origin_field)
                .on_submit(|s: &mut Ui, _: &mut Tx| s.connect())
                .build(k)
                .key("rd-origin-field"),
        );
    if let Some(notice) = notice {
        card = card.child(
            text(notice.to_owned())
                .key("rd-sign-in-notice")
                .font(k.ty.ui)
                .color(c.danger.fg)
                .wrap()
                .live_region(LiveRegion::Polite),
        );
    }
    let action = if connecting {
        row()
            .gap(8.0)
            .center_y()
            .child(Spinner::new().build(k))
            .child(text("Connecting…").font(k.ty.ui).color(c.text_muted))
    } else {
        Button::new("Connect")
            .variant(ButtonVariant::Contrast)
            .on_press(|s: &mut Ui| s.connect())
            .build(k)
            .key("rd-connect")
    };
    card.child(row().w_full().justify_end().child(action))
}

fn approve_device(code: &raphie_core::auth::DeviceCode, k: &Kit) -> El {
    let c = &k.c;
    let url = code.verification_url.clone();
    col()
        .key("rd-device")
        .w_full()
        .gap(14.0)
        .child(text("Approve this device").font(k.ty.body_medium).color(c.text_base))
        .child(
            text("Open the approval page, sign in if asked, and check that it shows this code:")
                .font(k.ty.ui)
                .color(c.text_muted)
                .wrap(),
        )
        .child(
            row()
                .w_full()
                .py(14.0)
                .center()
                .radius(k.radius.lg)
                .fill(c.layer_01)
                .border(1.0, c.border_muted)
                .child(
                    text(code.user_code.clone())
                        .key("rd-user-code")
                        .font(rune::TextStyle { size: 26.0, ..k.ty.mono })
                        .color(c.text_base)
                        .selectable(true)
                        .label(format!("Code {}", spell_out(&code.user_code))),
                ),
        )
        .child(
            Button::new("Open approval page")
                .variant(ButtonVariant::Contrast)
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| {
                    if tx.open_url(&url).is_err() {
                        s.model.notice = Some("Could not open a browser. Copy the link below.".into());
                    }
                })
                .build(k)
                .key("rd-open-approval"),
        )
        .child(
            text(code.verification_url.clone())
                .key("rd-approval-link")
                .font(k.ty.small)
                .color(c.text_faint)
                .selectable(true)
                .wrap_anywhere(),
        )
        .child(
            text("Only approve a code shown on a device you have with you. An approved device gets full access to your Raphie.")
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap(),
        )
        .child(
            row()
                .w_full()
                .justify_between()
                .center_y()
                .child(
                    row()
                        .gap(8.0)
                        .center_y()
                        .child(Spinner::new().build(k))
                        .child(text("Waiting for approval…").font(k.ty.ui).color(c.text_muted)),
                )
                .child(
                    Button::new("Cancel")
                        .variant(ButtonVariant::Ghost)
                        .on_press(|s: &mut Ui| {
                            s.command(raphie_core::engine::Command::CancelSignIn)
                        })
                        .build(k)
                        .key("rd-cancel-sign-in"),
                ),
        )
}

/// "WXYZ-1234" read out as "W X Y Z, 1 2 3 4" for screen readers.
fn spell_out(code: &str) -> String {
    code.split('-')
        .map(|part| part.chars().map(String::from).collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join(", ")
}

// ───────────────────────────── Workspace ─────────────────────────────

fn workspace(s: &Ui, cx: &mut Cx<Ui>, k: &Kit) -> El {
    let conversation = s.model.conversation.as_ref();
    let title = conversation
        .and_then(|c| c.observation.as_ref())
        .map(|o| o.session.title.clone())
        .or_else(|| conversation.map(|_| "Loading…".to_owned()))
        .unwrap_or_else(|| "New conversation".to_owned());
    let mut toolbar = Toolbar::new().title(title);
    if let Some(status) = conversation.and_then(stream_label) {
        toolbar = toolbar.trailing(
            text(status)
                .key("rd-stream-status")
                .font(k.ty.small)
                .color(k.c.text_muted)
                .live_region(LiveRegion::Polite),
        );
    }
    SplitView::new(main_pane(s, k))
        .sidebar(&s.sidebar, |s: &mut Ui| &mut s.sidebar, sidebar(s, k))
        .toolbar(toolbar)
        .titlebar_inset(cx.titlebar_inset())
        .frame_inset(8.0)
        .toolbar_in_panel()
        .sidebar_padding(14.0, 10.0)
        .reduced_motion(cx.is_reduced_motion())
        .build(k)
}

fn stream_label(conversation: &Conversation) -> Option<String> {
    match conversation.stream {
        StreamStatus::Live => None,
        StreamStatus::Connecting => Some("Connecting…".into()),
        StreamStatus::Reconnecting => Some("Reconnecting…".into()),
    }
}

fn sidebar(s: &Ui, k: &Kit) -> El {
    let model = &s.model;
    let selected_session = model.conversation.as_ref().map(|c| c.session_id.as_str());
    let new_row = SidebarRow::new("New conversation")
        .icon(&PLUS)
        .height(32.0)
        .selected(selected_session.is_none())
        .on_select(|s: &mut Ui, _: &mut Tx| s.select_session(None))
        .build(k)
        .key("rd-new");

    let bots = SidebarSection::new("Bots")
        .key("rd-bots")
        .rows(model.bots.iter().map(|bot| {
            let id = bot.id.clone();
            SidebarRow::new(bot.name.clone())
                .avatar(avatar(bot, k))
                .height(32.0)
                .selected(model.bot_id.as_deref() == Some(bot.id.as_str()))
                .on_select(move |s: &mut Ui, _: &mut Tx| s.select_bot(&id))
                .build(k)
                .key(format!("rd-bot-{}", bot.id))
        }));

    let now = format::now_ms();
    let mut rows: Vec<El> = model
        .session_list()
        .map(|session| session_row(session, selected_session, now, k))
        .collect();
    if let Some(after) = model.sessions_next.clone() {
        rows.push(
            SidebarRow::new("Show more")
                .height(32.0)
                .on_select(move |s: &mut Ui, _: &mut Tx| {
                    s.command(raphie_core::engine::Command::LoadMoreSessions {
                        after: after.clone(),
                    })
                })
                .build(k)
                .key("rd-more-sessions"),
        );
    }
    let count = rows.len();
    let sessions = SidebarSection::new("Conversations")
        .key("rd-sessions")
        .count(count)
        .rows(rows);

    let origin = model
        .origin
        .as_ref()
        .map(|o| o.to_string())
        .unwrap_or_default();
    let footer = col()
        .key("rd-account")
        .w_full()
        .gap(6.0)
        .px(8.0)
        .py(8.0)
        .child(
            text(origin)
                .font(k.ty.small)
                .color(k.c.text_faint)
                .truncate(),
        )
        .child(
            row().child(
                Button::new("Sign out")
                    .variant(ButtonVariant::GhostMuted)
                    .help("Forget this device's sign-in. Disconnect it in Settings → Account to revoke it.")
                    .on_press(|s: &mut Ui| s.command(raphie_core::engine::Command::SignOut))
                    .build(k)
                    .key("rd-sign-out"),
            ),
        );

    Sidebar::new()
        .label("Raphie")
        .header(new_row)
        .section(bots)
        .section(sessions)
        .footer(footer)
        .build(k)
}

fn session_row(session: &SessionSummary, selected: Option<&str>, now: i64, k: &Kit) -> El {
    let id = session.id.clone();
    let subtitle = if session.waiting {
        "Waiting for approval".to_owned()
    } else if session.working {
        "Working…".to_owned()
    } else {
        session
            .preview
            .lines()
            .next()
            .unwrap_or_default()
            .to_owned()
    };
    let mut row = SidebarRow::new(session.title.clone())
        .height(44.0)
        .subtitle(subtitle)
        .detail(format::ago(session.last_at, now))
        .selected(selected == Some(session.id.as_str()))
        .on_select(move |s: &mut Ui, _: &mut Tx| s.select_session(Some(&id)));
    if session.waiting || session.failed {
        row = row.status(RowStatus::Attention);
    } else if session.working {
        row = row.status(RowStatus::Busy);
    }
    row.build(k).key(format!("rd-session-{}", session.id))
}

/// A bot's initial on its colour (the owner's, else one picked from its id).
fn avatar(bot: &BotProfile, k: &Kit) -> El {
    let fill = bot
        .color
        .as_deref()
        .and_then(rune::color::hex)
        .unwrap_or_else(|| oklch(0.62, 0.11, hue(&bot.id)));
    let initial = bot
        .name
        .chars()
        .next()
        .unwrap_or('?')
        .to_uppercase()
        .to_string();
    row()
        .size(18.0, 18.0)
        .radius(5.0)
        .center()
        .fill(fill)
        .child(text(initial).font(k.ty.small_medium).color(Color::WHITE))
}

fn hue(id: &str) -> f32 {
    let sum: u32 = id.bytes().map(u32::from).sum();
    (sum % 360) as f32
}

// ───────────────────────────── Conversation ─────────────────────────────

fn main_pane(s: &Ui, k: &Kit) -> El {
    let mut pane = col().key("rd-main").w_full().h_full().min_h(0.0);
    if let Some(notice) = &s.model.notice {
        pane = pane.child(notice_banner(notice, k));
    }
    let content = match &s.model.conversation {
        Some(conversation) => transcript(s, conversation, k),
        None => empty_state(s, k),
    };
    pane.child(
        col()
            .key("rd-transcript")
            .w_full()
            .grow(1.0)
            .min_h(0.0)
            // Follow the end while the reply streams in, unless the owner
            // scrolled up to read.
            .scroll(ScrollSpec { stick_bottom: true })
            .child(
                col()
                    .w_full()
                    .px(24.0)
                    .py(20.0)
                    .items_center()
                    .child(col().w_full().max_w(READING_WIDTH).gap(18.0).child(content)),
            ),
    )
    .child(composer(s, k))
}

fn notice_banner(notice: &str, k: &Kit) -> El {
    let c = &k.c;
    row()
        .key("rd-notice")
        .w_full()
        .px(16.0)
        .py(8.0)
        .gap(12.0)
        .center_y()
        .justify_between()
        .fill(c.warning.bg)
        .live_region(LiveRegion::Polite)
        .child(
            text(notice.to_owned())
                .font(k.ty.ui)
                .color(c.warning.fg)
                .wrap()
                .shrink(),
        )
        .child(
            Button::new("Dismiss")
                .variant(ButtonVariant::Ghost)
                .on_press(|s: &mut Ui| s.model.notice = None)
                .build(k)
                .key("rd-dismiss"),
        )
}

fn empty_state(s: &Ui, k: &Kit) -> El {
    let name = s
        .model
        .selected_bot()
        .map_or("Raphie", |b| b.name.as_str())
        .to_owned();
    col()
        .key("rd-empty")
        .w_full()
        .pt(80.0)
        .gap(8.0)
        .items_center()
        .child(
            text(format!("New conversation with {name}"))
                .font(k.ty.body_medium)
                .color(k.c.text_base),
        )
        .child(
            text(
                "Your first message starts a session you can continue from the web workspace, too.",
            )
            .font(k.ty.ui)
            .color(k.c.text_muted)
            .wrap(),
        )
}

fn transcript(s: &Ui, conversation: &Conversation, k: &Kit) -> El {
    let mut items: Vec<El> = Vec::new();
    if conversation.older_cursor().is_some() {
        items.push(
            row().w_full().justify_center().child(
                Button::new(if conversation.loading_older {
                    "Loading…"
                } else {
                    "Show earlier messages"
                })
                .variant(ButtonVariant::Ghost)
                .disabled(conversation.loading_older)
                .on_press(|s: &mut Ui| s.load_older())
                .build(k)
                .key("rd-load-older"),
            ),
        );
    }
    let Some(observation) = &conversation.observation else {
        items.push(
            row()
                .key("rd-loading")
                .w_full()
                .pt(40.0)
                .gap(8.0)
                .center()
                .child(Spinner::new().build(k))
                .child(
                    text("Loading conversation…")
                        .font(k.ty.ui)
                        .color(k.c.text_muted),
                ),
        );
        return col().w_full().gap(18.0).children(items);
    };
    let turns = conversation.turns();
    let live = conversation.live_text();
    // The live reply belongs to the newest pending turn.
    let live_turn = turns
        .iter()
        .rev()
        .find(|t| t.status == TurnStatus::Pending)
        .map(|t| t.id.as_str());
    for turn in &turns {
        items.push(owner_message(turn, k));
        let streaming = (live_turn == Some(turn.id.as_str()))
            .then_some(live)
            .flatten();
        items.push(reply(turn, streaming, observation.phase, k));
    }
    for approval in conversation.pending_approvals() {
        items.push(approval_card(
            approval,
            s.model.deciding.contains(&approval.id),
            k,
        ));
    }
    if let Some(error) = &observation.error {
        items.push(
            text(error.message.clone())
                .key("rd-reply-error")
                .font(k.ty.ui)
                .color(k.c.danger.fg)
                .wrap(),
        );
    }
    col().w_full().gap(18.0).children(items)
}

fn owner_message(turn: &SessionTurn, k: &Kit) -> El {
    let mut bubble = col()
        .max_w(560.0)
        .px(14.0)
        .py(10.0)
        .gap(4.0)
        .radius(k.radius.xl)
        .fill(k.c.layer_02);
    if let Some(job) = &turn.scheduled {
        bubble = bubble.child(
            text(format!("Scheduled · {}", job.name))
                .font(k.ty.small)
                .color(k.c.text_faint),
        );
    }
    row()
        .key(format!("rd-turn-{}", turn.id))
        .w_full()
        .justify_end()
        .child(
            bubble.child(
                text(turn.text.clone())
                    .font(k.ty.body)
                    .color(k.c.text_base)
                    .wrap()
                    .selectable(true),
            ),
        )
}

fn reply(turn: &SessionTurn, live: Option<&str>, phase: RunPhase, k: &Kit) -> El {
    let key = format!("rd-reply-{}", turn.id);
    if let Some(answer) = &turn.answer {
        return col()
            .key(key)
            .w_full()
            .child(Markdown::new(answer.as_str()).selectable(true).build(k));
    }
    let c = &k.c;
    match turn.status {
        TurnStatus::Pending => match live {
            Some(text) if !text.is_empty() => col().key(key).w_full().child(
                Markdown::new(text)
                    .streaming(true)
                    .selectable(true)
                    .build(k),
            ),
            _ => row()
                .key(key)
                .gap(8.0)
                .center_y()
                .child(Spinner::new().build(k))
                .child(text(phase_label(phase)).font(k.ty.ui).color(c.text_muted))
                .live_region(LiveRegion::Polite),
        },
        TurnStatus::Error if turn.cancelled == Some(true) => {
            text("Stopped.").key(key).font(k.ty.ui).color(c.text_faint)
        }
        TurnStatus::Error => text("The reply failed.")
            .key(key)
            .font(k.ty.ui)
            .color(c.danger.fg),
        TurnStatus::Done | TurnStatus::Unknown => el().key(key),
    }
}

fn phase_label(phase: RunPhase) -> &'static str {
    match phase {
        RunPhase::Queued => "Queued…",
        RunPhase::Writing => "Writing reply…",
        RunPhase::Tool => "Running a tool…",
        RunPhase::Approval => "Waiting for your approval",
        _ => "Waiting for model…",
    }
}

fn approval_card(approval: &SessionApproval, deciding: bool, k: &Kit) -> El {
    let c = &k.c;
    let approve_id = approval.id.clone();
    let reject_id = approval.id.clone();
    let now = format::now_ms();
    col()
        .key(format!("rd-approval-{}", approval.id))
        .role("group")
        .label(format!(
            "Approval needed: {} {}",
            approval.server, approval.tool
        ))
        .w_full()
        .gap(10.0)
        .padding(14.0)
        .radius(k.radius.lg)
        .fill(c.layer_01)
        .border(1.0, c.warning.border)
        .child(
            row()
                .w_full()
                .justify_between()
                .center_y()
                .child(
                    text("Approval needed")
                        .font(k.ty.ui_medium)
                        .color(c.text_base),
                )
                .child(
                    text(format::expires_in(approval.expires_at, now))
                        .font(k.ty.small)
                        .color(c.text_muted),
                ),
        )
        .child(
            text(format!("{} · {}", approval.server, approval.tool))
                .font(k.ty.mono)
                .color(c.text_base),
        )
        .child(
            // The exact arguments the action will run with.
            col()
                .key(format!("rd-approval-args-{}", approval.id))
                .w_full()
                .max_h(220.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .radius(k.radius.md)
                .fill(c.bg_base)
                .border(1.0, c.border_muted)
                .child(
                    text(approval.arguments_pretty())
                        .font(k.ty.mono)
                        .color(c.text_base)
                        .selectable(true)
                        .wrap_anywhere()
                        .padding(10.0),
                ),
        )
        .child(
            row()
                .gap(8.0)
                .child(
                    Button::new("Approve")
                        .variant(ButtonVariant::Contrast)
                        .disabled(deciding)
                        .on_press(move |s: &mut Ui| s.decide(&approve_id, Decision::Approved))
                        .build(k)
                        .key(format!("rd-approve-{}", approval.id)),
                )
                .child(
                    Button::new("Reject")
                        .variant(ButtonVariant::Outline)
                        .disabled(deciding)
                        .on_press(move |s: &mut Ui| s.decide(&reject_id, Decision::Rejected))
                        .build(k)
                        .key(format!("rd-reject-{}", approval.id)),
                ),
        )
}

fn composer(s: &Ui, k: &Kit) -> El {
    let name = s.model.selected_bot().map_or("Raphie", |b| b.name.as_str());
    let empty = s.composer.text.trim().is_empty();
    col()
        .key("rd-composer-area")
        .w_full()
        .px(24.0)
        .pt(8.0)
        .pb(16.0)
        .items_center()
        .child(
            col()
                .w_full()
                .max_w(READING_WIDTH)
                .gap(8.0)
                .child(
                    TextArea::new(&s.composer)
                        .label("Message")
                        .placeholder(format!("Message {name}…"))
                        .width(None)
                        .auto_grow(1, 8)
                        .on_edit(|s: &mut Ui| &mut s.composer)
                        // Return sends; Shift-Return types a newline.
                        .on_submit(|s: &mut Ui, _: &mut Tx| s.send())
                        .build(k)
                        .key("rd-composer"),
                )
                .child(
                    row()
                        .w_full()
                        .justify_between()
                        .center_y()
                        .child(
                            text("Return to send · Shift-Return for a new line")
                                .font(k.ty.small)
                                .color(k.c.text_faint),
                        )
                        .child(
                            Button::new(if s.model.sending {
                                "Sending…"
                            } else {
                                "Send"
                            })
                            .variant(ButtonVariant::Submit)
                            .disabled(s.model.sending || empty)
                            .on_press(|s: &mut Ui| s.send())
                            .build(k)
                            .key("rd-send"),
                        ),
                ),
        )
}
