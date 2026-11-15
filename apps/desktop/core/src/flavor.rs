//! Which build this is: the one for working on Raphie, or the one to use.
//!
//! The two are separate apps on one computer. Each has its own name, its
//! own identifier (so macOS keeps their permissions apart), its own
//! settings folder and its own sign-in, so trying a change in the dev build
//! can never disturb the app in daily use.

/// The kind of build.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flavor {
    /// A debug build: `cargo run`, `cargo test`, `scripts/bundle.sh`.
    Dev,
    /// An optimised build: `cargo build --release`,
    /// `scripts/bundle.sh --release`.
    Release,
}

impl Flavor {
    /// The flavor of the running program.
    ///
    /// `cfg!(debug_assertions)` is decided when the program is compiled:
    /// true in Cargo's `dev` profile and false with `--release`. A `const
    /// fn` can be evaluated at compile time, so this costs nothing.
    pub const fn current() -> Flavor {
        if cfg!(debug_assertions) {
            Flavor::Dev
        } else {
            Flavor::Release
        }
    }

    /// The name people see: the window, the Dock, a notification.
    pub const fn app_name(self) -> &'static str {
        match self {
            Flavor::Dev => "Raphie Dev",
            Flavor::Release => "Raphie",
        }
    }

    /// The app's identifier: the bundle identifier on macOS and the
    /// service name of the stored sign-in. `scripts/bundle.sh` writes the
    /// same two values; keep them in step.
    pub const fn identifier(self) -> &'static str {
        match self {
            Flavor::Dev => "dev.raphie.desktop.dev",
            Flavor::Release => "dev.raphie.desktop",
        }
    }

    /// The folder under the system's config directory that holds this
    /// build's files.
    pub const fn config_folder(self) -> &'static str {
        match self {
            Flavor::Dev => "raphie-desktop-dev",
            Flavor::Release => "raphie-desktop",
        }
    }

    pub const fn is_dev(self) -> bool {
        matches!(self, Flavor::Dev)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_builds_share_nothing() {
        let (dev, release) = (Flavor::Dev, Flavor::Release);
        assert_ne!(dev.app_name(), release.app_name());
        assert_ne!(dev.identifier(), release.identifier());
        assert_ne!(dev.config_folder(), release.config_folder());
    }

    #[test]
    fn the_release_build_keeps_the_names_already_in_use() {
        // Files and the sign-in saved before the split belong to these.
        assert_eq!(Flavor::Release.identifier(), "dev.raphie.desktop");
        assert_eq!(Flavor::Release.config_folder(), "raphie-desktop");
    }

    #[test]
    fn tests_run_as_the_dev_build() {
        assert_eq!(Flavor::current(), Flavor::Dev);
    }
}
