//! Settings → Skills: a bot's skills, one skill's files in an editor, and
//! the dialog that imports skills from a .zip or GitHub.
//!
//! Mirrors `skill-settings.tsx` and `shared/styles/settings/skills.css`.
//! The page's state is in `crate::skills`.

use raphie_core::contracts::SkillSummary;
use raphie_core::engine::Command;
use rune::{El, Tx, col, el, row, text, text_input};
use rune_kit::Dialog;

use super::parts::{
    SaveBar, Scope, group, group_heading, group_with, page, save_bar, setting, status,
};
use crate::sections::BotSection;
use crate::skills::{SkillEditor, SkillsMode};
use crate::state::Ui;
use crate::theme::{Theme, font, mono};
use crate::view::Look;
use crate::widgets::{Field, Kind, Size, button, pressable, switch, text_field};

pub fn skills(s: &Ui, bot_id: &str, look: &Look, overlays: &mut Vec<El>) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let body = match (&s.skills.mode, s.model.skills.get(bot_id)) {
        (SkillsMode::List, Some(items)) => {
            import_dialog(s, look, overlays);
            vec![list(s, items, t), how_they_work(t)]
        }
        (SkillsMode::List, None) => vec![loading(s, bot_id, t)],
        (mode, _) => match &s.skills.editor {
            Some(editor) => editor_page(s, mode, editor, look, overlays),
            None => vec![back(t), opening(s, t)],
        },
    };
    page(
        "rd-page-skills",
        "Skills",
        &BotSection::Skills.lede(name),
        Scope::Bot { id: bot_id, name },
        body,
        look,
    )
}

fn loading(s: &Ui, bot_id: &str, t: &Theme) -> El {
    let failed = s
        .model
        .skills_error
        .as_ref()
        .is_some_and(|(bot, _)| bot == bot_id);
    if !failed {
        return status(t, "Skills", "Loading skills…", None);
    }
    let bot_id = bot_id.to_owned();
    status(
        t,
        "Skills",
        "Could not load skills.",
        Some(pressable(
            button(t, Kind::Outline, Size::Regular, None, "Retry").key("rd-skills-retry"),
            true,
            move |s: &mut Ui| {
                s.model.skills_error = None;
                s.command(Command::LoadSkills {
                    bot_id: bot_id.clone(),
                });
            },
        )),
    )
}

/// The skill for the editor is on its way, or could not be fetched.
fn opening(s: &Ui, t: &Theme) -> El {
    match &s.model.skill_error {
        Some(error) => status(t, "Skill", error, None),
        None => status(t, "Skill", "Loading skill…", None),
    }
}

/// "Skills": one row per skill, with Import and New skill beside the title.
fn list(s: &Ui, items: &[SkillSummary], t: &Theme) -> El {
    let busy = s.model.changing_skill;
    let on = items
        .iter()
        .filter(|skill| skill.enabled && skill.problem.is_none())
        .count();
    let note = if items.is_empty() {
        "Instructions for particular tasks, read only when a task needs them.".to_owned()
    } else {
        format!(
            "{} {} · {on} on. The bot reads a skill when a task matches its description.",
            items.len(),
            if items.len() == 1 { "skill" } else { "skills" }
        )
    };
    let actions = row()
        .gap(8.0)
        .center_y()
        .child(pressable(
            button(t, Kind::Outline, Size::Small, None, "Import").key("rd-skills-import"),
            !busy,
            |s: &mut Ui| s.skills.import.open = true,
        ))
        .child(pressable(
            button(t, Kind::Primary, Size::Small, None, "New skill").key("rd-skills-new"),
            !busy,
            |s: &mut Ui| s.new_skill(),
        ));
    let mut rows: Vec<El> = items
        .iter()
        .map(|skill| skill_row(skill, busy, t))
        .collect();
    if items.is_empty() {
        rows.push(setting(
            t,
            None,
            "No skills yet",
            "Write one, or import a skill folder as a .zip or from GitHub. The bot can also write its own in skills/ in its workspace.",
            None,
        ));
    }
    let mut out =
        col()
            .w_full()
            .gap(10.0)
            .child(group_with(t, "Skills", &note, Some(actions), rows));
    if let Some(error) = &s.model.skill_change_error {
        out = out.child(
            text(error.clone())
                .key("rd-skills-error")
                .role("alert")
                .font(font(12.25, 400.0))
                .color(t.error)
                .wrap(),
        );
    }
    out
}

fn skill_row(skill: &SkillSummary, busy: bool, t: &Theme) -> El {
    let key = |part: &str| format!("rd-skill-{}-{part}", skill.name);
    let usable = skill.problem.is_none();
    let on = skill.enabled && usable;
    let description = match &skill.problem {
        Some(problem) => text(problem.clone()).color(t.error),
        None => text(skill.description.clone()).color(t.muted_foreground),
    };
    let copy = col()
        .grow(1.0)
        .min_w(0.0)
        .gap(2.0)
        .child(
            text(skill.name.clone())
                .font(font(13.5, 560.0))
                .color(t.foreground),
        )
        .child(
            description
                .key(key("description"))
                .font(font(12.5, 400.0))
                .wrap(),
        )
        .child(
            text(skill.files.join(" · "))
                .font(mono(11.0))
                .color(t.muted_foreground)
                .wrap(),
        );
    let (edit_name, toggle_name) = (skill.name.clone(), skill.name.clone());
    let actions = row()
        .gap(8.0)
        .center_y()
        .child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Edit").key(key("edit")),
            !busy,
            move |s: &mut Ui| s.open_skill(&edit_name),
        ))
        .child(pressable(
            switch(t, on, &format!("Use {}", skill.name)).key(key("toggle")),
            !busy && usable,
            move |s: &mut Ui| s.enable_skill(&toggle_name, !on),
        ));
    row()
        .key(format!("rd-skill-{}", skill.name))
        .w_full()
        .px(18.0)
        .py(14.0)
        .gap(16.0)
        .center_y()
        .child(copy)
        .child(actions)
}

fn how_they_work(t: &Theme) -> El {
    group_heading(
        t,
        "How skills work",
        "Each skill is a folder in this bot's workspace, skills/<name>/, holding a SKILL.md in the standard Agent Skills format. The bot sees every skill's name and description, reads a whole skill only when a task matches, and runs its scripts in the sandbox. Skills never grant tools or permissions.",
        None,
    )
}

fn back(t: &Theme) -> El {
    pressable(
        button(t, Kind::Ghost, Size::Small, None, "← All skills").key("rd-skills-back"),
        true,
        |s: &mut Ui| s.back_to_skills(),
    )
    .self_start()
}

/// The editor: the skill's files on the left, the open one on the right.
fn editor_page(
    s: &Ui,
    mode: &SkillsMode,
    editor: &SkillEditor,
    look: &Look,
    overlays: &mut Vec<El>,
) -> Vec<El> {
    let t = &look.theme;
    let busy = s.model.changing_skill;
    let (title, note) = match mode {
        SkillsMode::Edit(name) => (
            name.clone(),
            format!("skills/{name}/ in this bot's workspace."),
        ),
        _ => (
            match editor.name() {
                name if name.is_empty() => "New skill".to_owned(),
                name => name,
            },
            "The name in SKILL.md becomes the folder: lowercase letters, digits and hyphens."
                .to_owned(),
        ),
    };
    let mut files = col()
        .key("rd-skill-files")
        .w(200.0)
        .min_h(380.0)
        .padding(10.0)
        .gap(2.0)
        .fill(t.muted)
        .border_sides([0.0, 1.0, 0.0, 0.0], t.border);
    for (index, (path, _)) in editor.files.iter().enumerate() {
        let open = index == editor.open;
        let mut entry = row()
            .key(format!("rd-skill-file-{index}"))
            .w_full()
            .px(8.0)
            .py(5.0)
            .radius(6.0)
            .child(
                text(path.clone())
                    .font(mono(12.0))
                    .color(if open {
                        t.foreground
                    } else {
                        t.muted_foreground
                    })
                    .wrap(),
            );
        if open {
            entry = entry.fill(t.background);
        }
        files = files.child(pressable(entry, true, move |s: &mut Ui| {
            if let Some(editor) = &mut s.skills.editor {
                editor.open = index;
            }
        }));
    }
    for path in &editor.binaries {
        files = files.child(
            row().w_full().px(8.0).py(5.0).child(
                text(path.clone())
                    .font(mono(12.0).italic())
                    .color(t.muted_foreground)
                    .wrap(),
            ),
        );
    }
    // The new-file field sits at the bottom of the column.
    files = files.child(el().grow(1.0)).child(
        col()
            .w_full()
            .gap(6.0)
            .pt(12.0)
            .child(text_field(
                t,
                Field {
                    key: "rd-skill-new-path",
                    label: "New file path",
                    placeholder: "references/notes.md",
                    edit: &editor.new_path,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.skills.editor.as_mut().expect("editor open").new_path,
                |s: &mut Ui, _: &mut Tx| {
                    if let Some(editor) = &mut s.skills.editor {
                        editor.add_file();
                    }
                },
            ))
            .child(pressable(
                button(t, Kind::Outline, Size::Small, None, "Add file").key("rd-skill-add-file"),
                !busy && editor.can_add(),
                |s: &mut Ui| {
                    if let Some(editor) = &mut s.skills.editor {
                        editor.add_file();
                    }
                },
            )),
    );
    let (path, edit) = &editor.files[editor.open.min(editor.files.len() - 1)];
    let mut bar = row()
        .w_full()
        .h(40.0)
        .pl(14.0)
        .pr(8.0)
        .justify_between()
        .center_y()
        .border_sides([0.0, 0.0, 1.0, 0.0], t.border)
        .child(
            text(path.clone())
                .key("rd-skill-open-path")
                .font(mono(12.0))
                .color(t.foreground),
        );
    if path != "SKILL.md" {
        bar = bar.child(pressable(
            button(t, Kind::Ghost, Size::Small, None, "Remove file").key("rd-skill-remove-file"),
            !busy,
            |s: &mut Ui| {
                if let Some(editor) = &mut s.skills.editor {
                    editor.remove_open();
                }
            },
        ));
    }
    let mut input = text_input(edit, mono(12.5).lh(20.0))
        .key("rd-skill-text")
        .label(path.clone())
        .w_full()
        .color(t.foreground)
        .caret(t.foreground, t.selection())
        .disabled(busy);
    if !busy {
        input = input
            .on_edit(|s: &mut Ui| {
                let editor = s.skills.editor.as_mut().expect("editor open");
                let open = editor.open.min(editor.files.len() - 1);
                editor.note = None;
                &mut editor.files[open].1
            })
            // In a file, Return starts a new line instead of submitting.
            .on_submit(|s: &mut Ui, _: &mut Tx| {
                if let Some(editor) = &mut s.skills.editor {
                    let open = editor.open.min(editor.files.len() - 1);
                    editor.files[open].1.insert("\n");
                }
            });
    }
    let text_area = col().grow(1.0).min_w(0.0).child(bar).child(
        col()
            .key("rd-skill-text-box")
            .w_full()
            .grow(1.0)
            .min_h(340.0)
            .padding(14.0)
            .child(input)
            .on_press_tx(|_: &mut Ui, tx: &mut Tx| tx.focus("rd-skill-text", false)),
    );
    let mut card = vec![row().w_full().child(files).child(text_area)];
    if !editor.binaries.is_empty() {
        card.push(
            col().w_full().px(14.0).py(10.0).child(
                text("Files that are not text are kept as they are; change them in the workspace.")
                    .font(font(12.0, 400.0))
                    .color(t.muted_foreground)
                    .wrap(),
            ),
        );
    }
    let mut out = vec![back(t), group(t, &title, &note, card)];
    if let SkillsMode::Edit(name) = mode {
        out.push(group_heading(
            t,
            "Delete skill",
            "Removes the skill's folder from the workspace.",
            Some(pressable(
                button(t, Kind::Destructive, Size::Small, None, "Delete…").key("rd-skill-delete"),
                !busy,
                |s: &mut Ui| {
                    if let Some(editor) = &mut s.skills.editor {
                        editor.confirm_delete = true;
                    }
                },
            )),
        ));
        if editor.confirm_delete {
            delete_dialog(name, busy, look, overlays);
        }
    }
    out
}

fn delete_dialog(name: &str, busy: bool, look: &Look, overlays: &mut Vec<El>) {
    let t = &look.theme;
    let close = |s: &mut Ui| {
        if let Some(editor) = &mut s.skills.editor {
            editor.confirm_delete = false;
        }
    };
    let body = col()
        .w_full()
        .px(16.0)
        .pb(16.0)
        .gap(16.0)
        .child(
            text("Its folder and every file in it are removed from the workspace.")
                .font(font(12.5, 400.0))
                .color(t.muted_foreground)
                .wrap(),
        )
        .child(
            row()
                .w_full()
                .gap(8.0)
                .justify_end()
                .child(pressable(
                    button(t, Kind::Outline, Size::Regular, None, "Cancel")
                        .key("rd-skill-delete-cancel"),
                    !busy,
                    close,
                ))
                .child(pressable(
                    button(
                        t,
                        Kind::Destructive,
                        Size::Regular,
                        None,
                        if busy { "Deleting…" } else { "Delete skill" },
                    )
                    .key("rd-skill-delete-confirm"),
                    !busy,
                    |s: &mut Ui| s.remove_skill(),
                )),
        );
    Dialog::new("rd-skill-delete-dialog", format!("Delete {name}?"))
        .width(440.0)
        .fit()
        .open(true)
        .on_close(close)
        .child(body)
        .build(&look.kit, overlays);
}

/// "Import skills": a .zip from this machine, or a GitHub link.
fn import_dialog(s: &Ui, look: &Look, overlays: &mut Vec<El>) {
    let form = &s.skills.import;
    if !form.open {
        return;
    }
    let t = &look.theme;
    let busy = s.model.changing_skill;
    let tab = |label: &str, key: &str, on: bool, github: bool| {
        let mut chip = row()
            .key(key.to_owned())
            .grow(1.0)
            .h(28.0)
            .center()
            .radius(6.0)
            .child(text(label.to_owned()).font(font(12.5, 500.0)).color(if on {
                t.foreground
            } else {
                t.muted_foreground
            }));
        if on {
            chip = chip.fill(t.background);
        }
        pressable(chip, !busy, move |s: &mut Ui| {
            s.skills.import.github = github
        })
    };
    let tabs = row()
        .w_full()
        .padding(3.0)
        .gap(3.0)
        .radius(8.0)
        .fill(t.muted)
        .child(tab(
            ".zip file",
            "rd-skills-import-zip-tab",
            !form.github,
            false,
        ))
        .child(tab(
            "GitHub link",
            "rd-skills-import-github-tab",
            form.github,
            true,
        ));
    let source = if form.github {
        col()
            .w_full()
            .gap(6.0)
            .child(text_field(
                t,
                Field {
                    key: "rd-skills-import-url",
                    label: "GitHub link",
                    placeholder: "https://github.com/owner/repo/tree/main/skills/pdf",
                    edit: &form.url,
                    disabled: busy,
                    compact: true,
                },
                |s: &mut Ui| &mut s.skills.import.url,
                |s: &mut Ui, _: &mut Tx| s.import_skills(),
            ))
            .child(note(t, "A public repository, or a folder in one."))
    } else {
        let chosen = form.zip.as_ref().map_or_else(
            || "No file chosen".to_owned(),
            |path| {
                path.file_name()
                    .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
            },
        );
        col()
            .w_full()
            .gap(6.0)
            .child(
                row()
                    .w_full()
                    .gap(10.0)
                    .center_y()
                    .child({
                        let choose = button(t, Kind::Outline, Size::Small, None, "Choose .zip…")
                            .key("rd-skills-import-choose");
                        if busy {
                            choose.disabled(true).layer_opacity(0.5)
                        } else {
                            choose.on_press_tx(|_: &mut Ui, tx: &mut Tx| Ui::choose_skill_zip(tx))
                        }
                    })
                    .child(
                        text(chosen)
                            .key("rd-skills-import-file")
                            .font(font(12.5, 400.0))
                            .color(t.muted_foreground),
                    ),
            )
            .child(note(t, "Up to 8 MiB."))
    };
    let mut body = col()
        .w_full()
        .px(16.0)
        .pb(16.0)
        .gap(14.0)
        .child(note(
            t,
            "Every folder with a SKILL.md becomes a skill in this bot's workspace.",
        ))
        .child(tabs)
        .child(source)
        .child(
            row()
                .gap(10.0)
                .center_y()
                .child(pressable(
                    switch(t, form.replace, "Replace skills with the same name")
                        .key("rd-skills-import-replace"),
                    !busy,
                    |s: &mut Ui| s.skills.import.replace = !s.skills.import.replace,
                ))
                .child(
                    text("Replace skills with the same name")
                        .font(font(12.5, 400.0))
                        .color(t.foreground),
                ),
        );
    if let Some(error) = &s.model.skill_change_error {
        body = body.child(
            text(error.clone())
                .key("rd-skills-import-error")
                .role("alert")
                .font(font(12.25, 400.0))
                .color(t.error)
                .wrap(),
        );
    }
    body = body.child(
        row().w_full().justify_end().child(pressable(
            button(
                t,
                Kind::Primary,
                Size::Regular,
                None,
                if busy { "Importing…" } else { "Import" },
            )
            .key("rd-skills-import-confirm"),
            !busy && form.ready(),
            |s: &mut Ui| s.import_skills(),
        )),
    );
    Dialog::new("rd-skills-import-dialog", "Import skills")
        .width(480.0)
        .fit()
        .open(true)
        .on_close(|s: &mut Ui| {
            if !s.model.changing_skill {
                s.skills.import.open = false;
                s.model.skill_change_error = None;
            }
        })
        .child(body)
        .build(&look.kit, overlays);
}

fn note(t: &Theme, content: &str) -> El {
    text(content.to_owned())
        .font(font(12.0, 400.0).lh(19.2))
        .color(t.muted_foreground)
        .wrap()
}

/// The save bar under the editor.
pub fn skill_save_bar(s: &Ui, look: &Look) -> Option<El> {
    let editor = s.skills.editor.as_ref()?;
    let creating = s.skills.mode == SkillsMode::New;
    let dirty = editor.is_dirty();
    let saving = s.model.changing_skill;
    let error = s.model.skill_change_error.clone().or_else(|| {
        (editor.name().is_empty()).then(|| "SKILL.md needs a name in its frontmatter.".to_owned())
    });
    let message = editor
        .note
        .clone()
        .or_else(|| s.model.skill_message.clone());
    if !(creating || dirty || saving || message.is_some() || error.is_some()) {
        return None;
    }
    let status = match message {
        Some(message) => message,
        None if dirty => "Unsaved changes".to_owned(),
        None => "A new skill".to_owned(),
    };
    Some(save_bar(
        &look.theme,
        SaveBar {
            key: "rd-skill",
            error,
            status,
            save_label: if saving {
                "Saving…"
            } else if creating {
                "Create skill"
            } else {
                "Save changes"
            },
            can_save: s.can_save_skill(),
            can_discard: dirty && !saving,
            extra: None,
        },
        |s: &mut Ui| s.discard_skill(),
        |s: &mut Ui| s.save_skill(),
    ))
}
