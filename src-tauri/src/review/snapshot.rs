use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};

use super::store;

// 版の本文を内容ハッシュで保存する。ファイル名がハッシュそのものなので、
// 同じ内容は 1 つに畳まれ、書き込みは何度行っても同じ結果になる。
//
// 中身は圧縮して置く。控えは Markdown なので素のままだと嵩む（実測で 1/3.5）。
// ID は圧縮する前の中身のハッシュなので、圧縮しても版の呼び名は変わらない。
// 読むときは gzip の印で見分け、印が無ければ素の字として読む（圧縮する前に
// 置いた控えもそのまま読める）。

// gzip の先頭 2 バイト。
const GZIP: [u8; 2] = [0x1f, 0x8b];

pub fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

// 本文を保存し、その版 ID（内容ハッシュ）を返す。
pub fn put(text: &str) -> Result<String, String> {
    let id = content_hash(text);
    let dir = store::snapshots_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let path = dir.join(&id);
    if !path.exists() {
        store::write_atomic(&path, &squeeze(text)?)?;
    }
    Ok(id)
}

pub fn get(id: &str) -> Result<String, String> {
    let id = validate_id(id)?;
    let path = store::snapshots_dir()?.join(id);
    let bytes = fs::read(&path).map_err(|e| format!("版 {id} を読めません: {e}"))?;
    unsqueeze(&bytes).map_err(|e| format!("版 {id} を読めません: {e}"))
}

// 圧縮して置くときのバイト列。
pub fn squeeze(text: &str) -> Result<Vec<u8>, String> {
    let mut out = GzEncoder::new(Vec::new(), Compression::default());
    out.write_all(text.as_bytes())
        .map_err(|e| format!("控えを圧縮できません: {e}"))?;
    out.finish().map_err(|e| format!("控えを圧縮できません: {e}"))
}

// 圧縮して置いてあるか。
pub fn is_squeezed(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[..2] == GZIP
}

// 置いてあるバイト列から中身を取り出す。圧縮の印が無ければ素の字として読む。
pub fn unsqueeze(bytes: &[u8]) -> Result<String, String> {
    if !is_squeezed(bytes) {
        return String::from_utf8(bytes.to_vec()).map_err(|e| format!("字にできません: {e}"));
    }
    let mut text = String::new();
    GzDecoder::new(bytes)
        .read_to_string(&mut text)
        .map_err(|e| format!("控えを解けません: {e}"))?;
    Ok(text)
}

pub fn exists(id: &str) -> bool {
    validate_id(id)
        .ok()
        .and_then(|id| store::snapshots_dir().ok().map(|d| d.join(id).exists()))
        .unwrap_or(false)
}

// ID はそのままファイル名になるため、16 進以外を弾いてパスの外へ出られないようにする。
fn validate_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("版 ID の形式が不正です: {id}"));
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_and_content_dependent() {
        let a = content_hash("同じ内容");
        assert_eq!(a, content_hash("同じ内容"));
        assert_ne!(a, content_hash("違う内容"));
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_covers_multibyte_text() {
        // 絵文字を含んでもバイト列として扱えること
        let h = content_hash("ヒント 💡 あり");
        assert_eq!(h.len(), 64);
        assert_ne!(h, content_hash("ヒント あり"));
    }

    #[test]
    fn squeezed_text_comes_back_the_same() {
        let text = "# 題\n\n本文に 💡 と `コード` がある。\n";
        let bytes = squeeze(text).expect("圧縮できません");
        assert_eq!(&bytes[..2], &GZIP, "gzip の印で始まる");
        assert!(bytes.len() < text.len() * 2);
        assert_eq!(unsqueeze(&bytes).expect("解けません"), text);
    }

    #[test]
    fn plain_text_is_still_readable() {
        // 圧縮する前に置いた控え
        let text = "素のまま置いた控え\n";
        assert_eq!(unsqueeze(text.as_bytes()).expect("読めません"), text);
    }

    #[test]
    fn the_id_is_the_hash_of_the_text_itself() {
        // 圧縮しても版の呼び名は変わらない（ID は中身のハッシュ）
        let text = "版の中身";
        assert_eq!(content_hash(text), content_hash(&unsqueeze(&squeeze(text).unwrap()).unwrap()));
    }

    #[test]
    fn ids_outside_hex_are_rejected() {
        assert!(validate_id("../../etc/passwd").is_err());
        assert!(validate_id("").is_err());
        assert!(validate_id("abc/def").is_err());
        assert!(validate_id("deadBEEF00").is_ok());
    }
}
