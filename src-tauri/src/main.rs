// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // review サブコマンドで起動されたときはウィンドウを開かずに終了する。
  if app_lib::run_cli_if_requested() {
    return;
  }
  app_lib::run();
}
