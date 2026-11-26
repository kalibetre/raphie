//! The inbox: what needs the owner across every bot, in place of the
//! conversation. New replies, actions waiting for approval, and scheduled
//! jobs that ran, newest first.
//!
//! Mirrors `notifications.tsx` and the `.notifications-*` rules in
//! `bot-workspace.css`. The list itself is built in the core
//! (`raphie_core::inbox`).

use raphie_core::contracts::RunStatus;
use raphie_core::inbox::{Item, Kind};
use raphie_core::jobs::run_description;
use rune::{El, ScrollSpec, col, row, text};

use super::Look;
use super::conversation::READING_WIDTH;
use super::roster::plain;
use crate::avatar::bot_avatar;
use crate::format;
use crate::icons;
use crate::state::{InboxFilter, Ui};
use crate::theme::{Theme, font};
use crate::widgets::{icon_button, one_line, pressable};

/// The bar over the inbox: back to the conversation, and what this is.
pub fn header(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    // With the roster hidden, the bar starts right of the window's buttons.
    let left = if s.roster_open {
        24.0
    } else {
        (look.lights + 16.0).max(24.0)
    };
    row()
        .key("rd-inbox-header")
        .w_full()
        .h(44.0)
        .pl(left)
        .pr(24.0)
        .gap(12.0)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        .window_drag()
        .child(pressable(
            icon_button(t, &icons::ARROW_LEFT, 16.0, "Back to conversation").key("rd-inbox-back"),
            true,
            |s: &mut Ui| s.inbox_open = false,
        ))
        .child(
            text("Inbox")
                .role("heading")
                .font(font(14.0, 600.0))
                .color(t.foreground),
        )
        .child(
            text("All bots")
                .font(font(11.0, 400.0))
                .color(t.muted_foreground),
        )
}

pub fn page(s: &Ui, look: &Look) -> El {
    let t = &look.theme;
    let (items, count) = s.notifications();
    let inbox = &s.model.inbox;
    let visible: Vec<&Item> = items
        .iter()
        .filter(|item| match s.inbox_filter {
            InboxFilter::All => true,
            // A finished job's line stands for its reply too.
            InboxFilter::Replies => {
                item.kind == Kind::Reply || (item.kind == Kind::Job && item.session.is_some())
            }
            InboxFilter::Approvals => item.kind == Kind::Approval,
            InboxFilter::Jobs => item.kind == Kind::Job,
        })
        .collect();
    let note = |content: &str| {
        text(content.to_owned())
            .font(font(12.0, 400.0))
            .color(t.muted_foreground)
            .wrap()
            .mt(20.0)
    };

    let mut body = col()
        .key("rd-inbox")
        .w_full()
        .max_w(READING_WIDTH)
        .px(28.0)
        .py(36.0)
        .child(
            row()
                .gap(8.0)
                .items_end()
                .child(
                    text("Notifications")
                        .role("heading")
                        .font(font(23.0, 650.0))
                        .color(t.foreground),
                )
                // `children` takes the none-or-one that `then` gives.
                .children((count > 0).then(|| {
                    text(format!("{count} new"))
                        .key("rd-inbox-count")
                        .font(font(12.0, 500.0))
                        .color(t.muted_foreground)
                        .mb(3.0)
                })),
        )
        .child(tabs(s.inbox_filter, t));
    if inbox.acknowledge_failed {
        body = body.child(
            note("Couldn’t dismiss the update. Please try again.")
                .key("rd-inbox-dismiss-error")
                .role("alert")
                .color(t.error),
        );
    }
    let failed = !inbox.jobs_failed.is_empty();
    if failed {
        body = body.child(
            row()
                .w_full()
                .mt(20.0)
                .gap(8.0)
                .center_y()
                .child(
                    text("Some job updates couldn’t be loaded.")
                        .key("rd-inbox-load-error")
                        .role("alert")
                        .font(font(12.0, 400.0))
                        .color(t.error),
                )
                .child(
                    text("Retry")
                        .key("rd-inbox-retry")
                        .role("button")
                        .font(font(12.0, 500.0))
                        .color(t.accent)
                        .focus_ring(1.0, 1.0, t.accent)
                        .on_press(|s: &mut Ui| s.load_inbox()),
                ),
        );
    }
    if visible.is_empty() && !failed {
        body = body.child(
            note(if s.inbox_filter == InboxFilter::All {
                "You’re all caught up."
            } else {
                "No updates in this view."
            })
            .key("rd-inbox-empty"),
        );
    }
    // Today's first, then everything before.
    let now = format::now_ms();
    let (today, earlier): (Vec<&Item>, Vec<&Item>) = visible
        .into_iter()
        .partition(|item| format::is_today(item.time, now));
    let can_dismiss = !inbox.acknowledging;
    for (label, group) in [("Today", today), ("Earlier", earlier)] {
        if group.is_empty() {
            continue;
        }
        body = body.child(
            text(label)
                .role("heading")
                .font(font(11.0, 600.0))
                .color(t.muted_foreground)
                .mt(24.0)
                .mb(6.0),
        );
        for item in group {
            body = body.child(line(item, can_dismiss, look));
        }
    }
    if inbox.more_jobs() {
        body = body.child(note(
            "Showing the latest job updates for each bot. Dismiss updates to see older ones.",
        ));
    }
    body = body.child(note(
        "Select an update to open its conversation. Approvals stay here until you decide.",
    ));
    col()
        .key("rd-inbox-scroll")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .scroll(ScrollSpec {
            stick_bottom: false,
        })
        .child(col().w_full().items_center().child(body))
}

/// The four filters, underlined like the web's tabs.
fn tabs(chosen: InboxFilter, t: &Theme) -> El {
    let mut tabs = row()
        .role("group")
        .label("Filter notifications")
        .w_full()
        .mt(26.0)
        .gap(24.0)
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border);
    for (filter, key, label) in [
        (InboxFilter::All, "rd-inbox-all", "All"),
        (InboxFilter::Replies, "rd-inbox-replies", "Messages"),
        (InboxFilter::Approvals, "rd-inbox-approvals", "Approvals"),
        (InboxFilter::Jobs, "rd-inbox-jobs", "Jobs"),
    ] {
        let on = filter == chosen;
        let weight = if on { 600.0 } else { 400.0 };
        let mut tab = col()
            .key(key)
            .role("button")
            .label(label)
            .checked(on)
            .gap(10.0)
            .focus_ring(1.0, 2.0, t.accent)
            .child(text(label).font(font(13.0, weight)).color(if on {
                t.foreground
            } else {
                t.muted_foreground
            }))
            .on_press(move |s: &mut Ui| s.inbox_filter = filter);
        // The chosen tab's underline sits on the strip's own line.
        tab = tab.child(row().w_full().h(2.0).radius(2.0).fill(if on {
            t.foreground
        } else {
            rune::Color::TRANSPARENT
        }));
        tabs = tabs.child(tab);
    }
    tabs
}

/// One update: whose it is, what happened, and a way to dismiss a job.
fn line(item: &Item, can_dismiss: bool, look: &Look) -> El {
    let t = &look.theme;
    let failed_run = item
        .run
        .as_ref()
        .filter(|run| run.status == RunStatus::Failed);
    let preview = match (item.kind, &item.session) {
        (Kind::Approval, _) => "Review the proposed action before continuing.".to_owned(),
        (_, Some(session)) => plain(
            session
                .reply_preview
                .as_deref()
                .filter(|reply| !reply.is_empty())
                .unwrap_or(&session.preview),
        ),
        _ => String::new(),
    };
    let late = item.run.as_ref().is_some_and(|run| run.late);
    let mut title = row().gap(7.0).center_y().child(
        text(format!(
            "{}{}",
            item.title(),
            if late { " · Late" } else { "" }
        ))
        .key(format!("rd-notice-{}-title", item.key))
        .font(font(13.0, 400.0))
        .color(t.foreground),
    );
    if let Some(tag) = item.tag() {
        title = title.child(
            row()
                .px(7.0)
                .py(3.0)
                .radius(5.0)
                .fill(t.muted)
                .child(text(tag).font(font(10.0, 400.0)).color(t.foreground)),
        );
    }
    let mut copy = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(4.0)
        .child(
            row()
                .w_full()
                .gap(7.0)
                .center_y()
                .child(
                    text(item.bot_name.clone())
                        .font(font(13.0, 650.0))
                        .color(t.foreground),
                )
                .child(
                    one_line(
                        format!("· {}", item.subject()),
                        font(12.0, 400.0),
                        t.muted_foreground,
                    )
                    .grow(1.0)
                    .min_w(0.0),
                )
                .child(
                    text(format::month_day(item.time))
                        .font(font(11.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(title);
    if let Some(run) = failed_run {
        copy = copy.child(one_line(
            run_description(run),
            font(12.0, 400.0),
            t.muted_foreground,
        ));
    }
    if !preview.is_empty() {
        copy = copy.child(one_line(preview, font(12.0, 400.0), t.muted_foreground));
    }
    let target = row()
        .key(format!("rd-notice-{}", item.key))
        .grow(1.0)
        .min_w(0.0)
        .px(4.0)
        .py(15.0)
        .gap(13.0)
        .child(bot_avatar(&item.bot_id, look.tones.of(&item.bot_id), 34.0))
        .child(copy)
        .child(
            row()
                .size(6.0, 6.0)
                .radius(3.0)
                .mt(6.0)
                .fill(t.primary)
                .a11y_hidden(),
        );
    // Only an update with a conversation behind it can be opened.
    let target = if item.session_id().is_some() {
        let opened = item.clone();
        target
            .role("button")
            .label(format!("{}: {}", item.bot_name, item.title()))
            .hover(t.hover.alpha(0.5))
            .radius(6.0)
            .on_press(move |s: &mut Ui| s.open_notification(&opened))
    } else {
        target
    };
    let mut line = row()
        .w_full()
        .gap(8.0)
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        .child(target);
    if let Some(run) = &item.run {
        let bot_id = item.bot_id.clone();
        let run_id = run.id.clone();
        line = line.child(pressable(
            icon_button(
                t,
                &icons::X,
                14.0,
                &format!("Dismiss update for {}", run.name),
            )
            .key(format!("rd-notice-{}-dismiss", item.key)),
            can_dismiss,
            move |s: &mut Ui| s.dismiss_run(&bot_id, &run_id),
        ));
    }
    line
}
