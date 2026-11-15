//! Attachments: the files waiting in the composer to go with the next
//! message, and the rules for what may be attached.
//!
//! A file is uploaded to the bot as soon as it is chosen, and the message
//! then names it by the id the runtime gave it. Mirrors the web's
//! `attachment-drafts.ts`; the limits are the runtime's
//! (`packages/runtime/src/domains/attachments/domain/policy.ts` and the
//! message route), checked here first so the owner hears at once.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use crate::contracts::Attachment;

/// The most files one message may carry.
pub const MAX_FILES: usize = 4;

/// The largest file the runtime accepts: 8 MiB.
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

pub const TOO_MANY: &str = "Attach at most four files.";

pub const TOO_LARGE: &str = "Files must be 8 MiB or smaller.";

/// A file's bytes, shared without copying.
///
/// `Arc<[u8]>` is one allocation that several owners can point at; cloning
/// it copies a pointer, not the megabytes. The hand-written `Debug` prints
/// only the length, so a file's contents never reach a log.
#[derive(Clone, PartialEq, Eq)]
pub struct FileBytes(pub Arc<[u8]>);

impl fmt::Debug for FileBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FileBytes({} bytes)", self.0.len())
    }
}

impl From<Vec<u8>> for FileBytes {
    fn from(bytes: Vec<u8>) -> FileBytes {
        FileBytes(bytes.into())
    }
}

/// Something the owner chose to attach.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Upload {
    /// A file on this machine, picked or dropped. The engine reads it.
    File(PathBuf),
    /// Bytes that are in no file, such as a pasted screenshot.
    Bytes { name: String, bytes: FileBytes },
}

/// The files waiting in the composer.
///
/// Uploads belong to one bot (each bot has its own store), so the draft
/// remembers whose it is: an answer for another bot is dropped, and
/// choosing files for another bot starts the draft again.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AttachmentDraft {
    pub bot_id: Option<String>,
    /// Uploaded and ready to send, in the order they were added.
    pub files: Vec<Attachment>,
    pub uploading: bool,
    /// Why the last attach was refused or failed, until the next one.
    pub error: Option<String>,
    /// The ids that went with the message now being sent.
    sending: Vec<String>,
}

impl AttachmentDraft {
    /// The owner chose `count` files for `bot_id`. Returns false, with the
    /// reason in `error`, when they would be too many or an upload is
    /// already running.
    pub fn begin(&mut self, bot_id: &str, count: usize) -> bool {
        if self.bot_id.as_deref() != Some(bot_id) {
            *self = AttachmentDraft {
                bot_id: Some(bot_id.to_owned()),
                ..AttachmentDraft::default()
            };
        }
        if self.uploading || count == 0 {
            return false;
        }
        if self.files.len() + count > MAX_FILES {
            self.error = Some(TOO_MANY.to_owned());
            return false;
        }
        self.uploading = true;
        self.error = None;
        true
    }

    /// True when an answer about `bot_id` is about this draft.
    fn owns(&self, bot_id: &str) -> bool {
        self.bot_id.as_deref() == Some(bot_id)
    }

    /// One file finished uploading. The runtime names a file by its
    /// contents, so the same file chosen twice is kept once.
    pub fn added(&mut self, bot_id: &str, file: Attachment) {
        if !self.owns(bot_id) {
            return;
        }
        self.files.retain(|kept| kept.id != file.id);
        self.files.push(file);
    }

    pub fn failed(&mut self, bot_id: &str, message: String) {
        if self.owns(bot_id) {
            self.error = Some(message);
        }
    }

    /// The uploads are over, whether or not all of them worked.
    pub fn finished(&mut self, bot_id: &str) {
        if self.owns(bot_id) {
            self.uploading = false;
        }
    }

    /// The owner took a file off the message.
    pub fn remove(&mut self, id: &str) {
        self.files.retain(|file| file.id != id);
    }

    /// The ids to send for `bot_id`, remembered until the runtime answers.
    /// Files uploaded to another bot are not this bot's to send.
    pub fn take_for_send(&mut self, bot_id: &str) -> Vec<String> {
        self.sending = if self.owns(bot_id) {
            self.files.iter().map(|file| file.id.clone()).collect()
        } else {
            Vec::new()
        };
        self.sending.clone()
    }

    /// The message was admitted: the files that went with it leave the
    /// composer. One added while it was on its way stays.
    pub fn sent(&mut self) {
        // `mem::take` moves the list out and leaves an empty one behind.
        let sent = std::mem::take(&mut self.sending);
        self.files.retain(|file| !sent.contains(&file.id));
        self.error = None;
    }

    /// The message was refused: its files stay for a retry.
    pub fn not_sent(&mut self) {
        self.sending.clear();
    }

    /// True when another file may be chosen.
    pub fn has_room(&self) -> bool {
        !self.uploading && self.files.len() < MAX_FILES
    }
}

/// True for the image types the web previews. The runtime decides the type
/// from the file's bytes, not its name.
pub fn is_image(file: &Attachment) -> bool {
    matches!(
        file.mime_type.as_deref(),
        Some("image/png" | "image/jpeg" | "image/gif" | "image/webp")
    )
}

/// "812 B", "1.4 KB", "3.2 MB", as the web's attachment card words it.
pub fn file_size(size: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    // Sizes are far below 2^52, so the conversion to `f64` is exact.
    #[allow(clippy::cast_precision_loss)]
    let size_f = size as f64;
    if size < KB {
        format!("{size} B")
    } else if size < MB {
        format!("{:.1} KB", size_f / 1024.0)
    } else {
        format!("{:.1} MB", size_f / (1024.0 * 1024.0))
    }
}

/// The name to upload a file under: the last part of its path. The runtime
/// cleans names again; this only keeps a path on this machine from being
/// sent.
pub fn upload_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last.chars().filter(|c| !c.is_control()).collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "attachment".to_owned()
    } else {
        cleaned
    }
}

/// A `multipart/form-data` body holding one file in the field `file`, and
/// the `Content-Type` header that goes with it.
///
/// The format is plain: a boundary line, the part's headers, a blank line,
/// the bytes, and a closing boundary. `boundary` must not occur in the
/// file; callers pass a fresh random id.
pub fn multipart(boundary: &str, name: &str, bytes: &[u8]) -> (String, Vec<u8>) {
    // Inside the quoted file name, a quote or line break would end the
    // header early, so they are percent-encoded as browsers do.
    let name = name
        .replace('"', "%22")
        .replace('\r', "%0D")
        .replace('\n', "%0A");
    let head = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    );
    let tail = format!("\r\n--{boundary}--\r\n");
    let mut body = Vec::with_capacity(head.len() + bytes.len() + tail.len());
    body.extend_from_slice(head.as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(tail.as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str) -> Attachment {
        Attachment {
            id: id.to_owned(),
            name: format!("{id}.txt"),
            size: 3,
            path: None,
            mime_type: None,
        }
    }

    #[test]
    fn a_fifth_file_is_refused_and_says_why() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 3));
        for id in ["a", "b", "c"] {
            draft.added("default", file(id));
        }
        draft.finished("default");
        assert!(!draft.begin("default", 2));
        assert_eq!(draft.error.as_deref(), Some(TOO_MANY));
        assert!(!draft.uploading);
        // One more still fits, and clears the complaint.
        assert!(draft.begin("default", 1));
        assert_eq!(draft.error, None);
    }

    #[test]
    fn a_second_upload_waits_for_the_first() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 1));
        assert!(!draft.begin("default", 1));
        assert!(!draft.has_room());
        draft.finished("default");
        assert!(draft.has_room());
    }

    #[test]
    fn the_same_file_twice_is_kept_once() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 2));
        draft.added("default", file("a"));
        draft.added("default", file("a"));
        assert_eq!(draft.files.len(), 1);
    }

    #[test]
    fn another_bots_answers_are_dropped_and_its_files_are_not_sent() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 1));
        draft.added("research", file("x"));
        draft.failed("research", "nope".into());
        draft.finished("research");
        assert!(draft.files.is_empty());
        assert_eq!(draft.error, None);
        assert!(draft.uploading);

        draft.added("default", file("a"));
        draft.finished("default");
        assert!(draft.take_for_send("research").is_empty());
        // Choosing a file for another bot starts the draft again.
        assert!(draft.begin("research", 1));
        assert!(draft.files.is_empty());
    }

    #[test]
    fn sent_files_leave_and_one_added_meanwhile_stays() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 1));
        draft.added("default", file("a"));
        draft.finished("default");
        assert_eq!(draft.take_for_send("default"), vec!["a".to_owned()]);
        draft.added("default", file("b"));
        draft.sent();
        assert_eq!(draft.files, vec![file("b")]);
    }

    #[test]
    fn a_refused_message_keeps_its_files() {
        let mut draft = AttachmentDraft::default();
        assert!(draft.begin("default", 1));
        draft.added("default", file("a"));
        draft.finished("default");
        draft.take_for_send("default");
        draft.not_sent();
        draft.sent();
        assert_eq!(draft.files, vec![file("a")]);
    }

    #[test]
    fn sizes_read_as_the_web_writes_them() {
        assert_eq!(file_size(812), "812 B");
        assert_eq!(file_size(1434), "1.4 KB");
        assert_eq!(file_size(3 * 1024 * 1024 + 200_000), "3.2 MB");
    }

    #[test]
    fn only_the_last_part_of_a_path_is_uploaded_as_the_name() {
        assert_eq!(upload_name("/Users/me/notes.md"), "notes.md");
        assert_eq!(upload_name("C:\\tmp\\a.png"), "a.png");
        assert_eq!(upload_name(".."), "attachment");
        assert_eq!(upload_name(""), "attachment");
    }

    #[test]
    fn a_multipart_body_wraps_the_bytes_and_escapes_the_name() {
        let (content_type, body) = multipart("XYZ", "a\"b.txt", b"hi");
        assert_eq!(content_type, "multipart/form-data; boundary=XYZ");
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with("--XYZ\r\n"));
        assert!(text.contains("filename=\"a%22b.txt\""));
        assert!(text.contains("\r\n\r\nhi\r\n--XYZ--\r\n"));
    }

    #[test]
    fn file_bytes_never_print_their_contents() {
        let bytes = FileBytes::from(b"secret".to_vec());
        assert_eq!(format!("{bytes:?}"), "FileBytes(6 bytes)");
    }
}
