//! The "Create a job" form on Settings → Scheduled jobs.
//!
//! Mirrors the form state in `apps/web/src/domains/settings/presentation/
//! job-settings.tsx`. The checks on the job itself live in the core
//! (`raphie_core::jobs`); turning the typed date and time into a moment is
//! done here, because it depends on this machine's time zone.

use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use raphie_core::jobs::NewJob;
use rune::TextEdit;

/// What is typed into the form.
pub struct JobForm {
    /// Whether the dialog is open.
    pub open: bool,
    pub name: TextEdit,
    pub prompt: TextEdit,
    /// Recurring, or a single run.
    pub repeat: bool,
    /// Minutes between runs of a recurring job.
    pub minutes: TextEdit,
    /// The first run's local date, as `YYYY-MM-DD`.
    pub date: TextEdit,
    /// The first run's local time, as `HH:MM` on a 24-hour clock.
    pub time: TextEdit,
    /// The date and time the form opened with, to tell edits from them.
    started: (String, String),
    /// What is wrong with what was typed, found when "Schedule job" was
    /// pressed.
    pub error: Option<&'static str>,
}

/// The local date and time of `at` (milliseconds since the Unix epoch) as
/// the form's two fields hold them.
fn local_fields(at: i64) -> (String, String) {
    match Local.timestamp_millis_opt(at).single() {
        Some(local) => (
            format!(
                "{:04}-{:02}-{:02}",
                local.year(),
                local.month(),
                local.day()
            ),
            format!("{:02}:{:02}", local.hour(), local.minute()),
        ),
        None => (String::new(), String::new()),
    }
}

/// The moment a local `YYYY-MM-DD` date and `HH:MM` time name, in
/// milliseconds since the Unix epoch.
fn local_moment(date: &str, time: &str) -> Option<i64> {
    // `?` leaves with `None` as soon as a part is missing or not a number.
    let mut date = date.trim().splitn(3, '-');
    let year: i32 = date.next()?.parse().ok()?;
    let month: u32 = date.next()?.parse().ok()?;
    let day: u32 = date.next()?.parse().ok()?;
    let (hour, minute) = time.trim().split_once(':')?;
    let naive = NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(
        hour.parse().ok()?,
        minute.parse().ok()?,
        0,
    )?;
    // A clock time can happen twice (when clocks go back) or not at all
    // (when they go forward). `earliest` takes the first; a time that never
    // happens is refused.
    let local = Local.from_local_datetime(&naive).earliest()?;
    Some(local.timestamp_millis())
}

impl JobForm {
    /// A closed, empty form whose first run is a minute after `now`
    /// (milliseconds since the Unix epoch), as the web offers.
    pub fn new_at(now: i64) -> JobForm {
        let (date, time) = local_fields(now + 60_000);
        JobForm {
            open: false,
            name: TextEdit::new(""),
            prompt: TextEdit::new(""),
            repeat: true,
            minutes: TextEdit::new("60"),
            date: TextEdit::new(date.clone()),
            time: TextEdit::new(time.clone()),
            started: (date, time),
            error: None,
        }
    }

    /// Whether anything was typed or chosen.
    pub fn is_dirty(&self) -> bool {
        !self.name.text.is_empty()
            || !self.prompt.text.is_empty()
            || self.minutes.text != "60"
            || !self.repeat
            || (self.date.text.as_str(), self.time.text.as_str())
                != (self.started.0.as_str(), self.started.1.as_str())
    }

    /// Whether there is enough to send: a name and a prompt.
    pub fn is_complete(&self) -> bool {
        !self.name.text.trim().is_empty() && !self.prompt.text.trim().is_empty()
    }

    /// The job the form describes, or what is wrong with it.
    pub fn job(&self) -> Result<NewJob, &'static str> {
        let every_minutes = if self.repeat {
            let minutes = self.minutes.text.trim().parse::<u32>();
            Some(minutes.map_err(|_| "Repeat every 1 to 525,600 minutes.")?)
        } else {
            None
        };
        let first_run_at = local_moment(&self.date.text, &self.time.text)
            .ok_or("Choose a valid first-run time: a date as YYYY-MM-DD and a time as HH:MM.")?;
        let job = NewJob {
            name: self.name.text.trim().to_owned(),
            prompt: self.prompt.text.trim().to_owned(),
            every_minutes,
            first_run_at,
        };
        match job.problem() {
            Some(problem) => Err(problem),
            None => Ok(job),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Noon UTC on a day with no clock change anywhere.
    const NOW: i64 = 1_794_657_600_000;

    fn filled() -> JobForm {
        let mut form = JobForm::new_at(NOW);
        form.name = TextEdit::new(" Morning brief ");
        form.prompt = TextEdit::new("Summarise the open tasks.");
        form
    }

    #[test]
    fn a_new_form_is_clean_and_runs_a_minute_from_now() {
        let form = JobForm::new_at(NOW);
        assert!(!form.is_dirty() && !form.is_complete());
        // The two fields name the same minute, whatever this machine's zone.
        assert_eq!(
            local_moment(&form.date.text, &form.time.text),
            Some(NOW + 60_000)
        );
    }

    #[test]
    fn a_recurring_job_carries_its_interval_and_a_single_run_none() {
        let mut form = filled();
        assert!(form.is_dirty() && form.is_complete());
        let job = form.job().expect("a valid job");
        assert_eq!(job.name, "Morning brief");
        assert_eq!(job.every_minutes, Some(60));
        assert_eq!(job.first_run_at, NOW + 60_000);
        form.repeat = false;
        // The minutes field is ignored for a single run, even if it is junk.
        form.minutes = TextEdit::new("often");
        assert_eq!(form.job().expect("a valid job").every_minutes, None);
    }

    #[test]
    fn typed_numbers_dates_and_times_are_checked() {
        let mut form = filled();
        form.minutes = TextEdit::new("0");
        assert!(form.job().unwrap_err().contains("Repeat every"));
        form.minutes = TextEdit::new("hourly");
        assert!(form.job().unwrap_err().contains("Repeat every"));
        form.minutes = TextEdit::new("30");
        for (date, time) in [
            ("tomorrow", "09:00"),
            ("2027-02-30", "09:00"),
            ("2027-03-01", "9am"),
            ("2027-03-01", "25:00"),
            ("", ""),
        ] {
            form.date = TextEdit::new(date);
            form.time = TextEdit::new(time);
            let error = form.job().unwrap_err();
            assert!(error.contains("valid first-run time"), "{date} {time}");
        }
        form.date = TextEdit::new("2027-03-01");
        form.time = TextEdit::new("09:05");
        let job = form.job().expect("a valid job");
        assert_eq!(
            local_fields(job.first_run_at),
            ("2027-03-01".into(), "09:05".into())
        );
    }
}
