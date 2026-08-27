use sha2::{Digest, Sha256};
use std::fs;

use super::store;

// 版の本文を内容ハッシュで保存する。ファイル名がハッシュそのものなので、
// 同じ内容は 1 つに畳まれ、書き込みは何度行っても同じ結果になる。

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
        store::write_atomic(&path, text.as_bytes())?;
    }
    Ok(id)
}

pub fn get(id: &str) -> Result<String, String> {
    let id = validate_id(id)?;
    let path = store::snapshots_dir()?.join(id);
    fs::read_to_string(&path).map_err(|e| format!("版 {id} を読めません: {e}"))
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
    fn ids_outside_hex_are_rejected() {
        assert!(validate_id("../../etc/passwd").is_err());
        assert!(validate_id("").is_err());
        assert!(validate_id("abc/def").is_err());
        assert!(validate_id("deadBEEF00").is_ok());
    }
}
