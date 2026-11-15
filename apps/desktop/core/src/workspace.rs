//! Settings → Workspace: a bot's files, a folder at a time, and saving one
//! to this machine.
//!
//! The paths here are the bot's, not this machine's: they start at
//! `/workspace` and are only ever sent to the runtime. The one place a
//! name from the runtime touches this machine's disk is [`save_download`],
//! which is why it is strict about what a name may be.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::contracts::WorkspaceListing;

/// The top of every bot's workspace.
pub const ROOT: &str = "/workspace";

/// The largest file this client will hold in memory to save. The runtime
/// caps downloads at 8 MiB itself; this is a second fence.
pub const DOWNLOAD_LIMIT: usize = 16 * 1024 * 1024;

/// The folder above `path`, or `None` at the top of the workspace.
pub fn parent(path: &str) -> Option<&str> {
    if path == ROOT {
        return None;
    }
    // `rsplit_once` cuts at the last slash: "/workspace/a/b" gives
    // ("/workspace/a", "b").
    path.rsplit_once('/')
        .map(|(above, _)| above)
        .filter(|above| above.starts_with(ROOT))
}

/// The folders from the top down to `path`, each with the path that opens
/// it: `[("/workspace", "/workspace"), ("notes", "/workspace/notes")]`.
pub fn crumbs(path: &str) -> Vec<(String, String)> {
    let mut crumbs = Vec::new();
    let mut so_far = String::new();
    for (index, part) in path.split('/').filter(|part| !part.is_empty()).enumerate() {
        so_far.push('/');
        so_far.push_str(part);
        let label = if index == 0 { ROOT } else { part };
        crumbs.push((label.to_owned(), so_far.clone()));
    }
    crumbs
}

/// The folder on screen and what it holds.
///
/// Answers name the bot and folder they are for, so one that arrives after
/// the owner opened another folder is dropped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceBrowser {
    /// The bot whose files these are; `None` until the page is opened.
    pub bot_id: Option<String>,
    pub path: String,
    /// What the folder holds; `None` until a listing has arrived.
    pub listing: Option<WorkspaceListing>,
    pub loading: bool,
    /// Why the last listing failed, until one succeeds.
    pub error: Option<String>,
    /// The file (by its workspace path) being downloaded, if one is.
    pub downloading: Option<String>,
    /// What the last download said: where the file went, or why it failed.
    pub saved: Option<String>,
    pub download_error: Option<String>,
}

impl Default for WorkspaceBrowser {
    fn default() -> WorkspaceBrowser {
        WorkspaceBrowser {
            bot_id: None,
            path: ROOT.to_owned(),
            listing: None,
            loading: false,
            error: None,
            downloading: None,
            saved: None,
            download_error: None,
        }
    }
}

impl WorkspaceBrowser {
    /// A listing of `path` for `bot_id` is starting. Opening another folder
    /// empties the list; asking again for the same one keeps it on screen
    /// until the answer comes.
    pub fn open(&mut self, bot_id: &str, path: &str) {
        let same = self.bot_id.as_deref() == Some(bot_id) && self.path == path;
        if !same {
            self.bot_id = Some(bot_id.to_owned());
            self.path = path.to_owned();
            self.listing = None;
            self.error = None;
            self.saved = None;
            self.download_error = None;
        }
        self.loading = true;
    }

    fn shows(&self, bot_id: &str, path: &str) -> bool {
        self.bot_id.as_deref() == Some(bot_id) && self.path == path
    }

    /// A listing arrived.
    pub fn listed(&mut self, bot_id: &str, listing: WorkspaceListing) {
        if !self.shows(bot_id, &listing.path) {
            return;
        }
        self.loading = false;
        self.error = None;
        self.listing = Some(listing);
    }

    /// A listing failed. The files already on screen stay.
    pub fn failed(&mut self, bot_id: &str, path: &str, message: String) {
        if !self.shows(bot_id, path) {
            return;
        }
        self.loading = false;
        self.error = Some(message);
    }

    /// A download of the file at `path` is starting. Returns false while
    /// another is on its way.
    pub fn begin_download(&mut self, path: &str) -> bool {
        if self.downloading.is_some() {
            return false;
        }
        self.downloading = Some(path.to_owned());
        self.saved = None;
        self.download_error = None;
        true
    }

    pub fn downloaded(&mut self, saved_as: String) {
        self.downloading = None;
        self.saved = Some(saved_as);
    }

    pub fn download_failed(&mut self, message: String) {
        self.downloading = None;
        self.download_error = Some(message);
    }
}

/// A file name that is safe to create in a folder on this machine: the
/// last part of what the runtime called it, with nothing that could step
/// out of the folder or hide the file.
fn safe_name(name: &str) -> String {
    // Keep what follows the last separator of either kind.
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && *c != ':')
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.');
    if cleaned.is_empty() {
        "download".to_owned()
    } else {
        cleaned.to_owned()
    }
}

/// Writes `bytes` to a new file in `folder`, named after `name`, and
/// returns where it went. An existing file is never replaced: a second
/// "notes.md" becomes "notes (1).md".
pub fn save_download(folder: &Path, name: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    let name = safe_name(name);
    // "notes.md" splits into "notes" and ".md"; "Makefile" has no dot.
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name.as_str(), ""),
    };
    for attempt in 0..1000 {
        let candidate = if attempt == 0 {
            name.clone()
        } else {
            format!("{stem} ({attempt}){extension}")
        };
        let path = folder.join(candidate);
        // `create_new` fails if the file exists, so two downloads at once
        // cannot both take the same name.
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "too many files with this name",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(path: &str) -> WorkspaceListing {
        WorkspaceListing {
            path: path.to_owned(),
            revision: 1,
            items: Vec::new(),
        }
    }

    #[test]
    fn folders_lead_up_to_the_workspace_and_no_further() {
        assert_eq!(parent("/workspace/notes/2026"), Some("/workspace/notes"));
        assert_eq!(parent("/workspace/notes"), Some("/workspace"));
        assert_eq!(parent("/workspace"), None);
        let trail = crumbs("/workspace/notes/2026");
        let labels: Vec<&str> = trail.iter().map(|(label, _)| label.as_str()).collect();
        assert_eq!(labels, ["/workspace", "notes", "2026"]);
        assert_eq!(trail[1].1, "/workspace/notes");
    }

    #[test]
    fn an_answer_for_another_folder_is_dropped() {
        let mut browser = WorkspaceBrowser::default();
        browser.open("default", "/workspace");
        browser.open("default", "/workspace/notes");
        browser.listed("default", listing("/workspace"));
        assert!(browser.listing.is_none() && browser.loading);
        browser.listed("b-research", listing("/workspace/notes"));
        assert!(browser.listing.is_none(), "another bot's files");
        browser.listed("default", listing("/workspace/notes"));
        assert!(browser.listing.is_some() && !browser.loading);
        // Asking again keeps the list; a failure keeps it too.
        browser.open("default", "/workspace/notes");
        browser.failed("default", "/workspace/notes", "offline".into());
        assert!(browser.listing.is_some());
        assert_eq!(browser.error.as_deref(), Some("offline"));
    }

    #[test]
    fn one_download_at_a_time() {
        let mut browser = WorkspaceBrowser::default();
        assert!(browser.begin_download("/workspace/a.txt"));
        assert!(!browser.begin_download("/workspace/b.txt"));
        browser.downloaded("a.txt".into());
        assert_eq!(browser.saved.as_deref(), Some("a.txt"));
        assert!(browser.begin_download("/workspace/b.txt"));
        browser.download_failed("too large".into());
        assert_eq!(browser.download_error.as_deref(), Some("too large"));
        assert!(browser.downloading.is_none());
    }

    #[test]
    fn names_cannot_leave_the_folder_or_hide() {
        assert_eq!(safe_name("report.csv"), "report.csv");
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("..\\..\\boot.ini"), "boot.ini");
        assert_eq!(safe_name(".bashrc"), "bashrc");
        assert_eq!(safe_name("a\u{0}b:c.txt"), "abc.txt");
        assert_eq!(safe_name(".."), "download");
        assert_eq!(safe_name(""), "download");
    }

    #[test]
    fn a_download_never_replaces_a_file() {
        let folder = std::env::temp_dir().join(format!("raphie-downloads-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let first = save_download(&folder, "notes.md", b"one").unwrap();
        let second = save_download(&folder, "notes.md", b"two").unwrap();
        let third = save_download(&folder, "../Makefile", b"three").unwrap();
        assert_eq!(first.file_name().unwrap(), "notes.md");
        assert_eq!(second.file_name().unwrap(), "notes (1).md");
        assert_eq!(third, folder.join("Makefile"), "kept inside the folder");
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
