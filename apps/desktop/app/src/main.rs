//! `raphie-desktop`: opens the window. With Rune's headless flags it renders
//! instead, for example `raphie-desktop --snap out.png --scene approval
//! --theme dark` (see `docs/desktop.md`).

use rune::Chrome;

fn main() {
    // Starts the GPU on a thread while macOS sets the app up (Rune's README,
    // "Launching fast").
    rune::prewarm_gpu();
    // Our own title bar: content runs under the traffic lights, and only the
    // marked bands drag the window.
    let chrome = Chrome {
        full_size_content: true,
        traffic_lights: Some((16.0, 25.0)),
        drag_regions: true,
    };
    rune::App::new(raphie_desktop::spec())
        .chrome(chrome)
        .standard_menus()
        .run();
}
