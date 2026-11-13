fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["manager", "overlay_toggle"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri-build failed");
}
