use std::path::Path;

use eclipse::integration::asset_protocol::{allowed, is_page, mime, page_url, resolve, served_url, CARDS_PAGE, COVER_PAGE, TOGGLE_PAGE};
use eclipse::paths::project_root;

use crate::bundle::{bundled_files, same_file};

fn join(base: &str, reference: &str) -> String {
    let mut parts: Vec<&str> = base.split('/').collect();
    for segment in reference.split('/') {
        match segment {
            ".." => {
                parts.pop();
            }
            "." => {}
            segment => parts.push(segment),
        }
    }
    parts.join("/")
}

fn folder(path: &str) -> &str {
    path.rsplit_once('/').unwrap().0
}

fn served_files() -> Vec<String> {
    let root = project_root();
    let mut served = Vec::new();
    for page in [CARDS_PAGE, TOGGLE_PAGE, COVER_PAGE] {
        let (file, kind) = resolve(&root, &page_url(page)).unwrap();
        assert!(file.is_file(), "{page}");
        assert_eq!(kind, "text/html; charset=utf-8");
        served.push(page.to_string());
        let html = std::fs::read_to_string(&file).unwrap();
        for reference in html.split('"').filter(|part| [".css", ".js", ".png", ".svg"].iter().any(|kind| part.ends_with(kind))) {
            let path = join(folder(page), reference);
            let (file, _) = resolve(&root, &served_url(&path)).unwrap_or_else(|| panic!("{page} loads {path}"));
            assert!(file.is_file(), "{path}");
            if path.contains("@fontsource") {
                let css = std::fs::read_to_string(&file).unwrap();
                for font in css.split("url(").skip(1).map(|rest| rest.split(')').next().unwrap()) {
                    let font_path = join(folder(&path), font);
                    let (font_file, kind) = resolve(&root, &served_url(&font_path)).unwrap_or_else(|| panic!("{path} loads {font_path}"));
                    assert!(font_file.is_file(), "{font_path}");
                    assert!(kind.starts_with("font/"));
                    served.push(font_path);
                }
            }
            served.push(path);
        }
    }
    for module in ["src/renderer/cards.js", "src/renderer/ranks.js", "src/renderer/cardsText.js", "src/integration/overlay/toggle-check.svg"] {
        assert!(resolve(&root, &page_url(module)).is_some_and(|(file, _)| file.is_file()), "{module}");
        served.push(module.to_string());
    }
    served
}

#[test]
fn the_three_overlay_pages_and_everything_they_load_are_served() {
    assert!(served_files().len() > 20);
}

#[test]
fn the_setup_carries_every_served_file_at_its_own_path_and_nothing_the_protocol_would_refuse() {
    let root = project_root();
    let bundled = bundled_files();
    for path in served_files() {
        let found = bundled.iter().find(|file| file.target == path).unwrap_or_else(|| panic!("{path} is not in the Setup"));
        assert!(same_file(&found.source, &root.join(&path)), "{path}");
    }
    for file in bundled.iter().filter(|file| !file.target.ends_with(".ps1")) {
        assert_eq!(allowed(&file.target), Some(file.target.as_str()), "{}", file.target);
        assert!(same_file(&file.source, &root.join(&file.target)), "{}", file.target);
    }
}

#[test]
fn anything_outside_the_closed_list_is_refused_including_escapes_and_other_files_of_the_project() {
    for path in [
        "",
        "/",
        "src/renderer",
        "src/renderer/../main/index.js",
        "src/renderer/%2e%2e/main/index.js",
        "src/renderer/..%2fmain",
        "src/renderer\\..\\main\\index.js",
        "src//renderer/cards.html",
        "src/renderer/.hidden.js",
        "src/renderer/cards.html.map",
        "src/renderer/assets/icon.ico",
        "src/renderer/assets/deep/x.png",
        "src/main/index.js",
        "src/integration/manager/manager-preload.js",
        "src/integration/overlay/toggle-preload.js",
        "src/integration/overlay/riotOverlay.js",
        "src/platform/windows/login.ps1",
        "package.json",
        "node_modules/@fontsource/inter/800.css",
        "node_modules/@fontsource/inter/files/inter-latin-800-normal.woff2",
        "node_modules/@fontsource/inter/files/inter-latin-700-italic.woff2",
        "node_modules/@fontsource/inter/files/inter--400-normal.woff2",
        "node_modules/@fontsource/inter/files/inter-latin-400-normal.ttf",
        "node_modules/@fontsource/roboto/400.css",
        "node_modules/electron/index.js",
        "docs/00 Início.md",
        "C:/Windows/win.ini",
    ] {
        assert!(allowed(path).is_none(), "{path}");
        assert!(resolve(Path::new("C:/root"), &format!("eclipse://localhost/{path}")).is_none(), "{path}");
    }
    for uri in ["https://eclipse.localhost/src/renderer/cards.html", "eclipse://evil/src/renderer/cards.html", "http://other.localhost/src/renderer/cards.html"] {
        assert!(resolve(Path::new("C:/root"), uri).is_none(), "{uri}");
    }
    assert_eq!(resolve(Path::new("C:/root"), "eclipse://localhost/src/renderer/cards.html?x=1#y").unwrap().0, Path::new("C:/root").join("src\\renderer\\cards.html"));
    assert_eq!(mime("a.exe"), None);
}

#[test]
fn a_page_is_recognized_only_at_its_own_address() {
    assert_eq!(page_url(CARDS_PAGE), "eclipse://localhost/src/renderer/cards.html");
    assert_eq!(served_url(CARDS_PAGE), "http://eclipse.localhost/src/renderer/cards.html");
    assert!(is_page(CARDS_PAGE, "http://eclipse.localhost/src/renderer/cards.html"));
    assert!(is_page(CARDS_PAGE, "eclipse://localhost/src/renderer/cards.html"));
    for url in ["http://eclipse.localhost/src/renderer/cards.html?x", "http://eclipse.localhost/src/integration/overlay/toggle.html", "https://example.invalid/", "about:blank"] {
        assert!(!is_page(CARDS_PAGE, url), "{url}");
    }
}
