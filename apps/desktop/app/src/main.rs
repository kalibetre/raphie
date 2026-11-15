//! `raphie-desktop`: opens the window. With Rune's headless flags it renders
//! instead, for example `raphie-desktop --snap out.png --scene approval
//! --theme dark` (see `docs/desktop.md`).

use rune::{Chrome, WindowOptions};

fn main() {
    // `scripts/bundle.sh` runs the program this way to draw its own icon.
    if raphie_desktop::app_icon::requested() {
        // A transparent window keeps the icon's corners clear in the PNG.
        // `..Default::default()` fills in every field not named here.
        let options = WindowOptions {
            transparent: true,
            ..Default::default()
        };
        rune::App::new(raphie_desktop::app_icon::spec())
            .window_options(options)
            .run();
        return;
    }
    // Starts the GPU on a thread while macOS sets the app up (Rune's README,
    // "Launching fast").
    rune::prewarm_gpu();
    // Our own title bar: content runs under the traffic lights, and only the
    // marked bands drag the window. The lights sit level with the "raphie"
    // brand, which starts to their right.
    let chrome = Chrome {
        full_size_content: true,
        // Close to the corner, as a compact macOS title bar has them: the
        // lights are 14 pt tall, so their centre is 22 pt down.
        traffic_lights: Some((13.0, 15.0)),
        drag_regions: true,
    };
    let app = rune::App::new(raphie_desktop::spec())
        .chrome(chrome)
        .standard_menus();
    // A click on a system notification reaches the window through this.
    raphie_desktop::notify::connect(app.handle());
    app.run();
}
