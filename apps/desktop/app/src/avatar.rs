//! A bot's face ("Glance"): a lumpy blob with two eyes looking one way, in
//! the bot's colour.
//!
//! The shape and the colour both derive from the bot id, so a bot looks the
//! same here as in the web workspace without anything being stored. That only
//! holds while this file computes exactly what the web does. In sync with:
//!
//! - `apps/web/src/domains/settings/application/bot-glance.ts` ([`glance`])
//! - `apps/web/src/domains/settings/application/bot-tone.ts` ([`Tones`])
//!
//! The tests at the bottom pin values printed by that TypeScript.

use raphie_core::contracts::BotProfile;
use rune::color::hex;
use rune::{Color, El, Path, Shape, canvas};

/// The geometry of one face in a 100×100 box.
#[derive(Debug, PartialEq)]
pub struct Glance {
    /// Where the outline starts.
    pub start: [f64; 2],
    /// The outline: five quadratic curves, each a control point and an end.
    pub curves: [([f64; 2], [f64; 2]); 5],
    /// The centres of the two eyes (radius [`EYE_RADIUS`]).
    pub eyes: [[f64; 2]; 2],
}

pub const EYE_RADIUS: f64 = 6.5;

/// The face for a bot id. The same id always gives the same face.
pub fn glance(id: &str) -> Glance {
    // A seed from the id's characters. `wrapping_*` is arithmetic modulo
    // 2^32, which is what JavaScript's `>>> 0` does to the same sum. The web
    // reads UTF-16 code units (`charCodeAt`), so this does too.
    let seed = id.encode_utf16().fold(17u32, |sum, unit| {
        sum.wrapping_mul(131).wrapping_add(u32::from(unit))
    });
    let mut random = Mulberry32(seed);

    // Five points around the centre, each a random distance out.
    let turn = random.next() * 0.6;
    let mut points = [[0.0; 2]; 5];
    for (i, point) in points.iter_mut().enumerate() {
        let angle = (i as f64 / 5.0) * std::f64::consts::TAU + turn;
        let reach = 42.0 * (0.85 + random.next() * 0.3);
        *point = [50.0 + angle.cos() * reach, 50.0 + angle.sin() * reach];
    }

    // A smooth closed outline: start halfway between the first two points,
    // then curve through each point to the midpoint of the next pair.
    let mid = |p: [f64; 2], q: [f64; 2]| [round((p[0] + q[0]) / 2.0), round((p[1] + q[1]) / 2.0)];
    let mut curves = [([0.0; 2], [0.0; 2]); 5];
    for (i, curve) in curves.iter_mut().enumerate() {
        let p = points[(i + 1) % 5];
        let q = points[(i + 2) % 5];
        *curve = ([round(p[0]), round(p[1])], mid(p, q));
    }

    // Both eyes shift the same way: that is the glance.
    let look = random.next() * std::f64::consts::TAU;
    let dx = round(look.cos() * 7.0);
    let dy = round(look.sin() * 5.0);
    Glance {
        start: mid(points[0], points[1]),
        curves,
        eyes: [[39.0 + dx, 46.0 + dy], [61.0 + dx, 46.0 + dy]],
    }
}

/// To one decimal place, like the web's `Math.round(n * 10) / 10` (which
/// rounds halves up, where Rust's `round` rounds them away from zero).
fn round(n: f64) -> f64 {
    (n * 10.0 + 0.5).floor() / 10.0
}

/// mulberry32, a small random number generator that uses only 32-bit integer
/// arithmetic, so JavaScript and Rust draw the same numbers from one seed.
struct Mulberry32(u32);

impl Mulberry32 {
    /// The next number in `0.0..1.0`.
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let seed = self.0;
        let mut t = (seed ^ (seed >> 15)).wrapping_mul(seed | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

/// The body colour and eye colour of one bot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tone {
    pub body: Color,
    pub eye: Color,
}

/// The web's eight avatar colours (`botPalette`): Sage, Lavender, Amber,
/// Teal, Rose, Sky, Sand, Clay.
const PALETTE: [&str; 8] = [
    "#b5c99b", "#b5b4dc", "#e3b477", "#83bcb4", "#dda6b5", "#91b7df", "#d2ca86", "#d5aa91",
];

/// Which colour each bot wears. One assignment for the whole roster, because
/// a bot's colour depends on the bots created before it (two bots avoid
/// sharing a colour while unused ones remain).
pub struct Tones {
    /// `(bot id, "#rrggbb")`, in roster order with `default` first.
    assigned: Vec<(String, String)>,
}

impl Tones {
    pub fn assign(bots: &[BotProfile]) -> Tones {
        let mut assigned: Vec<(String, String)> = Vec::new();
        // How many bots wear each palette colour so far.
        let mut usage = [0u32; 8];
        let ids = std::iter::once("default").chain(bots.iter().map(|bot| bot.id.as_str()));
        for id in ids {
            if assigned.iter().any(|(seen, _)| seen == id) {
                continue;
            }
            // A colour the owner chose in Settings wins.
            let chosen = bots
                .iter()
                .find(|bot| bot.id == id)
                .and_then(|bot| bot.color.as_deref())
                .map(str::to_lowercase);
            if let Some(chosen) = chosen {
                if let Some(index) = PALETTE.iter().position(|c| *c == chosen) {
                    usage[index] += 1;
                }
                assigned.push((id.to_owned(), chosen));
                continue;
            }
            // Otherwise start from the id's preferred colour and move to a
            // less used one if there is any.
            let preferred = preferred_tone(id);
            let mut tone = preferred;
            if id != "default" {
                for offset in 1..PALETTE.len() {
                    let candidate = (preferred + offset) % PALETTE.len();
                    if usage[candidate] < usage[tone] {
                        tone = candidate;
                    }
                }
            }
            usage[tone] += 1;
            assigned.push((id.to_owned(), PALETTE[tone].to_owned()));
        }
        Tones { assigned }
    }

    /// The colour of bot `id` as `#rrggbb`.
    fn hex_of(&self, id: &str) -> &str {
        self.assigned
            .iter()
            .find(|(seen, _)| seen == id)
            .map_or(PALETTE[preferred_tone(id)], |(_, color)| color.as_str())
    }

    pub fn of(&self, id: &str) -> Tone {
        // A stored colour that is not valid hex falls back to Sage.
        let body = hex(self.hex_of(id))
            .or_else(|| hex(PALETTE[0]))
            .unwrap_or(Color::WHITE);
        Tone {
            body,
            eye: eye_color(body),
        }
    }
}

/// The original four colour families, picked by the id's characters.
fn preferred_tone(id: &str) -> usize {
    if id == "default" {
        return 0;
    }
    let sum: u32 = id.encode_utf16().map(u32::from).sum();
    (sum % 4) as usize
}

/// Dark eyes, or white ones on a body too dark for them (`botEyeColor`: the
/// better of the two WCAG contrast ratios).
fn eye_color(body: Color) -> Color {
    let luminance = body.luminance();
    let white_contrast = 1.05 / (luminance + 0.05);
    let dark_contrast = (luminance + 0.05) / 0.079;
    if white_contrast > dark_contrast {
        Color::WHITE
    } else {
        hex("#273329").unwrap_or(Color::BLACK)
    }
}

/// The face of bot `id`, `size` points square.
pub fn bot_avatar(id: &str, tone: Tone, size: f32) -> El {
    let face = glance(id);
    // Rune draws in `f32`; the geometry above is `f64` to match JavaScript.
    let at = |p: [f64; 2]| [p[0] as f32, p[1] as f32];
    let mut body = Path::new().move_to(at(face.start));
    for (control, end) in face.curves {
        body = body.quad_to(at(control), at(end));
    }
    let mut shape = Shape::new()
        // The coordinates span 100×100 and stretch to the element's size.
        .view_box(100.0, 100.0)
        .fill_path(&body.close(), tone.body);
    for eye in face.eyes {
        shape = shape.fill_path(&circle(at(eye), EYE_RADIUS as f32), tone.eye);
    }
    canvas(shape).size(size, size).a11y_hidden()
}

/// A circle as four cubic curves, the usual approximation.
fn circle(center: [f32; 2], radius: f32) -> Path {
    // How far the control points sit from the ends for a quarter circle.
    let k = radius * 0.552_284_8;
    let [x, y] = center;
    Path::new()
        .move_to([x + radius, y])
        .cubic_to([x + radius, y + k], [x + k, y + radius], [x, y + radius])
        .cubic_to([x - k, y + radius], [x - radius, y + k], [x - radius, y])
        .cubic_to([x - radius, y - k], [x - k, y - radius], [x, y - radius])
        .cubic_to([x + k, y - radius], [x + radius, y - k], [x + radius, y])
        .close()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The face as the web's SVG path string, to compare with its output.
    fn svg_path(face: &Glance) -> String {
        let mut path = format!("M{} {}", face.start[0], face.start[1]);
        for (control, end) in face.curves {
            path += &format!("Q{} {} {} {}", control[0], control[1], end[0], end[1]);
        }
        path + "Z"
    }

    // Expected values printed by `glance()` in bot-glance.ts.
    #[test]
    fn faces_match_the_web_workspace() {
        let default = glance("default");
        assert_eq!(
            svg_path(&default),
            "M74.8 69.7Q59.2 86.7 38.8 78.3Q18.4 69.8 18.5 46.8Q18.6 23.7 43.2 14.7Q67.8 5.6 79.1 29.2Q90.4 52.7 74.8 69.7Z"
        );
        assert_eq!(default.eyes, [[44.6, 49.0], [66.6, 49.0]]);

        let research = glance("research");
        assert_eq!(
            svg_path(&research),
            "M75.6 71.1Q61.4 90.6 38.6 81.7Q15.8 72.8 15.3 47.6Q14.9 22.3 39.3 17.7Q63.7 13.1 76.8 32.3Q89.9 51.6 75.6 71.1Z"
        );
        assert_eq!(research.eyes, [[45.6, 44.4], [67.6, 44.4]]);

        let bot7 = glance("bot-7");
        assert_eq!(
            svg_path(&bot7),
            "M62.2 83.1Q39.7 95.5 25.7 74.5Q11.7 53.5 23.3 34.2Q34.9 14.9 57.6 19.1Q80.3 23.4 82.5 47Q84.8 70.7 62.2 83.1Z"
        );
        assert_eq!(bot7.eyes, [[32.4, 47.6], [54.4, 47.6]]);
    }

    fn bot(id: &str, color: Option<&str>) -> BotProfile {
        BotProfile {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            color: color.map(str::to_owned),
        }
    }

    // Expected values printed by `botColors()` and `botEyeColor()` in
    // bot-tone.ts for the same roster.
    #[test]
    fn colours_match_the_web_workspace() {
        let tones = Tones::assign(&[
            bot("default", None),
            bot("research", None),
            bot("ops", None),
            bot("writer", Some("#91B7DF")),
            bot("abcd", None),
            bot("custom", Some("#123456")),
        ]);
        let expected = [
            ("default", "#b5c99b"),
            ("research", "#b5b4dc"),
            ("ops", "#e3b477"),
            ("writer", "#91b7df"),
            ("abcd", "#83bcb4"),
            ("custom", "#123456"),
        ];
        for (id, color) in expected {
            assert_eq!(tones.hex_of(id), color, "{id}");
        }
        assert_eq!(tones.of("default").eye, hex("#273329").unwrap());
        assert_eq!(tones.of("custom").eye, Color::WHITE);
    }

    #[test]
    fn an_unknown_bot_still_has_a_colour() {
        let tones = Tones::assign(&[]);
        assert_eq!(tones.hex_of("default"), "#b5c99b");
        assert_eq!(
            tones.hex_of("research"),
            PALETTE[preferred_tone("research")]
        );
    }
}
