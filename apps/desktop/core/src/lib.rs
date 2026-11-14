//! The core of Raphie's desktop client, independent of any UI framework.
//!
//! - [`origin`]: the web host address, validated once.
//! - [`contracts`]: Rust mirrors of the `@raphie/contracts` types this client reads.
//! - [`api`]: HTTP calls to the web host's authenticated API.
//! - [`sse`]: the event-stream parser.
//! - [`auth`]: device sign-in rules and token storage.
//! - [`model`]: client state and how each event changes it (pure, no I/O).
//! - [`projections`]: tool steps, usage and labels worked out from activity.
//! - [`engine`]: the background runtime that does the I/O and reports events.
//! - [`settings`]: non-secret preferences.
//!
//! A UI (today the Rune app in `../app`) owns a [`model::Model`], sends
//! [`engine::Command`]s through an [`engine::Client`] and applies the
//! [`model::Event`]s it drains. Future desktop-host capabilities (local speech
//! to text, computer use, the owner's browser) belong beside these modules,
//! not in the UI crate.

pub mod api;
pub mod auth;
pub mod contracts;
pub mod engine;
pub mod model;
pub mod origin;
pub mod projections;
pub mod settings;
pub mod sse;
