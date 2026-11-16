use std::path::{Path, PathBuf};

use eclipse::paths::project_root;
use serde_json::Value;

pub struct Bundled {
    pub source: PathBuf,
    pub target: String,
}

pub fn bundled_files() -> Vec<Bundled> {
    let tauri = project_root().join("src-tauri");
    let config: Value = serde_json::from_str(&std::fs::read_to_string(tauri.join("tauri.conf.json")).unwrap()).unwrap();
    let mut files = Vec::new();
    for (pattern, target) in config["bundle"]["resources"].as_object().unwrap() {
        let target = target.as_str().unwrap();
        if pattern.contains('*') {
            let found: Vec<PathBuf> = glob::glob(&tauri.join(pattern).to_string_lossy()).unwrap().map(Result::unwrap).collect();
            assert!(!found.is_empty(), "{pattern}");
            for source in found {
                let name = source.file_name().unwrap().to_string_lossy().to_string();
                files.push(Bundled { source, target: format!("{target}{name}") });
            }
        } else {
            files.push(Bundled { source: tauri.join(pattern), target: target.to_string() });
        }
    }
    files
}

pub fn same_file(a: &Path, b: &Path) -> bool {
    a.canonicalize().unwrap() == b.canonicalize().unwrap()
}
