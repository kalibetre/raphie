//! This app's version, and whether a newer Raphie has been released.
//!
//! The version is Raphie's, from the repository's `VERSION` file, so the
//! desktop and the web report the same number. A build can stamp another
//! with the `RAPHIE_VERSION` environment variable at compile time, as the
//! release workflow does for the web (`v0.0.4-nightly.20261105.…`).
//!
//! The check reads Raphie's public releases on GitHub and only tells the
//! owner; nothing is downloaded or installed. It uses its own HTTP client,
//! never the signed-in one, so the host's token cannot reach GitHub.

use std::cmp::Ordering;
use std::time::Duration;

use serde::Deserialize;

/// Raphie's releases, newest first. Releases are public, so no token.
pub const RELEASES_URL: &str = "https://api.github.com/repos/kalibetre/raphie/releases?per_page=20";

/// Where a release's page may be, so a reply can never send the owner's
/// browser elsewhere.
const RELEASE_PAGES: &str = "https://github.com/kalibetre/raphie/releases/";

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// This build's version, without a leading "v": "0.0.4", or what
/// `RAPHIE_VERSION` said when it was compiled.
pub fn current_version() -> &'static str {
    // `option_env!` reads a variable at compile time: `Some` if it was set.
    // `include_str!` pastes a file's text into the program, also at compile
    // time; the path is relative to this source file. Cargo rebuilds when
    // that file changes.
    let raw = match option_env!("RAPHIE_VERSION") {
        Some(stamped) => stamped,
        None => include_str!("../../../../VERSION"),
    };
    let raw = raw.trim();
    raw.strip_prefix('v').unwrap_or(raw)
}

/// A version as Semantic Versioning orders them: `1.2.3`, or a pre-release
/// such as `1.2.3-alpha.2`, which comes before `1.2.3`. Build metadata
/// (`+…`) is ignored, as the standard says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    core: [u64; 3],
    /// The dot-separated parts after `-`; empty for a release.
    pre: Vec<Part>,
}

/// One pre-release part. Numbers compare as numbers and come before words.
/// The derived order follows the variants' order, then their values, which
/// is exactly that rule.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Part {
    Number(u64),
    Word(String),
}

impl Version {
    /// Reads "1.2.3", "v1.2.3" or "1.2.3-rc.1". `None` for anything else.
    pub fn parse(text: &str) -> Option<Version> {
        let text = text.trim();
        let text = text.strip_prefix('v').unwrap_or(text);
        // `split_once` cuts at the first match: ("1.2.3-a", "build").
        let text = text.split_once('+').map_or(text, |(before, _)| before);
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (text, None),
        };
        let mut numbers = core.split('.').map(|n| n.parse::<u64>().ok());
        // Each `?` returns `None` from `parse` if a number is missing or bad.
        let parsed = [numbers.next()??, numbers.next()??, numbers.next()??];
        if numbers.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(pre) => pre
                .split('.')
                .map(|part| {
                    if part.is_empty() {
                        None
                    } else if let Ok(n) = part.parse() {
                        Some(Part::Number(n))
                    } else {
                        Some(Part::Word(part.to_owned()))
                    }
                })
                // Collecting `Option`s into `Option<Vec<_>>` gives `None`
                // if any part was `None`.
                .collect::<Option<Vec<Part>>>()?,
        };
        Some(Version { core: parsed, pre })
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Version) -> Ordering {
        // `then_with` only looks further when the first answer is a tie.
        self.core
            .cmp(&other.core)
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                // A release comes after its own pre-releases.
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                // Part by part; when one runs out first, it is the smaller.
                // `Vec`'s own order does exactly this.
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Version) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// One release, as GitHub's API lists it (the fields this client reads).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Release {
    pub tag_name: String,
    pub html_url: String,
    #[serde(default)]
    pub draft: bool,
    /// Nightly builds are published as pre-releases.
    #[serde(default)]
    pub prerelease: bool,
}

/// A newer release than this build.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Update {
    /// The release's tag, as shown: "v0.0.5".
    pub version: String,
    /// Its page on GitHub.
    pub url: String,
}

/// The newest release after `current`, if there is one. Drafts, tags that
/// are not versions and pages outside Raphie's releases are skipped. A
/// stable build is only offered stable releases; a pre-release build (a
/// nightly) is offered both.
pub fn newest_after(current: &str, releases: &[Release]) -> Option<Update> {
    let current = Version::parse(current)?;
    let stable_only = current.pre.is_empty();
    releases
        .iter()
        .filter(|release| !release.draft && release.html_url.starts_with(RELEASE_PAGES))
        .filter(|release| !(stable_only && release.prerelease))
        // `filter_map` keeps the `Some`s: here, releases whose tag parses.
        .filter_map(|release| Some((Version::parse(&release.tag_name)?, release)))
        .filter(|(version, _)| !(stable_only && !version.pre.is_empty()))
        .filter(|(version, _)| *version > current)
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, release)| Update {
            version: release.tag_name.clone(),
            url: release.html_url.clone(),
        })
}

/// What the last check found.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum UpdateStatus {
    #[default]
    NotChecked,
    Checking,
    UpToDate,
    Available(Update),
    /// Why the check failed, for the owner.
    Failed(String),
}

impl UpdateStatus {
    /// Starts a check. False while one is already running.
    pub fn begin(&mut self) -> bool {
        if *self == UpdateStatus::Checking {
            return false;
        }
        *self = UpdateStatus::Checking;
        true
    }
}

/// Reads the releases at `url` and picks the newest after this build.
pub async fn check(url: &str) -> Result<Option<Update>, String> {
    let http = reqwest::Client::builder()
        // GitHub refuses requests that do not name their client.
        .user_agent(concat!("Raphie Desktop/", env!("CARGO_PKG_VERSION")))
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = http
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Could not reach GitHub.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}.", response.status().as_u16()));
    }
    let releases: Vec<Release> = response
        .json()
        .await
        .map_err(|_| "GitHub's answer was not a list of releases.".to_owned())?;
    Ok(newest_after(current_version(), &releases))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.to_owned(),
            html_url: format!("{RELEASE_PAGES}tag/{tag}"),
            draft: false,
            prerelease: Version::parse(tag).is_some_and(|version| !version.pre.is_empty()),
        }
    }

    #[test]
    fn versions_order_as_semver_says() {
        // The example list from semver.org §11, in order.
        let list = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.1.0",
            "2.0.0",
        ];
        for pair in list.windows(2) {
            assert!(v(pair[0]) < v(pair[1]), "{} < {}", pair[0], pair[1]);
        }
    }

    #[test]
    fn raphies_own_tags_read_as_versions() {
        assert_eq!(v("v0.0.4"), v("0.0.4"));
        assert!(v("v0.0.4-alpha.3") < v("0.0.4"));
        assert!(
            v("v0.0.4-nightly.20261103.41627452818.1") < v("v0.0.4-nightly.20261105.42029025663.1")
        );
        assert_eq!(v("1.2.3+build.5"), v("1.2.3"));
        for bad in [
            "",
            "1.2",
            "1.2.3.4",
            "nightly-41616363919-1",
            "1.2.3-",
            "1.2.3-a..b",
        ] {
            assert_eq!(Version::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_newest_later_release_is_offered() {
        let releases = [
            release("v0.0.4-nightly.20261105.42029025663.1"),
            release("v0.0.5-alpha.1"),
            release("v0.0.5"),
            release("nightly-41616363919-1"),
        ];
        let update = newest_after("0.0.4", &releases).unwrap();
        assert_eq!(update.version, "v0.0.5");
        assert!(update.url.ends_with("/tag/v0.0.5"));
    }

    #[test]
    fn nothing_is_offered_when_this_build_is_newest() {
        // A nightly of 0.0.4 comes before 0.0.4 itself.
        let releases = [
            release("v0.0.4-nightly.20261105.42029025663.1"),
            release("v0.0.4"),
        ];
        assert_eq!(newest_after("0.0.4", &releases), None);
    }

    #[test]
    fn a_stable_build_is_never_offered_a_nightly() {
        // Nightlies carry the next version, so they sort after this build.
        let releases = [
            release("v0.0.5-nightly.20261116.43858742213.1"),
            release("v0.0.5-alpha.1"),
        ];
        assert_eq!(newest_after("0.0.4", &releases), None);
        // GitHub's flag alone is enough, whatever the tag says.
        let mut flagged = release("v0.0.6");
        flagged.prerelease = true;
        assert_eq!(newest_after("0.0.4", &[flagged]), None);
    }

    #[test]
    fn a_nightly_build_is_offered_newer_nightlies_and_releases() {
        let current = "0.0.5-nightly.20261110.42000000000.1";
        let newer_nightly = release("v0.0.5-nightly.20261116.43858742213.1");
        let update = newest_after(current, &[newer_nightly]).unwrap();
        assert_eq!(update.version, "v0.0.5-nightly.20261116.43858742213.1");
        let update = newest_after(current, &[release("v0.0.5")]).unwrap();
        assert_eq!(update.version, "v0.0.5");
    }

    #[test]
    fn drafts_and_pages_elsewhere_are_skipped() {
        let mut draft = release("v9.0.0");
        draft.draft = true;
        let mut elsewhere = release("v8.0.0");
        elsewhere.html_url = "https://example.com/v8".into();
        assert_eq!(newest_after("0.0.4", &[draft, elsewhere]), None);
    }

    #[test]
    fn the_version_comes_from_the_repository() {
        assert!(Version::parse(current_version()).is_some());
        assert!(!current_version().starts_with('v'));
    }

    #[test]
    fn one_check_at_a_time() {
        let mut status = UpdateStatus::default();
        assert!(status.begin());
        assert!(!status.begin());
        status = UpdateStatus::UpToDate;
        assert!(status.begin());
    }
}
