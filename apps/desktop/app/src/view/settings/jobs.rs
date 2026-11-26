//! Settings → Scheduled jobs: the prompts a bot is given on a schedule,
//! what became of their runs, and the dialog that creates one.
//!
//! Mirrors `job-settings.tsx`, `scheduled-job-card.tsx` and
//! `job-run-history.tsx`, and the `.automation-*` and `.job-*` rules in
//! `shared/styles/settings/automation.css`. The form's state is in
//! `crate::jobs`; the wording and the run history in `raphie_core::jobs`.
//!
//! Three differences from the web. The first run's date and time are typed
//! (`YYYY-MM-DD` and `HH:MM`), where the web has a calendar and a time
//! picker. "Once" and "Recurring" are two buttons, where the web has a
//! drop-down. And older runs load from a button, where the web also loads
//! them as the list is scrolled.

use raphie_core::contracts::{JobRun, ScheduledJob};
use raphie_core::engine::Command;
use raphie_core::jobs::{
    JobAction, RunHistory, is_finished, job_badge, job_interval, last_run_line, run_description,
    run_status,
};
use rune::{El, Tx, col, icon, row, text, text_input};
use rune_kit::Dialog;

use super::parts::{Scope, group_heading, group_with, page, status};
use crate::format::date_time;
use crate::icons;
use crate::jobs::JobForm;
use crate::sections::BotSection;
use crate::state::Ui;
use crate::theme::{Theme, font};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, icon_button, pressable, text_field};

pub fn jobs(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match s.model.jobs.get(bot_id) {
        Some(jobs) => {
            let mut body = vec![scheduled(s, jobs, t), history(s, bot_id, t)];
            if let Some(message) = &s.model.job_message {
                body.push(note(t, message.clone()).key("rd-jobs-message"));
            }
            // While the dialog is open it shows the error itself.
            if let (false, Some(error)) = (s.job.open, &s.model.job_error) {
                body.push(
                    text(error.clone())
                        .key("rd-jobs-error")
                        .role("alert")
                        .font(font(12.5, 500.0))
                        .color(t.error)
                        .wrap(),
                );
            }
            body
        }
        None => vec![loading(s, bot_id, t)],
    };
    dialog(s, look, overlays);
    page(
        "rd-page-jobs",
        "Scheduled jobs",
        &BotSection::Jobs.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

/// The jobs are on their way, or could not be fetched.
fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .jobs_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Scheduled jobs", "Loading jobs…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Scheduled jobs",
        "Could not load jobs.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-jobs-retry"),
            true,
            move |s: &mut Ui| {
                s.model.jobs_error = None;
                s.command(Command::LoadJobs {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// Quiet wrapped text, the web's `.automation-note`.
fn note(t: &Theme, content: impl Into<String>) -> El {
    text(content)
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap()
}

/// A row of buttons that wraps (`.automation-actions`).
fn actions() -> El {
    row().w_full().gap(8.0).flex_wrap().center_y()
}

/// "Scheduled prompts": one card per job.
fn scheduled(s: &Ui, jobs: &[ScheduledJob], t: &Theme) -> El {
    let busy = s.model.changing_job;
    let create = pressable(
        button(
            t,
            Kind::Primary,
            Size::Small,
            Some(&icons::PLUS),
            "Create job",
        )
        .key("rd-jobs-create"),
        true,
        |s: &mut Ui| s.open_job_form(),
    );
    let mut rows: Vec<El> = jobs.iter().map(|job| card(job, busy, t)).collect();
    if rows.is_empty() {
        rows.push(
            row().w_full().padding(20.0).child(
                text("No scheduled jobs yet. Create a reminder or recurring prompt.")
                    .font(font(13.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap()
                    .shrink(),
            ),
        );
    }
    group_with(
        t,
        "Scheduled prompts",
        "Every run posts in the bot's chat, whether the job was made here or in the chat. The runtime must be running; tool actions still need approval.",
        Some(create),
        rows,
    )
}

/// One job: its name and state, its prompt, when it runs, how its last run
/// went, and what can be done to it.
fn card(job: &ScheduledJob, busy: bool, t: &Theme) -> El {
    let key = |part: &str| format!("rd-job-{}-{part}", job.id);
    // A closure that makes the handler for one action on this job. Each
    // handler owns its own copy of the id, because Rune keeps it until the
    // next frame.
    let act = |action: JobAction| {
        let id = job.id.clone();
        move |s: &mut Ui| s.change_job(&id, action)
    };
    let badge = row().px(6.0).py(2.0).radius(6.0).fill(t.muted).child(
        text(job_badge(job))
            .key(key("badge"))
            .font(font(11.0, 400.0).lh(16.0))
            .color(t.muted_foreground),
    );
    let mut schedule = job_interval(job);
    if job.enabled {
        schedule.push_str(&format!(" · Next: {}", date_time(job.next_run_at)));
    }
    let last = match last_run_line(job) {
        // The older wording ends in a colon before the time.
        (line, Some(at)) if job.last_run.is_none() => format!("{line}: {}", date_time(at)),
        (line, Some(at)) => format!("{line} · {}", date_time(at)),
        (line, None) => line,
    };

    let history = job.id.clone();
    let mut buttons = actions()
        .mt(12.0)
        .child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Run history").key(key("history")),
            true,
            move |s: &mut Ui| s.show_runs(Some(history.clone())),
        ))
        .child(pressable(
            button(t, Kind::Outline, Size::Small, None, "Run now").key(key("run")),
            !busy,
            act(JobAction::Run),
        ));
    // A one-time job that ran has nothing to pause or resume.
    if !is_finished(job) {
        let (label, action) = if job.enabled {
            ("Pause", JobAction::Disable)
        } else {
            ("Resume", JobAction::Enable)
        };
        buttons = buttons.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, label).key(key("toggle")),
            !busy,
            act(action),
        ));
    }
    buttons = buttons.child(pressable(
        button(t, Kind::Ghost, Size::Small, None, "Remove").key(key("remove")),
        !busy,
        act(JobAction::Remove),
    ));

    col()
        .key(format!("rd-job-{}", job.id))
        .w_full()
        .px(20.0)
        .py(18.0)
        .child(
            row()
                .w_full()
                .gap(12.0)
                .justify_between()
                .center_y()
                .child(
                    text(job.name.clone())
                        .font(font(14.0, 600.0))
                        .color(t.foreground)
                        .wrap()
                        .shrink(),
                )
                .child(badge),
        )
        .child(
            text(job.prompt.clone())
                .font(font(13.0, 400.0).lh(20.8))
                .color(t.foreground)
                .wrap()
                .my(10.0),
        )
        .child(note(t, schedule))
        .child(note(t, last).key(key("last")))
        .child(buttons)
}

/// "Run history": recent runs, every job's or one job's, with no card
/// around them.
fn history(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let history: &RunHistory = &s.model.runs;
    let mut controls = row().gap(8.0).center_y();
    if history.job_id.is_some() {
        controls = controls.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Show all jobs").key("rd-runs-all"),
            true,
            |s: &mut Ui| s.show_runs(None),
        ));
    }
    controls = controls.child(pressable(
        icon_button(t, &icons::REFRESH_CW, 15.0, "Refresh run history").key("rd-runs-refresh"),
        !history.loading && !history.loading_older,
        // Starts over from the newest runs, as the web's button does.
        |s: &mut Ui| {
            let job_id = s.model.runs.job_id.clone();
            s.show_runs(job_id);
        },
    ));
    let mut section = col().key("rd-runs").w_full().child(group_heading(
        t,
        "Run history",
        "Recent results, including runs from removed jobs.",
        Some(controls),
    ));

    let retry = |key: &str, older: bool| {
        pressable(
            button(t, Kind::Ghost, Size::Small, None, "Retry").key(key),
            true,
            move |s: &mut Ui| s.load_runs(older),
        )
    };
    let line = |message: &str, key: &str| {
        row()
            .w_full()
            .px(2.0)
            .mt(10.0)
            .gap(8.0)
            .center_y()
            .child(note(t, message).key(key).shrink())
    };
    match (&history.runs, &history.error) {
        // Nothing to show yet.
        (None, None) => section = section.child(line("Loading run history…", "rd-runs-loading")),
        (None, Some(_)) => {
            section = section.child(
                line("Could not refresh run history.", "rd-runs-error")
                    .child(retry("rd-runs-retry", false)),
            );
        }
        (Some(runs), error) => {
            if runs.is_empty() {
                section = section.child(line(
                    "No tracked runs yet. Earlier submissions do not have completion history.",
                    "rd-runs-empty",
                ));
            }
            // The runs on screen stay when a refresh fails.
            if error.is_some() {
                section = section.child(
                    line("Could not refresh the latest runs.", "rd-runs-error")
                        .child(retry("rd-runs-retry", false)),
                );
            }
            let mut list = col().w_full().mt(12.0);
            for run in runs {
                list = list.child(run_row(bot_id, run, t));
            }
            section = section.child(list);
        }
    }
    if history.next.is_some() {
        let mut more = col().w_full().py(12.0).gap(6.0).items_start();
        if history.loading_older {
            more = more.child(note(t, "Loading older runs…"));
        } else {
            let failed = history.older_error.is_some();
            if failed {
                more = more.child(note(t, "Could not load older runs.").key("rd-runs-older-error"));
            }
            more = more.child(pressable(
                button(
                    t,
                    Kind::Ghost,
                    Size::Small,
                    None,
                    if failed {
                        "Retry loading older runs"
                    } else {
                        "Load older runs"
                    },
                )
                .key("rd-runs-older"),
                !history.loading,
                |s: &mut Ui| s.load_runs(true),
            ));
        }
        section = section.child(more);
    }
    section
}

/// One run: the job's name and when it started, how it went, and what to
/// do about it. A run with a conversation opens it when pressed.
fn run_row(bot_id: &str, run: &JobRun, t: &Theme) -> El {
    let status = run_status(run.status);
    let mut state = status.to_owned();
    if run.late {
        state.push_str(" · Late");
    }
    let copy = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(4.0)
        .child(
            row()
                .w_full()
                .gap(12.0)
                .child(
                    text(run.name.clone())
                        .font(font(13.0, 600.0))
                        .color(t.foreground)
                        .wrap()
                        .grow(1.0)
                        .min_w(0.0),
                )
                .child(
                    text(date_time(run.started_at))
                        .font(font(11.0, 400.0))
                        .color(t.muted_foreground),
                ),
        )
        .child(text(state).font(font(12.0, 400.0)).color(t.foreground))
        .child(
            text(run_description(run))
                .font(font(12.0, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    let mut line = row()
        .key(format!("rd-run-{}", run.id))
        .w_full()
        .px(4.0)
        .py(15.0)
        .gap(13.0)
        .items_start()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        .child(
            icon(&icons::CALENDAR_CLOCK, 16.0)
                .color(t.muted_foreground)
                .mt(3.0)
                .a11y_hidden(),
        )
        .child(copy);
    if let Some(session) = &run.session_id {
        let (bot_id, session, turn) = (bot_id.to_owned(), session.clone(), run.turn_id.clone());
        line = line
            .child(
                icon(&icons::ARROW_UP_RIGHT, 15.0)
                    .color(t.muted_foreground)
                    .mt(3.0)
                    .a11y_hidden(),
            )
            .role("button")
            .label(format!("{}, {status}, open in the chat", run.name))
            .focusable(true)
            .radius(6.0)
            .hover(t.hover)
            .focus_ring(2.0, -2.0, t.accent)
            .on_press(move |s: &mut Ui| s.open_message(&bot_id, &session, turn.clone()));
    }
    line
}

/// "Create a job": a modal over the page. Rune keeps focus inside it and
/// hands it back when it closes.
fn dialog(s: &Ui, look: &Look, overlays: &mut Vec<El>) {
    let t = &look.theme;
    let form: &JobForm = &s.job;
    if !form.open {
        return;
    }
    let busy = s.model.changing_job;
    let caption = |content: &str| text(content).font(font(12.0, 550.0)).color(t.foreground);
    let submit = |s: &mut Ui, _: &mut Tx| s.add_job();

    // The prompt is a few lines long, so it is a text area in a box.
    let mut prompt = text_input(&form.prompt, font(12.25, 400.0).lh(19.0))
        .key("rd-job-prompt-input")
        .label("Prompt")
        .w_full()
        .color(t.foreground)
        .placeholder(
            "Summarize the project's open tasks and suggest today's priorities.",
            t.muted_foreground,
        )
        .caret(t.foreground, t.selection())
        .disabled(busy);
    if !busy {
        prompt = prompt
            .on_edit(|s: &mut Ui| &mut s.job.prompt)
            // In a paragraph, Return starts a new line.
            .on_submit(|s: &mut Ui, _: &mut Tx| s.job.prompt.insert("\n"));
    }
    let prompt_box = col()
        .key("rd-job-prompt")
        .w_full()
        .min_h(80.0)
        .padding(10.0)
        .radius(7.0)
        .fill(t.background.alpha(0.5))
        .border(1.0, t.border)
        .child(prompt);

    // "Once" or "Recurring": the chosen one is filled.
    let kind = |repeat: bool| {
        if form.repeat == repeat {
            Kind::Primary
        } else {
            Kind::Outline
        }
    };
    let schedule = row()
        .gap(8.0)
        .child(pressable(
            button(t, kind(false), Size::Small, None, "Once").key("rd-job-once"),
            !busy,
            |s: &mut Ui| s.job.repeat = false,
        ))
        .child(pressable(
            button(t, kind(true), Size::Small, None, "Recurring").key("rd-job-recurring"),
            !busy,
            |s: &mut Ui| s.job.repeat = true,
        ));

    // A caption over a field, taking an equal share of the row.
    let labelled = |label: &str, control: El| {
        col()
            .grow(1.0)
            .min_w(0.0)
            .gap(8.0)
            .child(caption(label))
            .child(control)
    };
    let mut when = row().w_full().gap(16.0).items_start();
    if form.repeat {
        when = when.child(labelled(
            "Repeat every (minutes)",
            text_field(
                t,
                Field {
                    key: "rd-job-minutes",
                    label: "Repeat every (minutes)",
                    placeholder: "60",
                    edit: &form.minutes,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.job.minutes,
                submit,
            ),
        ));
    }
    when = when
        .child(labelled(
            "First run date",
            text_field(
                t,
                Field {
                    key: "rd-job-date",
                    label: "First run date",
                    placeholder: "YYYY-MM-DD",
                    edit: &form.date,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.job.date,
                submit,
            ),
        ))
        .child(labelled(
            "Time (local)",
            text_field(
                t,
                Field {
                    key: "rd-job-time",
                    label: "Time (local)",
                    placeholder: "HH:MM",
                    edit: &form.time,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.job.time,
                submit,
            ),
        ));

    let mut body = col()
        .key("rd-job-form")
        .w_full()
        .px(16.0)
        .pb(16.0)
        .gap(10.0)
        .child(caption("Job name"))
        .child(text_field(
            t,
            Field {
                key: "rd-job-name",
                label: "Job name",
                placeholder: "Morning project brief",
                edit: &form.name,
                disabled: busy,
                compact: true,
            },
            |s: &mut Ui| &mut s.job.name,
            submit,
        ))
        .child(caption("Prompt"))
        .child(prompt_box)
        .child(caption("Schedule"))
        .child(schedule)
        .child(when);
    // What is wrong with the form first, then what the runtime refused.
    let error = form
        .error
        .map(str::to_owned)
        .or_else(|| s.model.job_error.clone());
    if let Some(error) = error {
        body = body.child(
            text(error)
                .key("rd-job-error")
                .role("alert")
                .font(font(12.5, 500.0))
                .color(t.error)
                .wrap(),
        );
    }
    body = body.child(
        actions()
            .child(pressable(
                button(
                    t,
                    Kind::Primary,
                    Size::Regular,
                    None,
                    if busy {
                        "Scheduling…"
                    } else {
                        "Schedule job"
                    },
                )
                .key("rd-job-schedule"),
                !busy && form.is_complete(),
                |s: &mut Ui| s.add_job(),
            ))
            .child(pressable(
                button(
                    t,
                    Kind::Ghost,
                    Size::Regular,
                    None,
                    if form.is_dirty() { "Discard" } else { "Cancel" },
                )
                .key("rd-job-discard"),
                !busy,
                |s: &mut Ui| s.discard_job_form(),
            )),
    );

    Dialog::new("rd-job", "Create a job")
        .description("Times use your local timezone. Recurring jobs repeat at a fixed interval.")
        .width(560.0)
        // As tall as its content, not the kit's standard height.
        .fit()
        .open(true)
        .on_close(|s: &mut Ui| s.close_job_form())
        .child(body)
        .build(&look.kit, overlays);
}
