use serde::Serialize;
use similar::{DiffOp, TextDiff};
use std::collections::HashMap;

// 指摘の位置を、今の本文の中から見つけ直す。
//
// Markdown は解析しない。指摘を作るのは GUI だけで、ブロックの境界も見出しの
// 道筋も作成時に確定して台帳へ入っている。ここがするのは「記録された文字列は
// 今どこにあるか」に答えることだけ。解析器を 2 つ持つと、粒度がずれた瞬間に
// GUI の控えと CLI の答えが食い違って位置が飛ぶ。
//
// 段は費用の順に並べる。安い段で決まれば高い段は走らせない。
//
//   L0 控えの範囲がそのまま当たる    切り出して比べるだけ
//   L1 引用が見つかる                文字列探索
//   L2 基準版からの行差分で移す      行差分（書き換えられたものだけ）
//   L3 位置ヒント付きの近似一致      局所探索（L2 まで外れたものだけ）
//
// 範囲はファイル内のバイト位置で持つ。これが位置の正準表現で、GUI 側の
// ブロックが持つオフセットと同じ量になる。

// 引用をどれだけ含んでいれば「そこに在る」と見なすか。読む側の判断
// （src/lib/blockDiff.ts の ENOUGH）と同じ値を使い、閾値を 2 か所に分けない。
pub const ENOUGH: f32 = 0.62;
// 候補が並んだときに、次点とこれだけ離れていなければ選ばない。
const MARGIN: f32 = 0.12;
// bitap の型に使える長さ。64 ビットの語に収める。
const MAX_PATTERN: usize = 64;
// 近似一致で見に行く範囲（手掛かりの前後、文字数）。
const WINDOW: usize = 2000;
// 探索の打ち切り。同じ文字列が並ぶ表などで際限なく拾わない。
const MAX_HITS: usize = 256;
// bitap の得点。diff-match-patch の既定と同じ。
const MATCH_THRESHOLD: f64 = 0.5;
const MATCH_DISTANCE: f64 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Cache,   // L0 控えの範囲がそのまま当たった
    Exact,   // L1 引用がそのまま見つかった
    Context, // L1 候補が複数あり、前後の文脈で 1 つに絞った
    Ported,  // L2 基準版からの行差分で移した
    Fuzzy,   // L3 近くを近似で探した
}

impl Method {
    pub fn tag(self) -> &'static str {
        match self {
            Method::Cache => "cache",
            Method::Exact => "exact",
            Method::Context => "context",
            Method::Ported => "ported",
            Method::Fuzzy => "fuzzy",
        }
    }

    pub fn from_tag(tag: &str) -> Option<Method> {
        match tag {
            "cache" => Some(Method::Cache),
            "exact" => Some(Method::Exact),
            "context" => Some(Method::Context),
            "ported" => Some(Method::Ported),
            "fuzzy" => Some(Method::Fuzzy),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Located {
    // ファイル内のバイト範囲（終端は含まない）。
    pub start: usize,
    pub end: usize,
    // 1 始まりの行番号。両端を含む。
    pub line_start: usize,
    pub line_end: usize,
    pub method: Method,
    // 近似で決めたときの一致の度合い。確定した段では持たない。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    // 同じ文字列が本文に何か所あったか。2 以上なら 1 つに決めていない。
    pub candidates: usize,
}

impl Located {
    // 出力に添える確信度。読み手が推測と確定を取り違えないための札。
    pub fn label(&self) -> String {
        if self.undecided() {
            return format!("候補{}", self.candidates);
        }
        match self.score {
            Some(score) => format!("推定 {score:.2}"),
            None => "確実".to_string(),
        }
    }

    // 同じ字が複数あって、1 つに絞れていない。
    pub fn undecided(&self) -> bool {
        self.candidates > 1 && self.method == Method::Exact
    }

    pub fn lines(&self) -> String {
        if self.line_start == self.line_end {
            format!("L{}", self.line_start)
        } else {
            format!("L{}-{}", self.line_start, self.line_end)
        }
    }
}

// 指摘が持っている手掛かり。台帳の型をそのまま持ち込まず、素の文字列で受ける。
// 位置の算段だけを試したいときに、台帳もファイルも用意せずに試験できる。
#[derive(Debug, Default)]
pub struct Clues<'a> {
    // 指摘した時点のブロック本文。
    pub quote: &'a str,
    // 前に解いたときの、その時点のブロック本文。無ければ空。
    pub head_quote: &'a str,
    // 引用の直前・直後の字。同じ文が複数あるときに 1 つへ絞るために使う。
    pub prefix: &'a str,
    pub suffix: &'a str,
    // 基準版の本文の中での、引用のバイト位置。
    pub base_offset: Option<usize>,
    // 前に解いたときのバイト範囲。
    pub cached: Option<(usize, usize)>,
    // 基準版の本文。
    pub base: Option<&'a str>,
    // 基準版から今の本文への行の対応。ファイルごとに 1 回だけ組んで使い回す。
    pub map: Option<&'a LineMap>,
}

// 安い段（L0・L1）だけを試す。ここで決まれば、基準版を展開して行差分を組む
// 費用を払わずに済む。実台帳 149 件では、2 度目以降はほとんどがここで止まる。
pub fn cheap(text: &str, clues: &Clues) -> Option<Located> {
    let needle = if clues.head_quote.is_empty() {
        clues.quote
    } else {
        clues.head_quote
    };
    if needle.is_empty() || text.is_empty() {
        return None;
    }

    // L0 控えの範囲を切り出して、控えの本文と同じならそのまま。
    if let Some((start, end)) = clues.cached {
        if slice(text, start, end) == Some(needle) {
            return Some(made(text, start, end, Method::Cache, None, 1));
        }
    }

    // L1 引用をそのまま探す。
    let hits = find_all(text, needle);
    if hits.len() == 1 {
        let at = hits[0];
        return Some(made(text, at, at + needle.len(), Method::Exact, None, 1));
    }
    if hits.len() > 1 {
        if let Some(at) = narrow(text, &hits, needle.len(), clues.prefix, clues.suffix) {
            return Some(made(
                text,
                at,
                at + needle.len(),
                Method::Context,
                None,
                hits.len(),
            ));
        }
        // 決め打たない。先頭を出したうえで候補の数を添える。
        let at = hits[0];
        return Some(made(
            text,
            at,
            at + needle.len(),
            Method::Exact,
            None,
            hits.len(),
        ));
    }

    None
}

pub fn locate(text: &str, clues: &Clues) -> Option<Located> {
    if let Some(found) = cheap(text, clues) {
        return Some(found);
    }
    if clues.quote.is_empty() || text.is_empty() {
        return None;
    }

    // L2 基準版からの行差分で移す。
    //
    // ここで「移した先が引用にどれだけ似ているか」は問わない。指摘に応えて
    // 書き換えられた段落は元と似ていないのが当たり前で、そこを閾値で弾くと
    // この段がいちばん効くべき場面で位置を失う。覆っていた行がすべて消えて
    // いたときだけ、指さずに次の段へ渡す。
    let ported = ported_range(text, clues);
    if let Some((start, end)) = ported {
        if end > start {
            return Some(made(text, start, end, Method::Ported, None, 1));
        }
    }

    // L3 いちばん近い手掛かりの周りを近似で探す。
    let hint = ported
        .map(|(start, _)| start)
        .or(clues.cached.map(|(start, _)| start))
        .or(clues.base_offset)?;
    near_match(text, clues.quote, hint.min(text.len()))
}

fn made(
    text: &str,
    start: usize,
    end: usize,
    method: Method,
    score: Option<f32>,
    candidates: usize,
) -> Located {
    let (line_start, line_end) = lines_of(text, start, end);
    Located {
        start,
        end,
        line_start,
        line_end,
        method,
        score,
        candidates,
    }
}

// ---- 行と範囲 ----

// バイト範囲を 1 始まりの行範囲にする。末尾が改行で終わっているときは、
// その改行は手前の行のものとして数える（範囲の次の行を巻き込まない）。
pub fn lines_of(text: &str, start: usize, end: usize) -> (usize, usize) {
    let bytes = text.as_bytes();
    let start = start.min(bytes.len());
    let end = end.clamp(start, bytes.len());
    let before = bytes[..start].iter().filter(|&&c| c == b'\n').count();
    let mut inside = bytes[start..end].iter().filter(|&&c| c == b'\n').count();
    if inside > 0 && bytes[end - 1] == b'\n' {
        inside -= 1;
    }
    (before + 1, before + 1 + inside)
}

// 各行の先頭のバイト位置。末尾に本文の長さを足しておき、行範囲をそのまま
// バイト範囲に読み替えられるようにする。
fn line_starts(text: &str) -> Vec<usize> {
    let mut out = vec![0usize];
    for (at, byte) in text.as_bytes().iter().enumerate() {
        if *byte == b'\n' {
            out.push(at + 1);
        }
    }
    // 本文が改行で終わっていなければ、最後の行の終端を足しておく。
    if *out.last().unwrap() < text.len() {
        out.push(text.len());
    }
    out
}

// 0 始まりの半開の行範囲を、バイト範囲にする。
fn byte_span(text: &str, from: usize, to: usize) -> (usize, usize) {
    let starts = line_starts(text);
    let start = *starts.get(from).unwrap_or(&text.len());
    let end = *starts.get(to).unwrap_or(&text.len());
    (start, end.max(start))
}

// バイト範囲を 0 始まりの半開の行範囲にする。
fn line_span(text: &str, start: usize, end: usize) -> (usize, usize) {
    let (a, b) = lines_of(text, start, end);
    (a - 1, b)
}

fn slice(text: &str, start: usize, end: usize) -> Option<&str> {
    if end > text.len() || start > end {
        return None;
    }
    if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return None;
    }
    Some(&text[start..end])
}

// ---- L1 ----

// 出現位置をすべて返す。重なりも拾う（同じ字が続く表で取りこぼさない）。
pub fn find_all(text: &str, needle: &str) -> Vec<usize> {
    let mut out = Vec::new();
    if needle.is_empty() {
        return out;
    }
    let mut at = 0usize;
    while at <= text.len() {
        let Some(found) = text[at..].find(needle) else {
            break;
        };
        out.push(at + found);
        if out.len() >= MAX_HITS {
            break;
        }
        at += found + 1;
        while at < text.len() && !text.is_char_boundary(at) {
            at += 1;
        }
    }
    out
}

// 候補が複数あるとき、前後の文脈でいちばん合うものを選ぶ。
//
// 文脈も書き換わっていることがあるので、完全一致は求めない。前は末尾から、
// 後ろは先頭から、どこまで一致したかを数え、次点と差が付いたときだけ採る。
// 僅差で選ぶと、似た段落が並ぶ文書で確信をもって別の箇所を指してしまう。
fn narrow(
    text: &str,
    hits: &[usize],
    len: usize,
    prefix: &str,
    suffix: &str,
) -> Option<usize> {
    if prefix.is_empty() && suffix.is_empty() {
        return None;
    }
    let bytes = text.as_bytes();
    let total = (prefix.len() + suffix.len()) as f32;
    let mut ranked: Vec<(f32, usize)> = hits
        .iter()
        .map(|&at| {
            let back = common_tail(&bytes[..at], prefix.as_bytes());
            let fore = common_head(&bytes[(at + len).min(bytes.len())..], suffix.as_bytes());
            ((back + fore) as f32 / total, at)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    let best = ranked[0];
    let second = ranked.get(1).map(|x| x.0).unwrap_or(0.0);
    if best.0 > 0.0 && best.0 - second >= MARGIN {
        Some(best.1)
    } else {
        None
    }
}

fn common_tail(text: &[u8], want: &[u8]) -> usize {
    let mut n = 0;
    while n < text.len() && n < want.len() && text[text.len() - 1 - n] == want[want.len() - 1 - n] {
        n += 1;
    }
    n
}

fn common_head(text: &[u8], want: &[u8]) -> usize {
    let mut n = 0;
    while n < text.len() && n < want.len() && text[n] == want[n] {
        n += 1;
    }
    n
}

// ---- L2 ----

// 基準版の行が、今の本文のどの行に当たるか。
//
// 行差分だけで組む。Gerrit のコメント移送が対象言語の構文を解析せず、
// テキスト差分だけで動くのと同じ構図。
#[derive(Debug)]
pub struct LineMap {
    // 基準版の行 i → 今の本文の行 [lo, hi)。消えた行は lo == hi。
    spans: Vec<(usize, usize)>,
}

impl LineMap {
    pub fn build(base: &str, head: &str) -> LineMap {
        let diff = TextDiff::from_lines(base, head);
        let mut spans: Vec<(usize, usize)> = Vec::new();
        let mut put = |old: usize, span: (usize, usize)| {
            if spans.len() <= old {
                spans.resize(old + 1, (0, 0));
            }
            spans[old] = span;
        };
        for op in diff.ops() {
            match *op {
                DiffOp::Equal {
                    old_index,
                    new_index,
                    len,
                } => {
                    for k in 0..len {
                        put(old_index + k, (new_index + k, new_index + k + 1));
                    }
                }
                DiffOp::Delete {
                    old_index,
                    old_len,
                    new_index,
                } => {
                    for k in 0..old_len {
                        put(old_index + k, (new_index, new_index));
                    }
                }
                DiffOp::Insert { .. } => {}
                DiffOp::Replace {
                    old_index,
                    old_len,
                    new_index,
                    new_len,
                } => {
                    // 書き換わった区間は、長さの比で割り当てる。区間全体としては
                    // 元の範囲が新しい範囲を覆う。
                    for k in 0..old_len {
                        let lo = new_index + k * new_len / old_len;
                        let hi = new_index + ((k + 1) * new_len).div_ceil(old_len);
                        put(old_index + k, (lo, hi.max(lo)));
                    }
                }
            }
        }
        LineMap { spans }
    }

    // 0 始まりの半開の行範囲を移す。覆っていた行がすべて消えていたときは、
    // 消えた場所を空の範囲で返す。近くを探すための手掛かりになる。
    pub fn port(&self, from: usize, to: usize) -> Option<(usize, usize)> {
        let to = to.min(self.spans.len());
        if from >= to {
            return None;
        }
        let mut lo = usize::MAX;
        let mut hi = 0usize;
        for i in from..to {
            let (a, b) = self.spans[i];
            if b > a {
                lo = lo.min(a);
                hi = hi.max(b);
            }
        }
        if lo == usize::MAX {
            let at = self.spans[from].0;
            return Some((at, at));
        }
        Some((lo, hi))
    }
}

fn ported_range(text: &str, clues: &Clues) -> Option<(usize, usize)> {
    let base = clues.base?;
    let map = clues.map?;
    let at = clues
        .base_offset
        .filter(|&at| slice(base, at, at + clues.quote.len()) == Some(clues.quote))
        .or_else(|| base.find(clues.quote))?;
    let (from, to) = line_span(base, at, at + clues.quote.len());
    let (lo, hi) = map.port(from, to)?;
    Some(byte_span(text, lo, hi))
}

// ---- L3 ----

fn near_match(text: &str, quote: &str, hint: usize) -> Option<Located> {
    if quote.is_empty() {
        return None;
    }
    let (from, to) = window(text, hint);
    let win: Vec<char> = text[from..to].chars().collect();
    let pattern: Vec<char> = quote.chars().take(MAX_PATTERN).collect();
    let loc = text[from..hint.max(from).min(to)].chars().count();
    let (at, _) = bitap(&win, &pattern, loc)?;

    let start = from + win[..at].iter().map(|c| c.len_utf8()).sum::<usize>();
    let mut end = (start + quote.len()).min(text.len());
    while end > start && !text.is_char_boundary(end) {
        end -= 1;
    }
    let score = coverage(quote, &text[start..end]);
    if score < ENOUGH {
        return None;
    }
    Some(made(text, start, end, Method::Fuzzy, Some(score), 1))
}

// 手掛かりの周りだけを見る。全文を 1 文字ずつ持つと、当たりもしない遠くの
// ために大きな配列を組むことになる。
fn window(text: &str, hint: usize) -> (usize, usize) {
    let mut from = hint.saturating_sub(WINDOW * 4);
    let mut to = (hint + WINDOW * 4).min(text.len());
    while from > 0 && !text.is_char_boundary(from) {
        from -= 1;
    }
    while to < text.len() && !text.is_char_boundary(to) {
        to += 1;
    }
    (from, to)
}

// diff-match-patch の match_bitap と同じ組み立て。text の loc の近くから、
// pattern にいちばん近い場所の**先頭**を返す。得点は 0 に近いほどよい。
fn bitap(text: &[char], pattern: &[char], loc: usize) -> Option<(usize, f64)> {
    let m = pattern.len();
    let n = text.len();
    if m == 0 || m > MAX_PATTERN || n == 0 {
        return None;
    }

    // 型の並びは逆順に置く。本文は後ろから前へ走らせるので、いちばん上の桁が
    // 型の先頭にあたる（diff-match-patch の match_alphabet と同じ）。
    let mut alphabet: HashMap<char, u64> = HashMap::new();
    for (i, c) in pattern.iter().enumerate() {
        *alphabet.entry(*c).or_insert(0) |= 1u64 << (m - 1 - i);
    }

    let score = |errors: usize, at: usize| -> f64 {
        let accuracy = errors as f64 / m as f64;
        let proximity = (loc as i64 - at as i64).unsigned_abs() as f64;
        accuracy + proximity / MATCH_DISTANCE
    };

    let mut threshold = MATCH_THRESHOLD;
    let mask = 1u64 << (m - 1);
    let mut best: Option<usize> = None;
    let mut last: Vec<u64> = Vec::new();
    let mut bin_max = n + m;

    for d in 0..m {
        // 誤り d で閾値に収まる幅を二分で詰める。
        let mut bin_min = 0usize;
        let mut bin_mid = bin_max;
        while bin_min < bin_mid {
            if score(d, loc + bin_mid) <= threshold {
                bin_min = bin_mid;
            } else {
                bin_max = bin_mid;
            }
            bin_mid = (bin_max - bin_min) / 2 + bin_min;
        }
        bin_max = bin_mid;
        let mut start = 1.max(loc.saturating_sub(bin_mid) + 1);
        let finish = (loc + bin_mid).min(n) + m;

        let mut rd = vec![0u64; finish + 2];
        rd[finish + 1] = (1u64 << d) - 1;
        let mut j = finish;
        while j >= start {
            let hit = text
                .get(j.wrapping_sub(1))
                .and_then(|c| alphabet.get(c))
                .copied()
                .unwrap_or(0);
            rd[j] = if d == 0 {
                ((rd[j + 1] << 1) | 1) & hit
            } else {
                (((rd[j + 1] << 1) | 1) & hit)
                    | (((last[j + 1] | last[j]) << 1) | 1)
                    | last[j + 1]
            };
            if rd[j] & mask != 0 {
                let here = score(d, j - 1);
                if here <= threshold {
                    threshold = here;
                    best = Some(j - 1);
                    if j - 1 > loc {
                        start = 1.max((2 * loc).saturating_sub(j - 1));
                    } else {
                        break;
                    }
                }
            }
            j -= 1;
        }
        if score(d + 1, loc) > threshold {
            break;
        }
        last = rd;
    }
    best.map(|at| (at, threshold))
}

// ---- 一致の度合い ----

// 引用がその字の中にどれだけ含まれているか。読む側（src/lib/blockDiff.ts の
// coverage）と同じ式。引用はブロックの一部を抜いたものが多いので、両側の
// 長さを均す測り方だと、長いブロックに短い引用が丸ごと入っていても低く出る。
pub fn coverage(quote: &str, text: &str) -> f32 {
    if quote.is_empty() || text.is_empty() {
        return 0.0;
    }
    let left = bigrams(quote);
    let right = bigrams(text);
    let total: usize = left.values().sum();
    if total == 0 || right.is_empty() {
        return if quote == text { 1.0 } else { 0.0 };
    }
    let mut shared = 0usize;
    for (gram, count) in &left {
        shared += (*count).min(right.get(gram).copied().unwrap_or(0));
    }
    shared as f32 / total as f32
}

fn bigrams(text: &str) -> HashMap<(char, char), usize> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = HashMap::new();
    for pair in chars.windows(2) {
        *out.entry((pair[0], pair[1])).or_insert(0) += 1;
    }
    out
}

// ---- 作成時に控える手掛かり ----

// 引用の前後の字。96 文字ずつ。文字の境界で切る。
pub const CONTEXT: usize = 96;

pub fn context_of(source: &str, at: usize, len: usize) -> (String, String) {
    let before: String = source[..at.min(source.len())]
        .chars()
        .rev()
        .take(CONTEXT)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let after: String = source[(at + len).min(source.len())..]
        .chars()
        .take(CONTEXT)
        .collect();
    (before, after)
}

// 本文の中で引用がどこにあるか。複数あれば前後の文脈では決められないので、
// 先頭を採る（作成時点なので、どこであれその時点の本文と矛盾しない）。
pub fn offset_of(source: &str, quote: &str) -> Option<usize> {
    if quote.is_empty() {
        return None;
    }
    source.find(quote)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clues<'a>(quote: &'a str) -> Clues<'a> {
        Clues {
            quote,
            ..Default::default()
        }
    }

    #[test]
    fn line_numbers_count_from_one() {
        let text = "one\ntwo\nthree\n";
        assert_eq!(lines_of(text, 0, 3), (1, 1));
        assert_eq!(lines_of(text, 4, 7), (2, 2));
        assert_eq!(lines_of(text, 8, 13), (3, 3));
    }

    #[test]
    fn a_range_that_ends_with_a_newline_stays_on_its_own_line() {
        let text = "one\ntwo\nthree\n";
        // "one\n" は 1 行目だけ。次の行を巻き込まない。
        assert_eq!(lines_of(text, 0, 4), (1, 1));
        // "one\ntwo\n" は 1 行目から 2 行目。
        assert_eq!(lines_of(text, 0, 8), (1, 2));
    }

    #[test]
    fn line_numbers_are_counted_in_lines_not_bytes() {
        let text = "あいう\nえお\nかきく\n";
        let at = text.find("えお").unwrap();
        assert_eq!(lines_of(text, at, at + "えお".len()), (2, 2));
    }

    #[test]
    fn the_last_line_without_a_newline_is_still_a_line() {
        let text = "one\ntwo";
        assert_eq!(lines_of(text, 4, 7), (2, 2));
    }

    #[test]
    fn crlf_counts_as_one_break() {
        let text = "one\r\ntwo\r\n";
        assert_eq!(lines_of(text, 5, 8), (2, 2));
    }

    #[test]
    fn a_unique_quote_is_certain() {
        let text = "はじめに\n\n本文のひとつめ\n\n本文のふたつめ\n";
        let found = locate(text, &clues("本文のひとつめ")).unwrap();
        assert_eq!(found.method, Method::Exact);
        assert_eq!(found.candidates, 1);
        assert_eq!(found.lines(), "L3");
        assert_eq!(found.label(), "確実");
    }

    #[test]
    fn the_same_sentence_three_times_is_not_decided() {
        let text = "同じ文\n\n同じ文\n\n同じ文\n";
        let found = locate(text, &clues("同じ文")).unwrap();
        assert_eq!(found.candidates, 3);
        assert_eq!(found.label(), "候補3");
        // 先頭は出す。読み手が見に行く起点になる。
        assert_eq!(found.lines(), "L1");
    }

    #[test]
    fn context_picks_one_of_the_candidates() {
        let text = "前書き\n\n同じ文\n\n中ほど\n\n同じ文\n\n終わり\n";
        let found = locate(
            text,
            &Clues {
                quote: "同じ文",
                prefix: "中ほど\n\n",
                suffix: "\n\n終わり",
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.method, Method::Context);
        assert_eq!(found.lines(), "L7");
        // 何か所あったかは残す。
        assert_eq!(found.candidates, 2);
        assert_eq!(found.label(), "確実");
    }

    #[test]
    fn context_that_does_not_separate_the_candidates_decides_nothing() {
        let text = "はじめ\n\n同じ文\n\n同じ文\n";
        let found = locate(
            text,
            &Clues {
                quote: "同じ文",
                // どちらの候補の前にも同じ字が並んでいる。分けられない。
                prefix: "\n\n",
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.candidates, 2);
        assert_eq!(found.label(), "候補2");
    }

    #[test]
    fn the_cached_range_is_taken_without_searching() {
        let text = "あ\n\n同じ文\n\n同じ文\n";
        let at = text.rfind("同じ文").unwrap();
        let found = locate(
            text,
            &Clues {
                quote: "同じ文",
                cached: Some((at, at + "同じ文".len())),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.method, Method::Cache);
        assert_eq!(found.start, at);
        assert_eq!(found.candidates, 1);
    }

    #[test]
    fn a_stale_cache_falls_through_to_the_search() {
        let text = "はじめに\n\n本文\n";
        let found = locate(
            text,
            &Clues {
                quote: "本文",
                // ファイルが縮んで、控えの範囲が本文の外に出ている。
                cached: Some((900, 950)),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.method, Method::Exact);
    }

    #[test]
    fn the_cache_holds_the_text_seen_last_time() {
        let text = "はじめに\n\n直したあとの本文\n";
        let at = text.find("直したあとの本文").unwrap();
        let found = locate(
            text,
            &Clues {
                quote: "直す前の本文",
                head_quote: "直したあとの本文",
                cached: Some((at, at + "直したあとの本文".len())),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.method, Method::Cache);
    }

    // ---- L2 ----

    fn ported(base: &str, head: &str, quote: &str) -> Option<Located> {
        let map = LineMap::build(base, head);
        locate(
            head,
            &Clues {
                quote,
                base: Some(base),
                map: Some(&map),
                ..Default::default()
            },
        )
    }

    #[test]
    fn adding_lines_above_moves_the_range_down() {
        let base = "一行目\n\n直す対象の段落\n\n終わり\n";
        let head = "一行目\n\n足した段落\n\n直された段落です\n\n終わり\n";
        let found = ported(base, head, "直す対象の段落").unwrap();
        assert_eq!(found.method, Method::Ported);
        // 足した段落と書き換えた段落が同じ区間に入っているので、どちらが
        // 書き換えかは行差分では決まらない。区間ごと覆い、指した先に必ず
        // 入っているようにする。
        assert!(found.line_start <= 5 && found.line_end >= 5, "{found:?}");
    }

    #[test]
    fn removing_lines_above_moves_the_range_up() {
        let base = "前の節\n\n消える段落\n\n直す対象の段落\n";
        let head = "前の節\n\n直された段落です\n";
        let found = ported(base, head, "直す対象の段落").unwrap();
        assert_eq!(found.method, Method::Ported);
        assert_eq!(found.lines(), "L3");
    }

    #[test]
    fn a_block_split_in_two_is_covered_by_both() {
        let base = "見出し\n\nひとつめの文。ふたつめの文。\n";
        let head = "見出し\n\nひとつめの文。\n\nふたつめの文。\n";
        let found = ported(base, head, "ひとつめの文。ふたつめの文。").unwrap();
        // 割れた両方を覆う。指摘した対象が今はこの範囲、で正しい。
        assert_eq!(found.line_start, 3);
        assert!(found.line_end >= 5, "{found:?}");
    }

    #[test]
    fn a_removed_block_is_not_pointed_at() {
        let base = "見出し\n\n消える段落\n\n残る段落\n";
        let head = "見出し\n\n残る段落\n";
        assert!(ported(base, head, "消える段落").is_none());
    }

    #[test]
    fn the_quote_is_not_ported_when_it_is_still_there() {
        let base = "見出し\n\nそのままの段落\n";
        let head = "足した行\n\n見出し\n\nそのままの段落\n";
        let found = ported(base, head, "そのままの段落").unwrap();
        // 探せば見つかるので、差分は走らせない。
        assert_eq!(found.method, Method::Exact);
    }

    // ---- L3 ----

    #[test]
    fn a_lightly_edited_quote_is_found_near_the_hint() {
        let base = "見出し\n\n通知の対象をビューで絞り込めるようにする。\n";
        let head = "見出し\n\n通知の対象をビューで絞り込めるようにしたい。\n";
        // 行差分では書き換えとして移送できるが、移送を切っても近似で拾える。
        let found = locate(
            head,
            &Clues {
                quote: "通知の対象をビューで絞り込めるようにする。",
                base_offset: base.find("通知").map(|at| at),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.method, Method::Fuzzy);
        assert!(found.score.unwrap() >= ENOUGH);
        assert_eq!(found.line_start, 3);
    }

    #[test]
    fn a_completely_different_text_is_not_guessed() {
        let head = "見出し\n\nまったく関係のない話をしている段落。\n";
        let found = locate(
            head,
            &Clues {
                quote: "通知の対象をビューで絞り込めるようにする。",
                base_offset: Some(6),
                ..Default::default()
            },
        );
        assert!(found.is_none(), "{found:?}");
    }

    #[test]
    fn nothing_to_go_on_means_no_position() {
        let head = "見出し\n\n本文\n";
        assert!(locate(head, &clues("どこにも無い字")).is_none());
    }

    // ---- 段の順序 ----

    #[test]
    fn the_cheap_stage_wins_over_the_expensive_one() {
        let base = "見出し\n\n対象の段落\n";
        let head = "足した行\n\n見出し\n\n対象の段落\n";
        let map = LineMap::build(base, head);
        let at = head.find("対象の段落").unwrap();
        let found = locate(
            head,
            &Clues {
                quote: "対象の段落",
                cached: Some((at, at + "対象の段落".len())),
                base: Some(base),
                map: Some(&map),
                ..Default::default()
            },
        )
        .unwrap();
        // 控えが当たっているので、探索も差分も走らない。
        assert_eq!(found.method, Method::Cache);
    }

    // ---- 一致の度合い ----

    #[test]
    fn coverage_matches_the_reading_side() {
        assert_eq!(coverage("あいう", "あいう"), 1.0);
        assert_eq!(coverage("", "あいう"), 0.0);
        // 長い本文に短い引用が丸ごと入っていれば 1。
        assert_eq!(coverage("あいう", "まえ あいう あと"), 1.0);
        assert!(coverage("あいう", "かきくけこ") < 0.2);
    }

    #[test]
    fn a_single_character_quote_has_no_pairs() {
        // 2 文字組が取れない字は、同じかどうかで見る。
        assert_eq!(coverage("あ", "あ"), 1.0);
        assert_eq!(coverage("あ", "い"), 0.0);
    }

    #[test]
    fn the_gui_and_the_cli_mean_the_same_range() {
        // GUI はブロックの位置を本文内のオフセットで持つ。frontmatter の長さを
        // 足したものがファイル内の位置になる。CLI が引用から解いた範囲は、
        // それと同じ量でなければならない。
        let file = "---\ntitle: め\n---\n\n見出し\n\n対象の段落\n";
        let body = "\n見出し\n\n対象の段落\n";
        let head = file.len() - body.len();
        // GUI 側のブロック（本文内のオフセット）。
        let block_start = body.find("対象の段落").unwrap();
        let block_end = block_start + "対象の段落".len();

        let found = locate(file, &clues("対象の段落")).unwrap();
        assert_eq!(found.start, head + block_start);
        assert_eq!(found.end, head + block_end);
    }

    #[test]
    fn a_range_is_never_cut_inside_a_character() {
        let text = "あいうえお\n";
        let found = locate(text, &clues("いうえ")).unwrap();
        assert!(text.is_char_boundary(found.start));
        assert!(text.is_char_boundary(found.end));
        assert_eq!(&text[found.start..found.end], "いうえ");
    }

    // ---- 作成時の手掛かり ----

    #[test]
    fn context_is_cut_at_character_boundaries() {
        let source = "まえの字。\n\n対象の段落\n\nあとの字。\n";
        let at = source.find("対象の段落").unwrap();
        let (prefix, suffix) = context_of(source, at, "対象の段落".len());
        assert!(prefix.ends_with("まえの字。\n\n"));
        assert!(suffix.starts_with("\n\nあとの字。"));
    }

    #[test]
    fn context_is_capped() {
        let source = format!("{}対象{}", "あ".repeat(300), "い".repeat(300));
        let at = source.find("対象").unwrap();
        let (prefix, suffix) = context_of(&source, at, "対象".len());
        assert_eq!(prefix.chars().count(), CONTEXT);
        assert_eq!(suffix.chars().count(), CONTEXT);
    }
}
