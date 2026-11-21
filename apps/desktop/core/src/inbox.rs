//! Notifications: what needs the owner across every bot — replies not read
//! yet, actions waiting for approval, and scheduled jobs that ran.
//!
//! The selected bot's conversations arrive on its live stream. The other
//! bots' are asked for now and then (their first page), and so are each
//! bot's unacknowledged job runs. [`items`] turns the lot into one list,
//! newest first. Mirrors the web's `use-bot-inbox.ts`, `notification-items.ts`
//! and the wording in `notifications.tsx`.

use std::collections::{HashMap, HashSet};

use crate::contracts::{BotProfile, JobRun, RunStatus, SessionSummary};

/// A bot's unacknowledged job runs, as last loaded.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct JobUpdates {
    /// The latest ones, newest first.
    pub runs: Vec<JobRun>,
    /// How many there are in all; more than `runs` when there is a page
    /// after this one.
    pub total: usize,
    pub more: bool,
}

/// What was last heard from the bots that are not on screen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inbox {
    /// Each other bot's conversations (its first page), by bot id.
    pub sessions: HashMap<String, Vec<SessionSummary>>,
    /// Each bot's job updates, by bot id.
    pub jobs: HashMap<String, JobUpdates>,
    /// Bots whose job updates could not be loaded last time.
    pub jobs_failed: HashSet<String>,
    /// A job update is being dismissed.
    pub acknowledging: bool,
    /// The last dismissal failed, until the next one works.
    pub acknowledge_failed: bool,
}

impl Inbox {
    pub fn sessions_loaded(&mut self, bot_id: String, sessions: Vec<SessionSummary>) {
        self.sessions.insert(bot_id, sessions);
    }

    pub fn jobs_loaded(&mut self, bot_id: String, updates: JobUpdates) {
        self.jobs_failed.remove(&bot_id);
        self.jobs.insert(bot_id, updates);
    }

    pub fn jobs_failed(&mut self, bot_id: String) {
        self.jobs_failed.insert(bot_id);
    }

    /// The owner dismissed a job update. Returns false while another
    /// dismissal is on its way.
    pub fn begin_acknowledge(&mut self) -> bool {
        if self.acknowledging {
            return false;
        }
        self.acknowledging = true;
        true
    }

    /// The runtime agreed: the run leaves the list without waiting for the
    /// next load.
    pub fn acknowledged(&mut self, bot_id: &str, run_id: &str) {
        self.acknowledging = false;
        self.acknowledge_failed = false;
        if let Some(updates) = self.jobs.get_mut(bot_id) {
            let before = updates.runs.len();
            updates.runs.retain(|run| run.id != run_id);
            let removed = before - updates.runs.len();
            updates.total = updates.total.saturating_sub(removed);
        }
    }

    pub fn acknowledge_failed(&mut self) {
        self.acknowledging = false;
        self.acknowledge_failed = true;
    }

    /// Forget bots that no longer exist.
    pub fn keep_only(&mut self, bots: &[BotProfile]) {
        let known = |id: &String| bots.iter().any(|bot| &bot.id == id);
        self.sessions.retain(|id, _| known(id));
        self.jobs.retain(|id, _| known(id));
        self.jobs_failed.retain(known);
    }

    /// Every loaded job update with the bot it belongs to, in the bots'
    /// order.
    pub fn job_entries<'a>(&'a self, bots: &'a [BotProfile]) -> Vec<(&'a BotProfile, &'a JobRun)> {
        bots.iter()
            .flat_map(|bot| {
                let runs = self
                    .jobs
                    .get(&bot.id)
                    .map_or(&[][..], |updates| &updates.runs);
                runs.iter().map(move |run| (bot, run))
            })
            .collect()
    }

    /// How many job updates there are in all, counting those on later
    /// pages.
    pub fn job_total(&self) -> usize {
        self.jobs
            .values()
            .map(|updates| updates.total.max(updates.runs.len()))
            .sum()
    }

    /// True when some bot has more job updates than were loaded.
    pub fn more_jobs(&self) -> bool {
        self.jobs.values().any(|updates| updates.more)
    }
}

/// What a notification is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Replies not read yet in one conversation.
    Reply,
    /// An action waiting for approval in one conversation.
    Approval,
    /// A scheduled job that ran.
    Job,
}

/// One line of the notifications list.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    /// Stable for as long as the thing it is about: "reply:bot:session".
    pub key: String,
    pub bot_id: String,
    pub bot_name: String,
    pub kind: Kind,
    /// When it happened, in milliseconds since the Unix epoch.
    pub time: i64,
    /// The conversation to open, when there is one.
    pub session: Option<SessionSummary>,
    pub run: Option<JobRun>,
    /// For a reply: how many are new.
    pub unread: u32,
}

impl Item {
    /// The session to open for this item: a job's own, else the
    /// conversation's.
    pub fn session_id(&self) -> Option<&str> {
        self.run
            .as_ref()
            .and_then(|run| run.session_id.as_deref())
            .or(self.session.as_ref().map(|session| session.id.as_str()))
    }

    /// Where a click on this item's notification leads.
    pub fn target(&self) -> Target {
        Target {
            bot_id: self.bot_id.clone(),
            session_id: self.session_id().map(str::to_owned),
            run_id: self.run.as_ref().map(|run| run.id.clone()),
        }
    }

    /// The headline: "Needs your approval", "2 new replies", "Your
    /// scheduled reply is ready", "Scheduled job failed".
    pub fn title(&self) -> String {
        match (self.kind, &self.run) {
            (Kind::Approval, _) => "Needs your approval".to_owned(),
            (Kind::Reply, _) if self.unread == 1 => "1 new reply".to_owned(),
            (Kind::Reply, _) => format!("{} new replies", self.unread),
            (Kind::Job, Some(run)) if run.status == RunStatus::Completed => {
                "Your scheduled reply is ready".to_owned()
            }
            (Kind::Job, Some(run)) => format!("Scheduled job {}", status_word(run.status)),
            (Kind::Job, None) => "Scheduled job".to_owned(),
        }
    }

    /// The small label beside the headline; a reply has none.
    pub fn tag(&self) -> Option<String> {
        match (self.kind, &self.run) {
            (Kind::Approval, _) => Some("Action required".to_owned()),
            (Kind::Job, Some(run)) => Some(format!("Job {}", status_word(run.status))),
            _ => None,
        }
    }

    /// What the item is in: the job's name, or the conversation's title.
    pub fn subject(&self) -> &str {
        match (&self.run, &self.session) {
            (Some(run), _) => &run.name,
            (None, Some(session)) => &session.title,
            (None, None) => "",
        }
    }
}

/// A run's status in the middle of a sentence.
fn status_word(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Interrupted => "interrupted",
        RunStatus::Unknown => "updated",
    }
}

/// The notifications list, newest first, and how many replies were folded
/// into the job that produced them.
///
/// A finished job's reply would show twice (as "1 new reply" and as the
/// job), so when a conversation's only new reply is the one a completed
/// job produced, the job's line stands for both.
pub fn items<'a>(
    bots: &[BotProfile],
    sessions_of: impl Fn(&str) -> Vec<&'a SessionSummary>,
    unread: impl Fn(&str, &SessionSummary) -> u32,
    jobs: &[(&BotProfile, &JobRun)],
) -> (Vec<Item>, usize) {
    // The completed job, if any, whose reply is this session's latest.
    let produced_by = |bot_id: &str, session: &SessionSummary| {
        let turn = session.reply_turn_id.as_deref()?;
        jobs.iter().find(|(owner, run)| {
            owner.id == bot_id
                && run.status == RunStatus::Completed
                && run.session_id.as_deref() == Some(session.id.as_str())
                && run.turn_id.as_deref() == Some(turn)
        })
    };
    let mut list = Vec::new();
    let mut merged = 0;
    for bot in bots {
        for session in sessions_of(&bot.id) {
            let count = unread(&bot.id, session);
            if session.waiting {
                list.push(Item {
                    key: format!("approval:{}:{}", bot.id, session.id),
                    bot_id: bot.id.clone(),
                    bot_name: bot.name.clone(),
                    kind: Kind::Approval,
                    time: session.last_at,
                    session: Some(session.clone()),
                    run: None,
                    unread: 0,
                });
            }
            let folded = count == 1 && produced_by(&bot.id, session).is_some();
            if folded {
                merged += 1;
            } else if count > 0 {
                list.push(Item {
                    key: format!("reply:{}:{}", bot.id, session.id),
                    bot_id: bot.id.clone(),
                    bot_name: bot.name.clone(),
                    kind: Kind::Reply,
                    time: session.last_at,
                    session: Some(session.clone()),
                    run: None,
                    unread: count,
                });
            }
        }
    }
    for (bot, run) in jobs {
        // The conversation whose one new reply this job produced.
        let session = sessions_of(&bot.id).into_iter().find(|session| {
            run.status == RunStatus::Completed
                && run.session_id.as_deref() == Some(session.id.as_str())
                && session.reply_turn_id.is_some()
                && session.reply_turn_id == run.turn_id
                && unread(&bot.id, session) == 1
        });
        list.push(Item {
            key: format!("job:{}:{}", bot.id, run.id),
            bot_id: bot.id.clone(),
            bot_name: bot.name.clone(),
            kind: Kind::Job,
            time: run.finished_at.unwrap_or(run.started_at),
            session: session.cloned(),
            run: Some((*run).clone()),
            unread: 0,
        });
    }
    // Newest first; the key settles ties so the order never flickers.
    list.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.key.cmp(&b.key)));
    (list, merged)
}

/// One thing to tell the owner about through the system's notifications.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Announcement {
    /// Whose it is and where: "Raphie · Plan the week".
    pub title: String,
    /// What happened: "2 new replies".
    pub body: String,
    /// What a click on the notification opens.
    pub target: Target,
}

/// Where a notification leads. It is kept apart from the [`Item`], which
/// may be gone by the time the owner clicks (read, decided, dismissed):
/// the conversation is still worth opening then.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub bot_id: String,
    /// The conversation to open; `None` for a job run without one, which
    /// opens the inbox instead.
    pub session_id: Option<String>,
    /// The job run to dismiss on opening, as a click in the inbox does.
    pub run_id: Option<String>,
}

/// Which notifications the owner has already been told about, so each is
/// announced once.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Announcements {
    /// Each item's key and how much of it was announced (a conversation's
    /// count of new replies; 1 for an approval or a job).
    seen: HashMap<String, u32>,
    /// False until the first look, which announces nothing: what waited
    /// before the app started is in the inbox, not news.
    primed: bool,
}

impl Announcements {
    /// What is new in `items` since the last look: an item that was not
    /// there, or a conversation with more new replies than before.
    pub fn news(&mut self, items: &[Item]) -> Vec<Announcement> {
        let amount = |item: &Item| match item.kind {
            Kind::Reply => item.unread,
            Kind::Approval | Kind::Job => 1,
        };
        let mut news = Vec::new();
        if self.primed {
            for item in items {
                let before = self.seen.get(&item.key).copied().unwrap_or(0);
                if amount(item) > before {
                    news.push(Announcement {
                        title: format!("{} · {}", item.bot_name, item.subject()),
                        body: item.title(),
                        target: item.target(),
                    });
                }
            }
        }
        // Remember exactly what is there now: something that goes away
        // (read, decided, dismissed) is news again if it comes back.
        self.seen = items
            .iter()
            .map(|item| (item.key.clone(), amount(item)))
            .collect();
        self.primed = true;
        news
    }
}

/// How many updates the bell counts: every line, plus job updates on
/// pages not loaded.
pub fn count(items: usize, job_total: usize, job_entries: usize) -> usize {
    items + job_total.saturating_sub(job_entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bot(id: &str, name: &str) -> BotProfile {
        BotProfile {
            id: id.into(),
            name: name.into(),
            description: String::new(),
            color: None,
            personality: String::new(),
            revision: 1,
        }
    }

    fn session(id: &str, at: i64, waiting: bool, reply_turn: Option<&str>) -> SessionSummary {
        serde_json::from_value(serde_json::json!({
            "id": id, "title": format!("Session {id}"), "origin": "web", "lastAt": at,
            "working": false, "failed": false, "waiting": waiting, "preview": "",
            "turnCount": 1, "replyCount": 1, "replyTurnId": reply_turn,
        }))
        .unwrap()
    }

    fn run(id: &str, status: &str, session: Option<&str>, turn: Option<&str>) -> JobRun {
        serde_json::from_value(serde_json::json!({
            "id": id, "jobId": "j-1", "name": "Morning brief", "startedAt": 50,
            "finishedAt": 60, "status": status, "sessionId": session, "turnId": turn,
        }))
        .unwrap()
    }

    #[test]
    fn replies_approvals_and_jobs_are_listed_newest_first_across_bots() {
        let bots = [bot("default", "Raphie"), bot("research", "Research")];
        let mine = [
            session("s-1", 100, false, None),
            session("s-2", 300, true, None),
        ];
        let theirs = [session("s-9", 200, false, None)];
        let failed = run("r-1", "failed", None, None);
        let jobs = [(&bots[1], &failed)];
        let (list, merged) = items(
            &bots,
            |bot| match bot {
                "default" => mine.iter().collect(),
                _ => theirs.iter().collect(),
            },
            // Only s-2 was read.
            |_, session| u32::from(session.id != "s-2"),
            &jobs,
        );
        let keys: Vec<&str> = list.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "approval:default:s-2",
                "reply:research:s-9",
                "reply:default:s-1",
                "job:research:r-1"
            ]
        );
        assert_eq!(merged, 0);
        assert_eq!(list[0].title(), "Needs your approval");
        assert_eq!(list[0].tag().as_deref(), Some("Action required"));
        assert_eq!(list[1].title(), "1 new reply");
        assert_eq!(list[1].tag(), None);
        assert_eq!(list[1].bot_name, "Research");
        assert_eq!(list[3].title(), "Scheduled job failed");
        assert_eq!(list[3].tag().as_deref(), Some("Job failed"));
        assert_eq!(list[3].subject(), "Morning brief");
        assert_eq!(list[3].session_id(), None, "nothing to open");
    }

    #[test]
    fn a_finished_jobs_reply_is_shown_once_as_the_job() {
        let bots = [bot("default", "Raphie")];
        let sessions = [session("s-1", 100, false, Some("t-7"))];
        let done = run("r-1", "completed", Some("s-1"), Some("t-7"));
        let jobs = [(&bots[0], &done)];
        let (list, merged) = items(&bots, |_| sessions.iter().collect(), |_, _| 1, &jobs);
        assert_eq!(merged, 1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].kind, Kind::Job);
        assert_eq!(list[0].title(), "Your scheduled reply is ready");
        assert_eq!(list[0].session_id(), Some("s-1"));
        assert_eq!(list[0].time, 60, "when the job finished");
        // Its notification opens the conversation and dismisses the run.
        assert_eq!(
            list[0].target(),
            Target {
                bot_id: "default".into(),
                session_id: Some("s-1".into()),
                run_id: Some("r-1".into()),
            }
        );

        // With two new replies the conversation gets its own line too.
        let (list, merged) = items(&bots, |_| sessions.iter().collect(), |_, _| 2, &jobs);
        assert_eq!(merged, 0);
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|item| item.title() == "2 new replies"));
    }

    #[test]
    fn a_dismissed_job_leaves_at_once_and_the_count_follows() {
        let mut inbox = Inbox::default();
        inbox.jobs_loaded(
            "default".into(),
            JobUpdates {
                runs: vec![
                    run("r-1", "failed", None, None),
                    run("r-2", "failed", None, None),
                ],
                total: 5,
                more: true,
            },
        );
        let bots = [bot("default", "Raphie")];
        assert_eq!(inbox.job_entries(&bots).len(), 2);
        // Two lines shown, three more on later pages.
        assert_eq!(count(2, inbox.job_total(), 2), 5);
        assert!(inbox.more_jobs());

        assert!(inbox.begin_acknowledge());
        assert!(!inbox.begin_acknowledge(), "one at a time");
        inbox.acknowledged("default", "r-1");
        assert_eq!(inbox.job_entries(&bots).len(), 1);
        assert_eq!(inbox.job_total(), 4);

        assert!(inbox.begin_acknowledge());
        inbox.acknowledge_failed();
        assert!(inbox.acknowledge_failed && !inbox.acknowledging);
    }

    #[test]
    fn each_update_is_announced_once_and_again_only_if_it_grows_or_returns() {
        let bots = [bot("default", "Raphie")];
        let sessions = [session("s-1", 100, true, None)];
        let list = |unread: u32| items(&bots, |_| sessions.iter().collect(), |_, _| unread, &[]).0;
        let mut announced = Announcements::default();
        // What waited at launch is not news.
        assert!(announced.news(&list(1)).is_empty());
        assert!(announced.news(&list(1)).is_empty());
        // Another reply in the same conversation is.
        let news = announced.news(&list(2));
        assert_eq!(
            news,
            [Announcement {
                title: "Raphie · Session s-1".into(),
                body: "2 new replies".into(),
                target: Target {
                    bot_id: "default".into(),
                    session_id: Some("s-1".into()),
                    run_id: None,
                },
            }]
        );
        // Read, then a new reply: news again. The approval never left, so
        // it is not repeated.
        assert!(announced.news(&list(0)).is_empty());
        let news = announced.news(&list(1));
        assert_eq!(news.len(), 1);
        assert_eq!(news[0].body, "1 new reply");
    }

    #[test]
    fn a_deleted_bots_updates_are_forgotten() {
        let mut inbox = Inbox::default();
        inbox.sessions_loaded("gone".into(), vec![session("s-1", 1, false, None)]);
        inbox.jobs_failed("gone".into());
        inbox.keep_only(&[bot("default", "Raphie")]);
        assert!(inbox.sessions.is_empty() && inbox.jobs_failed.is_empty());
    }
}
