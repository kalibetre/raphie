//! Settings → Scheduled jobs: what a new job carries, what can be done to
//! a saved one, how jobs and their runs are described, and the run history
//! on screen.
//!
//! The limits are the runtime's (`routes.ts` in
//! `packages/runtime/src/domains/schedules/presentation/http`). The wording
//! follows the web's `scheduled-job-card.tsx` and `job-run-status.ts`.

use serde::Serialize;

use crate::contracts::{FailureReason, JobRun, LastStatus, Page, RunStatus, ScheduledJob};

/// A job to schedule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewJob {
    pub name: String,
    /// What the bot is asked each time the job runs.
    pub prompt: String,
    /// How often it repeats; `None` runs it once.
    pub every_minutes: Option<u32>,
    /// When it first runs, in milliseconds since the Unix epoch.
    pub first_run_at: i64,
}

impl NewJob {
    /// What is wrong with this job, if anything, in words for the owner.
    pub fn problem(&self) -> Option<&'static str> {
        if self.name.is_empty() || self.name.chars().count() > 80 {
            return Some("A job name is 1 to 80 characters.");
        }
        if self.prompt.is_empty() || self.prompt.chars().count() > 4000 {
            return Some("A prompt is 1 to 4,000 characters.");
        }
        // A year of minutes is the longest interval the runtime takes.
        if self
            .every_minutes
            .is_some_and(|minutes| !(1..=525_600).contains(&minutes))
        {
            return Some("Repeat every 1 to 525,600 minutes.");
        }
        if self.first_run_at < 0 {
            return Some("Choose a valid first-run time.");
        }
        None
    }
}

/// What can be done to a saved job.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobAction {
    /// Resume a paused job.
    Enable,
    /// Pause it.
    Disable,
    Remove,
    /// Run it now, whatever its schedule.
    Run,
    /// Stand behind a job saved before Raphie recorded who makes one, so
    /// its runs follow the chat's permission mode.
    Confirm,
}

/// Whether a one-time job has had its run: it is neither active nor
/// something to resume.
pub fn is_finished(job: &ScheduledJob) -> bool {
    job.every_minutes.is_none() && !job.enabled && job.last_run_at.is_some()
}

/// The word in a job's badge.
pub fn job_badge(job: &ScheduledJob) -> &'static str {
    if job.last_run.as_ref().is_some_and(|run| run.waiting_for_bot) {
        "Waiting for bot"
    } else if job.enabled {
        "Active"
    } else if !is_finished(job) {
        "Paused"
    } else if let Some(run) = &job.last_run {
        run_status(run.status)
    } else if job.last_status == Some(LastStatus::Submitted) {
        "Sent"
    } else {
        "Failed"
    }
}

/// How often a job runs: "One-time reminder" or "Every 30 minutes".
pub fn job_interval(job: &ScheduledJob) -> String {
    match job.every_minutes {
        None => "One-time reminder".to_owned(),
        Some(1) => "Every 1 minute".to_owned(),
        Some(minutes) => format!("Every {minutes} minutes"),
    }
}

/// What a job's last run was, without its time: the view adds that.
/// Returns the sentence and the time it is about, if there was a run.
pub fn last_run_line(job: &ScheduledJob) -> (String, Option<i64>) {
    if let Some(run) = &job.last_run {
        return (
            format!("Last run: {}", run_status(run.status)),
            Some(run.started_at),
        );
    }
    match job.last_run_at {
        // Runs from before the runtime kept their outcome.
        Some(at) if job.last_status == Some(LastStatus::Submitted) => (
            "Earlier prompt submitted · completion not tracked".to_owned(),
            Some(at),
        ),
        Some(at) => (
            "Last submission failed · check the bot's model connection".to_owned(),
            Some(at),
        ),
        None => ("No runs yet".to_owned(), None),
    }
}

/// A run's status as one word.
pub fn run_status(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "Queued",
        RunStatus::Running => "Running",
        RunStatus::Completed => "Completed",
        RunStatus::Failed => "Failed",
        RunStatus::Interrupted => "Interrupted",
        RunStatus::Unknown => "Unknown",
    }
}

/// One sentence on where a run stands and what to do about it.
pub fn run_description(run: &JobRun) -> &'static str {
    let failed = run.status == RunStatus::Failed;
    let started = run.turn_id.is_some();
    if failed && run.failure_reason == Some(FailureReason::NoModel) {
        "No model configured. Connect a model provider in Settings."
    } else if run.waiting_for_bot {
        "Waiting for the bot’s active turn or approval."
    } else if failed && started {
        "The reply failed. Open the conversation to inspect it."
    } else if failed && run.failure_reason == Some(FailureReason::Unknown) {
        "The run failed for an unknown reason."
    } else if failed {
        "The prompt could not start. Check the bot's model connection."
    } else if run.status == RunStatus::Interrupted && started {
        "Execution was interrupted. Inspect the conversation before retrying any actions."
    } else if run.status == RunStatus::Interrupted {
        "The job was stopped before its prompt was submitted."
    } else if run.status == RunStatus::Running {
        "Reply in progress; tool actions may be waiting for your approval."
    } else if run.status == RunStatus::Queued {
        "Waiting for prompt admission."
    } else {
        "The reply is ready in its conversation."
    }
}

/// The run history on screen: the newest runs, and older pages the owner
/// asked for.
///
/// Loads carry a ticket. Showing another job's runs or starting another
/// load takes a new ticket, so an answer that arrives late no longer
/// matches and is dropped.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RunHistory {
    /// Only this job's runs are shown; `None` shows every job's.
    pub job_id: Option<String>,
    /// The runs on screen, newest first; `None` until a load has answered.
    pub runs: Option<Vec<JobRun>>,
    /// The cursor for the page after the ones on screen, when there is one.
    pub next: Option<String>,
    /// A load of the newest runs is on its way.
    pub loading: bool,
    /// A load of older runs is on its way.
    pub loading_older: bool,
    /// Why the newest runs could not be loaded, until they are.
    pub error: Option<String>,
    /// Why older runs could not be loaded, until they are.
    pub older_error: Option<String>,
    ticket: u64,
}

impl RunHistory {
    /// Starts over on `job_id`'s runs (`None` for every job's).
    pub fn show(&mut self, job_id: Option<String>) {
        // Keeping the ticket counting up is what retires a load on its way.
        *self = RunHistory {
            job_id,
            ticket: self.ticket + 1,
            ..RunHistory::default()
        };
    }

    /// A load is starting: of older runs, or else of the newest. Returns
    /// the ticket its answer must carry.
    pub fn begin_load(&mut self, older: bool) -> u64 {
        self.ticket += 1;
        if older {
            self.loading_older = true;
            self.older_error = None;
        } else {
            self.loading = true;
        }
        self.ticket
    }

    /// A page arrived. The newest runs go on top of what is shown; an older
    /// page goes underneath. Either way a run already shown is not repeated.
    pub fn loaded(&mut self, ticket: u64, older: bool, page: Page<JobRun>) {
        if ticket != self.ticket {
            return;
        }
        let shown = self.runs.take();
        if older {
            self.loading_older = false;
            let mut runs = shown.unwrap_or_default();
            for run in page.items {
                if !runs.iter().any(|known| known.id == run.id) {
                    runs.push(run);
                }
            }
            self.runs = Some(runs);
            self.next = page.next;
            return;
        }
        self.loading = false;
        self.error = None;
        match shown {
            // The first answer sets the list and where older runs start.
            None => {
                self.next = page.next;
                self.runs = Some(page.items);
            }
            // A refresh: newer runs first, with their newer state, then the
            // runs already shown. The cursor for older runs stays.
            Some(known) => {
                let mut runs = page.items;
                for run in known {
                    if !runs.iter().any(|fresh| fresh.id == run.id) {
                        runs.push(run);
                    }
                }
                self.runs = Some(runs);
            }
        }
    }

    /// A load failed. The runs already on screen stay.
    pub fn failed(&mut self, ticket: u64, older: bool, message: String) {
        if ticket != self.ticket {
            return;
        }
        if older {
            self.loading_older = false;
            self.older_error = Some(message);
        } else {
            self.loading = false;
            self.error = Some(message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, status: RunStatus) -> JobRun {
        JobRun {
            id: id.into(),
            job_id: "job-1".into(),
            name: "Brief".into(),
            late: false,
            waiting_for_bot: false,
            failure_reason: None,
            started_at: 1_700_000_000_000,
            finished_at: None,
            status,
            session_id: None,
            turn_id: None,
        }
    }

    fn job() -> ScheduledJob {
        ScheduledJob {
            id: "job-1".into(),
            name: "Brief".into(),
            prompt: "Summarise".into(),
            every_minutes: Some(60),
            enabled: true,
            next_run_at: 1_700_000_600_000,
            last_run_at: None,
            last_status: None,
            last_run: None,
            confirmed: true,
        }
    }

    fn page(ids: &[&str], next: Option<&str>) -> Page<JobRun> {
        Page {
            items: ids.iter().map(|id| run(id, RunStatus::Completed)).collect(),
            next: next.map(str::to_owned),
        }
    }

    fn ids(history: &RunHistory) -> Vec<&str> {
        let runs = history.runs.as_deref().unwrap_or_default();
        runs.iter().map(|run| run.id.as_str()).collect()
    }

    #[test]
    fn a_new_job_is_checked_against_the_runtimes_limits() {
        let good = NewJob {
            name: "Brief".into(),
            prompt: "Summarise".into(),
            every_minutes: Some(60),
            first_run_at: 1,
        };
        assert_eq!(good.problem(), None);
        let unnamed = NewJob {
            name: String::new(),
            ..good.clone()
        };
        assert!(unnamed.problem().unwrap().contains("name"));
        let wordy = NewJob {
            prompt: "x".repeat(4001),
            ..good.clone()
        };
        assert!(wordy.problem().unwrap().contains("prompt"));
        let never = NewJob {
            every_minutes: Some(0),
            ..good.clone()
        };
        assert!(never.problem().unwrap().contains("Repeat"));
        let once = NewJob {
            every_minutes: None,
            ..good
        };
        assert_eq!(once.problem(), None);
    }

    #[test]
    fn a_job_is_described_by_its_schedule_and_last_run() {
        let mut job = job();
        assert_eq!(job_badge(&job), "Active");
        assert_eq!(job_interval(&job), "Every 60 minutes");
        assert_eq!(last_run_line(&job), ("No runs yet".to_owned(), None));
        job.enabled = false;
        assert_eq!(job_badge(&job), "Paused");

        // A one-time job that ran is finished, not paused.
        job.every_minutes = None;
        job.last_run_at = Some(5);
        job.last_status = Some(LastStatus::Submitted);
        assert!(is_finished(&job));
        assert_eq!(job_badge(&job), "Sent");
        assert_eq!(job_interval(&job), "One-time reminder");
        assert!(
            last_run_line(&job)
                .0
                .starts_with("Earlier prompt submitted")
        );
        job.last_run = Some(run("r-1", RunStatus::Failed));
        assert_eq!(job_badge(&job), "Failed");
        assert_eq!(last_run_line(&job).0, "Last run: Failed");

        let mut waiting = run("r-2", RunStatus::Queued);
        waiting.waiting_for_bot = true;
        job.last_run = Some(waiting);
        assert_eq!(job_badge(&job), "Waiting for bot");
    }

    #[test]
    fn a_run_says_what_to_do_about_it() {
        let mut failed = run("r-1", RunStatus::Failed);
        assert!(run_description(&failed).contains("could not start"));
        failed.failure_reason = Some(FailureReason::NoModel);
        assert!(run_description(&failed).contains("No model configured"));
        failed.failure_reason = None;
        failed.turn_id = Some("t-1".into());
        assert!(run_description(&failed).contains("reply failed"));
        assert!(run_description(&run("r-2", RunStatus::Running)).contains("in progress"));
        assert!(run_description(&run("r-3", RunStatus::Completed)).contains("ready"));
        assert!(run_description(&run("r-4", RunStatus::Interrupted)).contains("stopped before"));
    }

    #[test]
    fn newer_runs_go_on_top_and_older_ones_underneath() {
        let mut history = RunHistory::default();
        let first = history.begin_load(false);
        history.loaded(first, false, page(&["c", "b"], Some("after-b")));
        let older = history.begin_load(true);
        history.loaded(older, true, page(&["b", "a"], None));
        assert_eq!(ids(&history), ["c", "b", "a"]);
        assert_eq!(history.next, None);

        // A refresh brings a new run and a newer state of a known one.
        let refresh = history.begin_load(false);
        let mut fresh = page(&["d", "c"], Some("after-c"));
        fresh.items[1].status = RunStatus::Failed;
        history.loaded(refresh, false, fresh);
        assert_eq!(ids(&history), ["d", "c", "b", "a"]);
        assert_eq!(history.runs.as_ref().unwrap()[1].status, RunStatus::Failed);
        assert_eq!(history.next, None, "older runs were already loaded");
    }

    #[test]
    fn a_late_answer_for_another_job_is_dropped() {
        let mut history = RunHistory::default();
        let all = history.begin_load(false);
        history.show(Some("job-1".into()));
        let one = history.begin_load(false);
        history.loaded(all, false, page(&["x"], None));
        assert!(history.runs.is_none() && history.loading);
        history.failed(one, false, "offline".into());
        assert_eq!(history.error.as_deref(), Some("offline"));
        assert!(!history.loading);
    }
}
