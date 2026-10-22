use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// D2 の図を描く（ベータ）。
//
// 描くのは Mac に入っている d2 コマンド。アプリに同梱しない（WASM 版は数十 MB ある）。
// 見つからなければ Err を返し、画面はコードのまま出す。

// レイアウトが終わらない記述で固まらないよう、この時間で打ち切る。
const LIMIT: Duration = Duration::from_secs(10);
// 明るいテーマと暗いテーマ（`d2 themes` の番号）。
const LIGHT: &str = "0";
const DARK: &str = "200";
// 図の周りの余白と、注釈（tooltip）の出し方。注釈はマウスを載せたときだけでなく、
// 図の下に番号付きの付録として出す（画像として貼った先や印刷でも読めるように）。
const LOOKS: [&str; 3] = ["--pad", "16", "--force-appendix"];

fn d2_bin() -> Option<PathBuf> {
    // 見つかったものだけ覚える。見つからないときは毎回探し直す（アプリを
    // 開いたまま d2 を入れたときに、入れ直しを待たずに使えるように）。
    static FOUND: Mutex<Option<PathBuf>> = Mutex::new(None);
    let mut found = FOUND.lock().ok()?;
    if let Some(hit) = found.as_ref().filter(|p| p.is_file()) {
        return Some(hit.clone());
    }
    *found = find_d2();
    found.clone()
}

fn find_d2() -> Option<PathBuf> {
    // Dock から起動したアプリには、ターミナルの PATH が渡らない。決まった場所を先に見る。
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/d2"),
        PathBuf::from("/usr/local/bin/d2"),
    ];
    if let Some(h) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(h.join("go/bin/d2"));
        candidates.push(h.join(".local/bin/d2"));
    }
    if let Some(hit) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(hit);
    }
    let out = Command::new("/bin/zsh")
        .args(["-lc", "command -v d2"])
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

// 組み方の引数。図の中で `vars: { d2-config: { layout-engine: … } }` を決めていれば
// それに任せ（コマンドの --layout は図の中の指定より優先されるので付けない）、
// 決めていなければ ELK で組む。d2 の既定の dagre は線を曲線で引き、箱をまたいで
// 交差させる。読み込んだ別のファイル（`...@部品.d2`）の中の指定は見ない。
fn layout_args(code: &str) -> &'static [&'static str] {
    if code.contains("layout-engine") {
        &[]
    } else {
        &["--layout", "elk"]
    }
}

pub fn render(code: &str, dark: bool) -> Result<String, String> {
    let theme = ["--theme", if dark { DARK } else { LIGHT }];
    let out = run(
        &[&theme[..], &LOOKS, layout_args(code), &["-", "-"]].concat(),
        Some(code),
        None,
    )?;
    let svg = String::from_utf8_lossy(&out);
    // 先頭の XML 宣言は HTML の中に置けないので外す。
    let start = svg.find("<svg").ok_or("d2 が図を返しませんでした")?;
    Ok(svg[start..].to_string())
}

// .d2 のファイルを、同じフォルダの同じ名前の .svg に書き出す。あれば上書きする。
// ほかの資料に貼る前提なので、明るいテーマで描く。ファイルの道筋を渡すので、
// 同じフォルダの読み込み（`...@部品.d2`）も効く。
pub fn export(path: &Path) -> Result<PathBuf, String> {
    let dest = path.with_extension("svg");
    let src = path.to_string_lossy();
    let to = dest.to_string_lossy();
    // 読めなければ、指定が無いものとして組む（描く側の d2 がエラーを返す）。
    let code = std::fs::read_to_string(path).unwrap_or_default();
    run(
        &[&["--theme", LIGHT][..], &LOOKS, layout_args(&code), &[&src, &to]].concat(),
        None,
        path.parent(),
    )?;
    Ok(dest)
}

// d2 を起こして、終わるのを待つ。input があれば標準入力へ渡し、標準出力を返す。
fn run(args: &[&str], input: Option<&str>, cwd: Option<&Path>) -> Result<Vec<u8>, String> {
    let bin = d2_bin().ok_or("d2 コマンドが見つかりません")?;
    let mut cmd = Command::new(bin);
    cmd.args(args)
        // 端末向けの色付けを止める。付いたままだとエラーの文に制御文字が混ざる。
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().map_err(|e| format!("d2 を起動できません: {e}"))?;
    if let Some(code) = input {
        child
            .stdin
            .take()
            .ok_or("d2 に記述を渡せません")?
            .write_all(code.as_bytes())
            .map_err(|e| format!("d2 に記述を渡せません: {e}"))?;
    }
    // 出力は待っている間に読む。読まずに待つと、出力が詰まって終わらない。
    let mut stdout = child.stdout.take().ok_or("d2 の出力を読めません")?;
    let mut stderr = child.stderr.take().ok_or("d2 の出力を読めません")?;
    let out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("d2 が 10 秒で終わりませんでした".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let out = out.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    if !status.success() {
        let text = tidy_error(&String::from_utf8_lossy(&err));
        return Err(if text.is_empty() { "d2 が失敗しました".into() } else { text });
    }
    Ok(out)
}

// d2 のエラーの文を読める形にする。色付けの制御文字（ESC [ … 英字）を外し、
// 先頭の「err: 」と、標準入力から読んだ印「failed to compile -: -:」を落とす。
fn tidy_error(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out.lines()
        .map(|line| {
            let line = line.trim();
            let line = line.strip_prefix("err:").map_or(line, str::trim_start);
            line.strip_prefix("failed to compile -: -:").map_or(line, str::trim_start)
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn render_d2(code: String, dark: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render(&code, dark))
        .await
        .map_err(|e| e.to_string())?
}

// d2 が入っているか。設定の「D2 の図を描く」は、入っていなければ入にできない。
#[tauri::command]
pub async fn d2_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| d2_bin().is_some())
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn export_d2(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map(|dest| dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_a_small_diagram() {
        if d2_bin().is_none() {
            return;
        }
        let svg = render("a -> b", false).unwrap();
        assert!(svg.starts_with("<svg"));
        // 図の中で組み方を指定したものも描ける。
        let named = render("vars: {d2-config: {layout-engine: elk}}\na -> b", false).unwrap();
        assert!(named.starts_with("<svg"));
    }

    #[test]
    fn returns_the_error_text() {
        if d2_bin().is_none() {
            return;
        }
        let err = render("a -> ", true).unwrap_err();
        assert_eq!(err, "1:1: connection missing destination");
    }

    #[test]
    fn exports_next_to_the_file() {
        if d2_bin().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("fude-d2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.d2");
        std::fs::write(&src, "a -> b").unwrap();
        let dest = export(&src).unwrap();
        assert_eq!(dest, dir.join("a.svg"));
        let first = std::fs::read_to_string(&dest).unwrap();
        // 2 度目は上書きする。
        std::fs::write(&src, "a -> b\nb -> c").unwrap();
        export(&src).unwrap();
        let second = std::fs::read_to_string(&dest).unwrap();
        assert_ne!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn puts_tooltips_below_the_diagram() {
        if d2_bin().is_none() {
            return;
        }
        // 付録が無いと注釈の字は 2 回（title と tooltip の中）、付録が付くと 3 回出る。
        let code = r#"a: A {tooltip: "zzNOTEzz"}"#;
        for dark in [false, true] {
            let svg = render(code, dark).unwrap();
            assert_eq!(svg.matches("zzNOTEzz").count(), 3);
            assert!(svg.contains(r#"class="appendix""#));
        }
        let dir = std::env::temp_dir().join(format!("fude-d2-note-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.d2");
        std::fs::write(&src, code).unwrap();
        let dest = export(&src).unwrap();
        let svg = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(svg.matches("zzNOTEzz").count(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lays_out_with_elk_unless_the_diagram_says() {
        assert_eq!(layout_args("a -> b"), ["--layout", "elk"]);
        assert!(layout_args("vars: {d2-config: {layout-engine: dagre}}\na -> b").is_empty());
        assert!(layout_args("vars: {\n  d2-config: {\n    layout-engine: tala\n  }\n}").is_empty());
    }

    #[test]
    fn tidies_colored_errors() {
        let raw = "\u{1b}[31merr\u{1b}[0m: failed to compile -: -:1:1: connection missing destination\n";
        assert_eq!(tidy_error(raw), "1:1: connection missing destination");
    }
}
