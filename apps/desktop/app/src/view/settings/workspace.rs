//! Settings → Workspace: the files a bot keeps between conversations, a
//! folder at a time, with a download button on each file.
//!
//! Mirrors `workspace-files.tsx` and the `.workspace-file-*` rules in
//! `shared/styles/settings/workspace.css`. The folder on screen is in the
//! core (`raphie_core::workspace::WorkspaceBrowser`).
//!
//! One difference from the web: a download is saved straight into this
//! machine's Downloads folder, under a name that never replaces a file
//! already there, and the page says what it was saved as.

use raphie_core::contracts::{SandboxInfo, SandboxProvider, WorkspaceEntry, WorkspaceKind};
use raphie_core::sandbox::bytes;
use raphie_core::workspace::{WorkspaceBrowser, crumbs, parent};
use rune::{El, Span, col, icon, row, text};

use super::parts::{Scope, group_with, page};
use crate::format::date_time;
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Kind, Size, button, icon_button, pressable};

pub fn workspace(s: &Ui, bot_id: &str, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    page(
        "rd-page-workspace",
        "Workspace",
        &BotSection::Workspace.lede(name),
        Scope::Bot { id: bot_id, name },
        vec![files(s, bot_id, t)],
        look,
    )
}

/// One strip of the card: small text with the card's side padding.
fn strip(content: impl Into<String>, t: &Theme) -> El {
    text(content)
        .font(font(10.5, 400.0).lh(16.0))
        .color(t.foreground)
        .wrap()
}

/// "Workspace files": where the owner is, then what the folder holds.
fn files(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let browser: &WorkspaceBrowser = &s.model.files;
    // The sandbox details say which provider keeps the files.
    let sandbox = s.model.sandbox.get(bot_id);
    let container = sandbox.is_some_and(|info| info.provider.id == SandboxProvider::Container);

    let padded = |child: El| row().w_full().px(14.0).py(10.5).child(child.shrink());
    // Hairlines fall only under the toolbar, under the summary and between
    // files, as on the web: the lines in between share one cell of the card.
    let mut head = Vec::new();
    let mut entries = Vec::new();
    let mut tail = Vec::new();
    head.push(padded(
        text(browser.path.clone())
            .key("rd-files-path")
            .font(mono(10.5))
            .color(t.foreground)
            .wrap(),
    ));
    if let Some(error) = &browser.download_error {
        head.push(padded(
            strip(error.clone(), t)
                .key("rd-files-download-error")
                .role("alert")
                .color(t.error),
        ));
    }
    if let Some(error) = &browser.error {
        head.push(padded(
            strip(
                format!("{error} Use Refresh to retry or open a parent folder."),
                t,
            )
            .key("rd-files-error")
            .role("alert"),
        ));
    }
    match &browser.listing {
        None if browser.error.is_none() => {
            head.push(padded(strip("Loading files…", t).key("rd-files-loading")));
        }
        None => {}
        Some(listing) => {
            let count = listing.items.len();
            let mut summary = format!(
                "{count} {} · {} {}",
                if count == 1 { "item" } else { "items" },
                if container {
                    "Live listing"
                } else {
                    "Checkpoint"
                },
                listing.revision
            );
            if let Some(info) = sandbox {
                summary.push_str(&usage(info));
            }
            head.push(padded(
                strip(summary, t)
                    .key("rd-files-summary")
                    .color(t.muted_foreground),
            ));
            if listing.items.is_empty() {
                head.push(padded(strip(
                    "This folder is empty. Ask the bot to create a file in /workspace, then refresh.",
                    t,
                )));
            }
            // Nothing can be downloaded while one download runs, or from a
            // listing that failed to refresh.
            let can_download = browser.downloading.is_none() && browser.error.is_none();
            for item in &listing.items {
                entries.push(entry(item, can_download, t));
            }
        }
    }
    if browser.downloading.is_some() {
        tail.push(padded(strip("Downloading…", t).key("rd-files-downloading")));
    }
    if let Some(saved) = &browser.saved {
        tail.push(padded(
            strip(format!("Saved to your Downloads folder as {saved}."), t).key("rd-files-saved"),
        ));
    }

    let mut card = vec![toolbar(browser, t), col().w_full().children(head)];
    card.extend(entries);
    if !tail.is_empty() {
        card.push(col().w_full().children(tail));
    }

    let sandbox_page = bot_id.to_owned();
    let details = pressable(
        button(t, Kind::Ghost, Size::Small, None, "Sandbox details").key("rd-files-sandbox"),
        true,
        move |s: &mut Ui| {
            s.open_settings(Some(Page::Bot {
                bot_id: sandbox_page.clone(),
                section: BotSection::Sandbox,
            }));
        },
    );
    group_with(
        t,
        "Workspace files",
        if container {
            "Browse live container files. Writes can appear even when a command fails. Downloads are limited to 8 MiB; files may change while processes run."
        } else {
            "Browse and download the last committed files. New files appear after the bot’s command finishes successfully."
        },
        Some(details),
        card,
    )
}

/// " · 18.0 MiB of 100.0 MiB": how full the workspace is.
fn usage(info: &SandboxInfo) -> String {
    let used = match info.usage.file_bytes {
        Some(used) => bytes(used),
        None => "Usage unavailable".to_owned(),
    };
    match info.limits.file_bytes {
        Some(limit) => format!(" · {used} of {}", bytes(limit)),
        None => format!(" · {used} · No disk quota"),
    }
}

/// The folders down to this one, each a button, then Parent and Refresh.
fn toolbar(browser: &WorkspaceBrowser, t: &Theme) -> El {
    let trail = crumbs(&browser.path);
    let last = trail.len().saturating_sub(1);
    let mut folders = row()
        .role("navigation")
        .label("Workspace folders")
        .grow(1.0)
        .min_w(0.0)
        .flex_wrap()
        .center_y();
    for (index, (label, path)) in trail.into_iter().enumerate() {
        // The folder on screen is the last crumb; it goes nowhere.
        folders = folders.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, &label)
                .key(format!("rd-files-crumb-{index}")),
            index != last,
            move |s: &mut Ui| s.open_folder(&path),
        ));
    }
    let up = parent(&browser.path).map(str::to_owned);
    let actions = row()
        .gap(3.5)
        .child(pressable(
            icon_button(t, &icons::ARROW_UP, 15.0, "Parent folder").key("rd-files-up"),
            up.is_some(),
            move |s: &mut Ui| {
                if let Some(up) = &up {
                    s.open_folder(up);
                }
            },
        ))
        .child(pressable(
            icon_button(t, &icons::REFRESH_CW, 15.0, "Refresh workspace files")
                .key("rd-files-refresh"),
            !browser.loading,
            |s: &mut Ui| s.refresh_files(),
        ));
    row()
        .w_full()
        .padding(10.5)
        .gap(7.0)
        .justify_between()
        .items_start()
        .child(folders)
        .child(actions)
}

/// One file, folder or link: its icon, its name over what it is and when
/// it changed, and for a file a download button.
fn entry(item: &WorkspaceEntry, can_download: bool, t: &Theme) -> El {
    let (glyph, what) = match item.kind {
        WorkspaceKind::Directory => (&icons::FOLDER, "Folder".to_owned()),
        WorkspaceKind::Symlink => (&icons::LINK, "Symbolic link · not followed".to_owned()),
        WorkspaceKind::File => (&icons::FILE, bytes(item.bytes)),
    };
    let name = if item.kind == WorkspaceKind::Directory {
        // A folder's name opens it, underlined like the web's.
        let path = item.path.clone();
        text(item.name.clone())
            .key(format!("rd-file-{}", item.path))
            .role("button")
            .label(format!("Open folder {}", item.name))
            .font(font(12.25, 500.0))
            .color(t.foreground)
            // One span over the whole name draws the underline.
            .spans(vec![Span::new(0, item.name.len()).underline(t.foreground)])
            .wrap()
            .focusable(true)
            .self_start()
            .on_press(move |s: &mut Ui| s.open_folder(&path))
    } else {
        text(item.name.clone())
            .font(font(12.25, 500.0))
            .color(t.foreground)
            .wrap()
    };
    let mut line = row()
        .w_full()
        .px(14.0)
        .py(10.5)
        .gap(10.5)
        .center_y()
        .child(icon(glyph, 17.0).color(t.foreground).a11y_hidden())
        .child(
            col().grow(1.0).min_w(0.0).gap(3.5).child(name).child(
                text(format!("{what} · {}", date_time(item.modified_at)))
                    .font(font(10.5, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
            ),
        );
    if item.kind == WorkspaceKind::File {
        let (path, name) = (item.path.clone(), item.name.clone());
        line = line.child(pressable(
            icon_button(
                t,
                &icons::DOWNLOAD,
                16.0,
                &format!("Download {}", item.name),
            )
            .key(format!("rd-file-{}-download", item.path)),
            can_download,
            move |s: &mut Ui| s.download_file(&path, &name),
        ));
    }
    line
}
