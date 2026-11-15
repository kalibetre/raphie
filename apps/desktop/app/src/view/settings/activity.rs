//! Settings → Activity: every step a bot took, across its conversations,
//! newest first.
//!
//! Mirrors `bot-activity.tsx` and `activity.tsx`. The filter's rule is in
//! the core (`raphie_core::inspection`).
//!
//! Two differences from the web. "Export activity" saves the JSON straight
//! into this machine's Downloads folder. And the line under the filter
//! shows this machine's offset from UTC, where the web names the time zone.

use raphie_core::contracts::ActivityEvent;
use raphie_core::inspection::{event_matches, is_failure, pretty_json};
use rune::{El, col, text};

use super::diagnostics::export_notice;
use super::inspect::{Entry, empty, entry, filter_box, heading, meta};
use super::parts::{Scope, page};
use crate::format::{iso_utc, time_millis, utc_offset};
use crate::icons;
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{icon_button, pressable};

pub fn activity(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let failed = s.model.activity_failed.as_deref() == Some(bot_id);
    let body = match s.model.activity.get(bot_id) {
        Some(events) => journal(s, events, t),
        // Nothing loaded yet: say so, or that the load failed. The page
        // asks again by itself every few seconds.
        None => text(if failed {
            "Couldn’t load activity. It will retry automatically."
        } else {
            "Loading activity…"
        })
        .key("rd-activity-status")
        .font(font(12.5, 400.0))
        .color(t.muted_foreground)
        .wrap(),
    };
    page(
        "rd-page-activity",
        "Activity",
        &BotSection::Activity.lede(name),
        Scope::Bot { id: bot_id, name },
        vec![body],
        look,
    )
}

/// "Recent events": the filter and one row per event.
fn journal(s: &Ui, events: &[ActivityEvent], t: &Theme) -> El {
    let filter = s.events.filter.text.as_str();
    // The runtime lists the oldest first; the page shows the newest first.
    let visible: Vec<&ActivityEvent> = events
        .iter()
        .rev()
        .filter(|event| event_matches(event, filter))
        .collect();
    let export = pressable(
        icon_button(t, &icons::DOWNLOAD, 16.0, "Export activity").key("rd-activity-export"),
        !s.model.exporting,
        |s: &mut Ui| s.export_activity(),
    );
    let section = col()
        .key("rd-activity")
        .w_full()
        .child(heading(
            t,
            "Recent events",
            14.0,
            "Newest first, across this bot’s conversations.",
            export,
        ))
        .child(filter_box(
            t,
            "rd-activity-filter",
            "Filter activity",
            "Filter events…",
            &s.events.filter,
            |s: &mut Ui| &mut s.events.filter,
        ))
        .child(meta(
            t,
            "rd-activity-count",
            format!("{} events", visible.len()),
            utc_offset(),
        ))
        .child(export_notice(s, t));
    if visible.is_empty() {
        return section.child(empty(
            t,
            "rd-activity-empty",
            &icons::ACTIVITY,
            None,
            if filter.trim().is_empty() {
                "Activity will appear here when you start a conversation."
            } else {
                "No matching events."
            },
        ));
    }
    let dash = |value: &Option<String>| value.clone().unwrap_or_else(|| "—".to_owned());
    let mut list = col().w_full().pb(16.0);
    for event in visible {
        let id = event.id.to_string();
        let toggle = id.clone();
        list = list.child(entry(
            t,
            Entry {
                key: format!("rd-event-{id}"),
                summary: &event.summary,
                timing: None,
                time: time_millis(event.at),
                failed: is_failure(event),
                open: s.events.open.contains(&id),
                facts: vec![
                    ("Event", event.kind.clone()),
                    ("UTC", iso_utc(event.at)),
                    ("Run", dash(&event.run_id)),
                    ("Attempt", event.attempt_id.clone()),
                    ("Operation", dash(&event.operation_id)),
                    ("Plugin", dash(&event.plugin_id)),
                ],
                code: pretty_json(&event.details_json),
            },
            move |s: &mut Ui| Ui::toggle(&mut s.events.open, &toggle),
        ));
    }
    section.child(list)
}
