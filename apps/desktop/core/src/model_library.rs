//! Settings → Models: grouping, filtering and labelling the models a bot can
//! run.
//!
//! In sync with `apps/web/src/domains/settings/application/model-library.ts`
//! (`modelSource`, `filterModels`) and the number formats in
//! `presentation/model-card.tsx`. The tests pin that code's output.

use crate::contracts::LibraryModel;
use crate::projections::to_fixed;

/// Who made a model, as the catalogue groups them: `id` for comparing,
/// `label` for showing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelSource {
    pub id: String,
    pub label: String,
}

/// The maker of `model`: the part of its name before a colon ("Anthropic:
/// Claude ..."), else the namespace of its id ("openai/gpt-x"), else its
/// provider.
pub fn model_source(model: &LibraryModel) -> ModelSource {
    let namespace = match model.id.split_once('/') {
        Some((namespace, _)) => namespace.trim_start_matches('~'),
        None => model.provider.as_str(),
    };
    let label = match model.name.split_once(':') {
        Some((maker, _)) => maker.trim().to_owned(),
        None => match namespace {
            "openai" => "OpenAI".to_owned(),
            "anthropic" => "Anthropic".to_owned(),
            "openrouter" => "OpenRouter".to_owned(),
            other => other.to_owned(),
        },
    };
    let id = label
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    ModelSource { id, label }
}

/// A model's name without its maker in front ("Anthropic: Claude" shows as
/// "Claude" under an "Anthropic" label).
pub fn short_name<'a>(model: &'a LibraryModel, source: &ModelSource) -> &'a str {
    model
        .name
        .strip_prefix(&format!("{}:", source.label))
        .map_or(model.name.as_str(), str::trim)
}

/// What the owner narrowed the list to. `None` means "all".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ModelFilter {
    /// Matched against the name, id and provider, whatever the case.
    pub search: String,
    pub provider: Option<String>,
    /// A [`ModelSource::id`].
    pub source: Option<String>,
    pub connection: Option<String>,
}

impl ModelFilter {
    pub fn is_active(&self) -> bool {
        !self.search.is_empty()
            || self.provider.is_some()
            || self.source.is_some()
            || self.connection.is_some()
    }
}

/// The models that pass `filter`, in the catalogue's order.
pub fn filter_models<'a>(
    models: &'a [LibraryModel],
    filter: &ModelFilter,
) -> Vec<&'a LibraryModel> {
    let query = filter.search.trim().to_lowercase();
    // `is_none_or`: no choice lets every model through.
    let chosen =
        |choice: &Option<String>, value: &str| choice.as_deref().is_none_or(|c| c == value);
    models
        .iter()
        .filter(|model| {
            chosen(&filter.provider, &model.provider)
                && chosen(&filter.source, &model_source(model).id)
                && chosen(&filter.connection, &model.connection_id)
                && format!("{} {} {}", model.name, model.id, model.provider)
                    .to_lowercase()
                    .contains(&query)
        })
        .collect()
}

/// Every maker among `models`, once each, sorted by label.
pub fn sources(models: &[LibraryModel]) -> Vec<ModelSource> {
    let mut sources: Vec<ModelSource> = Vec::new();
    for model in models {
        let source = model_source(model);
        if !sources.iter().any(|seen| seen.id == source.id) {
            sources.push(source);
        }
    }
    // By label, whatever the case.
    sources.sort_by_key(|source| source.label.to_lowercase());
    sources
}

/// A token count in short form: "128K", "1M", "8.2K".
pub fn compact_tokens(value: u64) -> String {
    const UNITS: [(u64, &str); 4] = [
        (1_000, "K"),
        (1_000_000, "M"),
        (1_000_000_000, "B"),
        (1_000_000_000_000, "T"),
    ];
    if value < 1_000 {
        return value.to_string();
    }
    // The largest unit that fits, counted in tenths with halves rounded up.
    let mut index = UNITS
        .iter()
        .rposition(|(size, _)| value >= *size)
        .unwrap_or(0);
    let tenths = |size: u64| (value as u128 * 10 + size as u128 / 2) / size as u128;
    let mut count = tenths(UNITS[index].0);
    // 999,950 rounds to "1000K": say "1M" instead.
    if count >= 10_000 && index + 1 < UNITS.len() {
        index += 1;
        count = tenths(UNITS[index].0);
    }
    let unit = UNITS[index].1;
    if count % 10 == 0 {
        format!("{}{unit}", count / 10)
    } else {
        format!("{}.{}{unit}", count / 10, count % 10)
    }
}

/// US dollars with two to four decimals: "$10.00", "$0.075", "$1,234.50".
pub fn price(value: f64) -> String {
    let exact = to_fixed(value.max(0.0), 4);
    let (whole, fraction) = exact.split_once('.').unwrap_or((&exact, ""));
    // Drop trailing zeros, but keep at least two decimals.
    let mut fraction = fraction.trim_end_matches('0').to_owned();
    while fraction.len() < 2 {
        fraction.push('0');
    }
    // A comma between each group of three digits, counted from the right.
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    format!("${grouped}.{fraction}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, name: &str, provider: &str) -> LibraryModel {
        LibraryModel {
            id: id.into(),
            name: name.into(),
            provider: provider.into(),
            connection_id: "c1".into(),
            connection_name: "Main".into(),
            context_window: 1_000_000,
            max_output_tokens: 128_000,
            reasoning: true,
            input_modalities: vec!["text".into()],
            pricing: None,
        }
    }

    /// The catalogue the expected values below were computed from, by
    /// running model-library.ts on the same models.
    fn catalogue() -> Vec<LibraryModel> {
        vec![
            model("acceptance", "Anthropic: Claude Fable Latest", "fixture"),
            model(
                "acceptance-alternate",
                "OpenRouter: Acceptance alternate",
                "fixture",
            ),
            model("openai/gpt-x", "GPT X", "openrouter"),
            model("~meta-llama/llama-9", "Llama 9", "openrouter"),
            model("claude-opus", "Claude Opus", "anthropic"),
            model("x-ai/grok", "xAI: Grok", "openrouter"),
        ]
    }

    #[test]
    fn sources_match_the_web_catalogue() {
        let found: Vec<(String, String)> = catalogue()
            .iter()
            .map(model_source)
            .map(|source| (source.id, source.label))
            .collect();
        let expected = [
            ("anthropic", "Anthropic"),
            ("openrouter", "OpenRouter"),
            ("openai", "OpenAI"),
            ("metallama", "meta-llama"),
            ("anthropic", "Anthropic"),
            ("xai", "xAI"),
        ];
        for ((id, label), (expected_id, expected_label)) in found.iter().zip(expected) {
            assert_eq!((id.as_str(), label.as_str()), (expected_id, expected_label));
        }
        let labels: Vec<String> = sources(&catalogue()).into_iter().map(|s| s.label).collect();
        assert_eq!(
            labels,
            ["Anthropic", "meta-llama", "OpenAI", "OpenRouter", "xAI"]
        );
        let first = &catalogue()[0];
        assert_eq!(
            short_name(first, &model_source(first)),
            "Claude Fable Latest"
        );
    }

    #[test]
    fn filters_match_the_web_catalogue() {
        let models = catalogue();
        let ids = |filter: ModelFilter| -> Vec<String> {
            filter_models(&models, &filter)
                .into_iter()
                .map(|model| model.id.clone())
                .collect()
        };
        let some = |value: &str| Some(value.to_owned());
        assert_eq!(
            ids(ModelFilter {
                search: " claude ".into(),
                ..ModelFilter::default()
            }),
            ["acceptance", "claude-opus"]
        );
        assert_eq!(
            ids(ModelFilter {
                provider: some("openrouter"),
                ..ModelFilter::default()
            }),
            ["openai/gpt-x", "~meta-llama/llama-9", "x-ai/grok"]
        );
        assert_eq!(
            ids(ModelFilter {
                source: some("anthropic"),
                ..ModelFilter::default()
            }),
            ["acceptance", "claude-opus"]
        );
        assert_eq!(
            ids(ModelFilter {
                search: "OPENROUTER".into(),
                ..ModelFilter::default()
            }),
            [
                "acceptance-alternate",
                "openai/gpt-x",
                "~meta-llama/llama-9",
                "x-ai/grok"
            ]
        );
        assert!(
            ids(ModelFilter {
                connection: some("other"),
                ..ModelFilter::default()
            })
            .is_empty()
        );
    }

    #[test]
    fn numbers_are_written_as_the_web_writes_them() {
        let counts = [
            0,
            999,
            1000,
            8192,
            128_000,
            200_000,
            999_949,
            999_950,
            1_000_000,
            1_048_576,
            1_500_000,
            2_000_000,
            1250,
            1350,
            1_234_567_890,
        ];
        let expected = [
            "0", "999", "1K", "8.2K", "128K", "200K", "999.9K", "1M", "1M", "1M", "1.5M", "2M",
            "1.3K", "1.4K", "1.2B",
        ];
        assert_eq!(counts.map(compact_tokens), expected);

        let prices = [
            10.0, 50.0, 0.15, 0.075, 0.0001, 3.0, 1.25, 0.0, 0.00005, 0.00004, 1234.5, 0.125,
            2.50001,
        ];
        let expected = [
            "$10.00",
            "$50.00",
            "$0.15",
            "$0.075",
            "$0.0001",
            "$3.00",
            "$1.25",
            "$0.00",
            "$0.0001",
            "$0.00",
            "$1,234.50",
            "$0.125",
            "$2.50",
        ];
        assert_eq!(prices.map(price), expected);
    }
}
