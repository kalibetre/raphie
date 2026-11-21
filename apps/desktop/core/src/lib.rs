//! The core of Raphie's desktop client, independent of any UI framework.
//!
//! - [`origin`]: the web host address, validated once.
//! - [`contracts`]: Rust mirrors of the `@raphie/contracts` types this client reads.
//! - [`api`]: HTTP calls to the web host's authenticated API.
//! - [`sse`]: the event-stream parser.
//! - [`auth`]: device sign-in rules and token storage.
//! - [`model`]: client state and how each event changes it (pure, no I/O).
//! - [`projections`]: tool steps, usage and labels worked out from activity.
//! - [`model_library`]: filtering and labelling the models a bot can run.
//! - [`mcp`]: what a new MCP connection carries, and its checks.
//! - [`memory`]: what a save of a bot's memory settings carries, and its checks.
//! - [`handoffs`]: tasks a bot handed to others, as cards and the composer show them.
//! - [`mentions`]: "@Name" for another bot, typed and shown.
//! - [`engine`]: the background runtime that does the I/O and reports events.
//! - [`settings`]: non-secret preferences.
//! - [`last_sessions`]: the conversation last open with each bot.
//! - [`flavor`]: the dev build and the release build, kept apart.
//! - [`updates`]: this app's version, and whether a newer one is released.
//! - [`local_install`]: finding a Raphie installed on this computer.
//!
//! A UI (today the Rune app in `../app`) owns a [`model::Model`], sends
//! [`engine::Command`]s through an [`engine::Client`] and applies the
//! [`model::Event`]s it drains. Future desktop-host capabilities (local speech
//! to text, computer use, the owner's browser) belong beside these modules,
//! not in the UI crate.

pub mod api;
pub mod attachments;
pub mod auth;
pub mod channels;
pub mod contracts;
pub mod engine;
pub mod flavor;
pub mod handoffs;
pub mod inbox;
pub mod inspection;
pub mod jobs;
pub mod last_sessions;
pub mod local_install;
pub mod mcp;
pub mod memory;
pub mod mentions;
pub mod model;
pub mod model_library;
pub mod origin;
pub mod permissions;
pub mod projections;
pub mod replies;
pub mod sandbox;
pub mod settings;
pub mod skills;
pub mod slash;
pub mod sse;
pub mod updates;
pub mod workspace;
