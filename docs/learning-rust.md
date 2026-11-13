# Learning Rust with the desktop client

This guide reads the [desktop client](desktop.md) as a Rust lesson. It assumes
you know TypeScript and Raphie, and shows each Rust idea where it actually
appears in `apps/desktop`, with the reason the code is written that way. Open
the files beside it; line numbers drift, so search for the names given.

Further reading when a topic here is not enough: [The Rust
Book](https://doc.rust-lang.org/book/) (chapters 4, 9, 10, 15, 16), [Rust by
Example](https://doc.rust-lang.org/rust-by-example/), the [Tokio
tutorial](https://tokio.rs/tokio/tutorial), and Rune's own README in its
repository.

## 1. Project layout: crates, workspaces and modules

`apps/desktop/Cargo.toml` is a **workspace**: one lockfile and one `target/`
directory shared by two **crates** (Rust's unit of compilation, like a package
in the Bun workspace):

| Crate                                                     | Kind             | Depends on                     |
| --------------------------------------------------------- | ---------------- | ------------------------------ |
| `core` (`raphie-desktop-core`, imported as `raphie_core`) | library          | reqwest, tokio, serde, keyring |
| `app` (`raphie-desktop`)                                  | library + binary | `raphie_core`, rune, rune-kit  |

The split is enforced by the compiler: `core/Cargo.toml` does not list Rune, so
no file in `core` can `use rune::...`. That is the same rule as the web app's
`bun run architecture` check, but you cannot forget to run it.

Inside a crate, `lib.rs` declares **modules** with `pub mod api;`, which loads
`src/api.rs`. Items are private to their module unless marked `pub`; `pub(crate)`
means "visible inside this crate only" (see `DecisionBody` in
`core/src/contracts.rs`, which the UI never needs to see). The app crate has
both `src/lib.rs` (the UI, so tests can import it) and `src/main.rs` (a few
lines that start it).

`rust-toolchain.toml` pins the compiler version, like `.bun-version`.
`Cargo.lock` pins every dependency, like `bun.lock`; CI passes `--locked` so it
fails if they disagree.

**Try:** run `cargo tree -p raphie-desktop-core --depth 1` to see the core's
direct dependencies, then the same for `raphie-desktop`.

## 2. Types that carry meaning

### Structs, enums and `Option`

`core/src/contracts.rs` mirrors the TypeScript contracts. A TypeScript union
of string literals becomes an `enum`:

```rust
pub enum TurnStatus { Pending, Done, Error, #[serde(other)] Unknown }
```

`match` on an enum must handle every variant, so when you add one the compiler
lists every place that needs a decision. `Option<T>` replaces `T | null`:
`answer: Option<String>` is either `Some(text)` or `None`, and you cannot use
the text without checking.

Enums can carry data, which TypeScript expresses as discriminated unions. Look
at `AuthState` in `core/src/model.rs`:

```rust
pub enum AuthState {
    SignedOut { notice: Option<String> },
    Connecting,
    AwaitingApproval(DeviceCode),
    SignedIn,
}
```

A device code exists only while waiting for approval; there is no way to have a
"signed in" state with a stale code lying around, because the type does not
allow it.

### Newtypes: parse, don't validate

`Origin` in `core/src/origin.rs` wraps a `String` but has a private field and
one constructor, `Origin::parse`, which rejects plain HTTP off loopback and
anything with a path. Every function that takes an `&Origin` therefore knows it
was checked. `AccessToken` in `core/src/auth.rs` does the same for secrets: its
`Debug` implementation prints `AccessToken(<redacted>)`, and it has no
`Display`, so `println!("{token}")` does not compile.

**Try:** add a test in `origin.rs` that `Origin::parse("https://h:443")`
normalises to `https://h`. Run it with `cargo test -p raphie-desktop-core origin`.

### Traits

A **trait** is an interface. `TokenStore` in `auth.rs` has two
implementations: `KeychainStore` (the OS credential store) and `MemoryStore`
(tests). The engine holds an `Arc<dyn TokenStore>`: a pointer to _some_ type
implementing the trait, chosen at runtime ("dynamic dispatch"). The bound
`TokenStore: Send + Sync` promises the value may be moved to and shared between
threads, which the engine needs.

`serde`'s `#[derive(Deserialize)]` generates an implementation of the
`Deserialize` trait for you; `#[serde(rename_all = "camelCase")]` maps
`created_at` to the JSON's `createdAt`.

## 3. Ownership and borrowing, as they appear here

Every value has one owner; when the owner goes out of scope the value is
dropped (freed). You can lend it out as `&T` (shared, read-only, many at once)
or `&mut T` (exclusive, one at a time). The compiler checks these rules; there
is no garbage collector.

Places to look:

- **`Model::apply(&mut self, event: Event)`** in `model.rs` takes the model by
  exclusive borrow and the event **by value**: the event is moved in and
  consumed. Inside, `conversation.observe(*observation)` moves the boxed
  observation out of its `Box` (`*` dereferences) into the conversation. No
  copies of the (large) observation are made.
- **`Conversation::turns(&self) -> Vec<&SessionTurn>`** returns references
  into the conversation instead of cloned turns. The returned vector borrows
  `self`, so while you hold it you cannot change the conversation. That is a
  **lifetime** relationship the compiler infers: the output lives no longer
  than the input. Written out in full it would be
  `fn turns<'a>(&'a self) -> Vec<&'a SessionTurn>`.
- **`Conversation::observe`** uses `self.observation.take()`: `Option::take`
  moves the old value out and leaves `None`, so it can be consumed (its turns
  moved into `older`) while `self` is still borrowed mutably.
  `std::mem::take(&mut self.data)` in `sse.rs` does the same for a `String`.
- **Cloning on purpose**: in `view.rs`, a button's closure needs its own copy of
  the approval id (`let approve_id = approval.id.clone();` then `move |s| ...`)
  because the closure must outlive the `view` call, while `approval` is only
  borrowed for that call. `clone()` is explicit in Rust, so you can see every
  copy.
- **`&str` vs `String`**: `String` owns its text; `&str` borrows text owned by
  someone else. Functions take `&str` when they only read (`Origin::parse(input:
&str)`), and structs store `String`.

**Try:** in `model.rs`, change `turns()` to return `Vec<SessionTurn>` by
cloning (`.cloned()`), and notice that the callers still compile. Then revert it
and explain why the reference version is cheaper.

## 4. Errors without exceptions

Rust has no exceptions. A function that can fail returns `Result<T, E>`:
`Ok(value)` or `Err(error)`. The `?` operator returns the error to the caller
early:

```rust
let code: DeviceCodeResponse = read_json(send(request).await?).await?;
```

Choices in this codebase:

- **One error enum per layer, sorted by what to do next.** `ApiError` in
  `api.rs` distinguishes `Unauthenticated` (sign in again), `NotFound`,
  `Conflict`, `Network` (retry) and so on. Callers `match` on it; the engine's
  `send` retries only `is_transient()` errors, and every 401 becomes "signed
  out". `thiserror` derives the `Display` messages shown to the owner.
- **Errors become events at the boundary.** Tasks do not return errors to the
  UI; they turn them into `Event::Problem`, `Event::MessageFailed` or
  `Event::SignedOut { notice }`, which the model stores as text to show.
- **`unwrap()` and `expect()` panic** (crash) on an error. The app uses them
  only where failure is a programming bug (`expect("the engine's runtime
starts")`) and in tests. A poisoned `Mutex` in `MemoryStore` is recovered with
  `unwrap_or_else(|e| e.into_inner())` instead of panicking.
- **`Option` combinators** replace null checks:
  `self.observation.as_ref()?.next_before.clone()` returns `None` early if
  there is no observation.

**Try:** make `ApiClient::submit` reject an empty message before sending, with a
new `ApiError::Invalid(String)` variant. The compiler will show you every
`match` that must now handle it.

## 5. Async and threads

The UI must never wait for the network, or the window freezes. The app uses
two concurrency tools, each where it fits.

### Threads and channels (UI ↔ engine)

`core/src/engine.rs` starts a **Tokio runtime** (a pool of worker threads that
run async tasks) when the app starts. The UI and the engine never share
mutable state; they exchange messages:

- UI → engine: `Client::send(Command)` pushes onto a Tokio `mpsc` channel.
- Engine → UI: `Emitter::emit(Event)` pushes onto a standard library `mpsc`
  channel and calls `notify()`, which is Rune's `Waker`. Rune then runs the
  app's `poll` on the UI thread, which drains the events with
  `client.drain()` and applies them to the `Model`.

Because the `Engine` struct is owned by a single async task (its `run` loop),
it needs no `Mutex`. Spawned tasks get **clones** of what they need (an
`ApiClient`, an `Emitter`, a sender back to the engine's inbox) and report
results as messages. This is the actor pattern; Rust makes it natural because
the compiler will not let a task hold `&mut Engine` while the loop owns it.

### `Arc`, `Mutex`, `Send`, `Sync`

- `Arc<T>` is a reference-counted pointer that can be shared across threads
  (`Arc::clone` is cheap: it increments a counter). The token store and the
  notify callback are `Arc`s because several tasks hold them.
- `Mutex<T>` gives one thread at a time `&mut T`. `MemoryStore` needs one
  because tests read it while the engine writes it. `lock()` returns a guard;
  the lock is released when the guard is dropped.
- `Send` (may move to another thread) and `Sync` (may be shared between
  threads) are traits the compiler checks automatically. Try putting an
  `Rc` (the single-threaded `Arc`) in `Emitter` and read the error.

### async/await

An `async fn` returns a **future**: a value describing work that does nothing
until awaited. Tokio polls futures on its worker threads; `.await` gives the
thread back while waiting for I/O.

- `follow()` reads an event stream with `while let Some(chunk) =
body.next().await`, feeding bytes to the `SseParser` as they arrive.
- `tokio::time::sleep(wait).await` waits without blocking a thread
  (`std::thread::sleep` would block one).
- **Blocking work goes to `spawn_blocking`.** The OS credential store is a
  synchronous call that may block, so `sign_in` runs it with
  `tokio::task::spawn_blocking(move || store.load(&origin))`. Doing it directly
  in async code would stall a worker thread.
- **Cancellation is dropping.** `Task` in `engine.rs` wraps a `JoinHandle` and
  aborts the task in its `Drop` implementation. Assigning
  `self.session_stream = Some(Task::spawn(...))` drops the previous `Task`,
  which cancels the old conversation's stream. Cleanup tied to a value's
  lifetime is called RAII.
- **Fencing stale answers.** Events carry the bot or session id they belong
  to, and `Model::apply` ignores news for a conversation that is no longer open.

**Try:** change the reconnect backoff in `EngineConfig::default` to start at
2 seconds, then run `cargo test -p raphie-desktop-core --test engine` and see
which tests notice (none should: tests use their own fast config).

## 6. Generics, closures and iterators

- `follow<T: DeserializeOwned>(...)` is **generic**: the same function follows
  the session-list stream (`T = Page<SessionSummary>`) and a conversation
  stream (`T = SessionObservation`). The compiler generates a copy for each
  type, so there is no runtime cost.
- **Closures** capture variables from their scope. `wrap: impl Fn(T) -> Event`
  is "any closure from `T` to `Event`". In the UI, `on_press(|s: &mut Ui|
s.send())` passes a closure Rune stores and runs later; `move` makes it own
  what it captures.
- **Iterators** chain lazily: `model.session_list()` returns `impl Iterator`
  that walks the live first page then the extra pages, skipping duplicates,
  without building a new vector.

## 7. Rune's view, state and update model

Rune works like React without hooks, and closer to Elm:

1. **State** is one plain struct, `Ui` in `app/src/state.rs`, owned by Rune.
2. **View** is a pure function, `view(s: &Ui, cx: &mut Cx<Ui>) -> El`, in
   `app/src/view.rs`. It builds a tree of elements with builder methods:
   `col().gap(8.0).child(text("Hi"))`. It only _reads_ state (`&Ui`).
3. **Updates** happen in handlers. `.on_press(|s: &mut Ui| ...)` gives a
   closure exclusive access to the state between frames. After handlers run,
   Rune calls `view` again, diffs the new tree against the old one by **key**,
   and animates what changed on springs.
4. **Outside news** arrives through `poll`, which Rune calls before a frame
   (after the engine's `notify` wakes it). `state::poll` drains engine events
   into the model and returns `true` when the view should be rebuilt.

Other things to notice:

- `AppSpec` (in `app/src/lib.rs`) takes plain function pointers (`fn`), not
  closures, for `init`, `view`, `setup`, `poll` and `on_key`.
- **Keys** identify elements across rebuilds and for tests. rune-kit uses short
  keys for the parts of its components, so this app prefixes its own with `rd-`.
- **rune-kit** provides themed components (`Button`, `TextArea`, `Markdown`,
  `SplitView`, `Sidebar`) that read colours from a `Kit`.
  `Kit::neutral(cx.system_dark())` follows the OS appearance, and Rune animates
  the colours when it changes.
- **Headless mode**: the same binary renders PNGs (`--snap`), dumps the element
  tree (`--tree`) and replays scripted input (`--script`), all on a virtual
  clock. Tests use `rune::Runtime` directly: `Runtime::new(state, view, size,
Env::new(dark, 2.0))`, then `rt.find(key)`, `rt.pointer_down/up`,
  `rt.paste(..)` and `rt.elements()`. See `app/tests/screens.rs`.

## 8. Testing

- **Unit tests** live next to the code in `#[cfg(test)] mod tests` blocks and
  can see private items (`sse.rs`, `origin.rs`, `auth.rs`).
- **Integration tests** in `core/tests/` use only the public API. The engine
  tests start a fake web host (`core/tests/support/mod.rs`, built with axum) on
  a random loopback port and drive the real engine through sign-in, streams,
  paging, sending and approvals. Timings come from `EngineConfig`, so tests do
  not sleep for real polling intervals.
- **UI tests** in `app/tests/screens.rs` render scenes in light and dark and
  click through them headlessly.

Run one test by name: `cargo test -p raphie-desktop-core revocation`.

## 9. Exercises

Small, self-contained changes, roughly in order of difficulty:

1. **Character counter.** Show "1,234 / 4,000" under the composer when the
   draft is over 3,500 characters. (View only: `composer()` in `view.rs`.)
2. **Copy code.** Use `Markdown::code_frame` in rune-kit to add a Copy button to
   code blocks (`tx.copy(...)` from a handler).
3. **Unread dots.** Mark a session row when its `lastAt` changes while it is
   not open. Where should "last seen" live: the core model or the UI state?
   (Hint: it is presentation state, but you may want it to survive a restart.)
4. **Approve for session.** The runtime accepts `scope: "session"` for command
   approvals (see [Using Raphie](using-raphie.md#command-permissions)). Add a
   third button for command approvals only. You will touch `DecisionBody`,
   `Command::Decide`, the view and a fake-host test.
5. **Stop.** Add a Stop button while a reply is generating, using `POST
/api/sessions/<id>/control` with `{ "action": "stop" }`. Add the route to
   the fake host first and write the failing test.
6. **Reconnect indicator test.** Write an engine test where the fake host drops
   the conversation stream and assert the model goes `Reconnecting` then
   `Live`.
7. **Contract drift check.** Write a test that decodes a session observation
   captured from the fixture (`curl` it with a device token) and fails if a
   field the app reads is missing.

When you finish one, run the three checks from [desktop.md](desktop.md#check-your-changes).
