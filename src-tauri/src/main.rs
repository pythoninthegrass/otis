// No Windows target ships today, but the attribute is free to carry forward: it silences the
// console window Windows would otherwise open behind a release-mode GUI app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    otis_tauri_lib::run()
}
