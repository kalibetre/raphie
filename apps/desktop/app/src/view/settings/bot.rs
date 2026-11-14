//! A bot's settings pages.
//!
//! None of these has a native screen yet. Each shows the page's header, so
//! the navigation works, and offers the same page of the web workspace,
//! where the change applies to this app too. They are replaced one by one
//! as pages are built here.

use rune::{El, Tx};

use super::parts::{Scope, group, page, setting};
use crate::icons;
use crate::sections::{BotSection, Page};
use crate::state::Ui;
use crate::view::Look;
use crate::widgets::{Kind, Size, button};

pub fn bot_page(s: &Ui, bot_id: &str, section: BotSection, look: &Look) -> El {
    let t = &look.theme;
    let name = s
        .model
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .map_or(bot_id, |bot| bot.name.as_str());
    let target = Page::Bot {
        bot_id: bot_id.to_owned(),
        section,
    };
    let not_yet = group(
        t,
        section.label(),
        "This page is not in the desktop app yet.",
        vec![setting(
            t,
            None,
            "Change it in the browser",
            "The web workspace has this page. What you change there applies here too.",
            Some(
                button(
                    t,
                    Kind::Outline,
                    Size::Regular,
                    Some(&icons::EXTERNAL_LINK),
                    "Open in browser",
                )
                .key("rd-bot-page-web")
                .on_press_tx(move |s: &mut Ui, tx: &mut Tx| s.open_web(&target, tx)),
            ),
        )],
    );
    page(
        "rd-page-bot",
        section.label(),
        &section.lede(name),
        Scope::Bot { id: bot_id, name },
        vec![not_yet],
        look,
    )
}
