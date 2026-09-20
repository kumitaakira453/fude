// 囲み（callout / details）の範囲と、字下げの落とし方。
//
// 囲みの範囲を CommonMark に決めさせると、どちらに転んでも崩れる。Notion の
// 書き出しは `</details>` の後に空行を置かないので、HTML ブロックが次の空行まで
// 続いて後ろの本文まで飲み込む。逆に中に空行があると、囲みの途中でブロックが
// 割れて、開きだけ・中身だけ・閉じだけに散る。だから範囲は行で決める。
//
// 同じ字下げの話がもう 1 つある。Notion は入れ子をタブや空白で写すので、親の
// 項目が無くなると（表が字下げされずに間へ入ると）続きの行が字下げコードとして
// 読まれる。実データでは字下げコード 46 個のうち 42 個がこれで、本物のコードは
// 空白字下げで箇条書きの印を持たない 2 個だけだった。

export type ContainerKind = "callout" | "details";

export const CONTAINERS: Record<ContainerKind, { open: RegExp; close: string }> = {
  callout: { open: /^<callout(\s[^>]*)?>$/, close: "</callout>" },
  details: { open: /^<details(\s[^>]*)?>$/, close: "</details>" },
};

const KINDS = Object.keys(CONTAINERS) as ContainerKind[];

export interface ContainerSpan {
  kind: ContainerKind;
  // 開きタグの行頭と、閉じタグの行末（排他）。
  start: number;
  end: number;
}

export function indentOf(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

// 空でない行に共通の行頭空白。
export function commonIndent(lines: string[]): string {
  let pad: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const head = indentOf(line);
    if (pad === null || head.length < pad.length) pad = head;
    if (pad === "") break;
  }
  return pad ?? "";
}

// 行の一覧と、その行が本文のどこから始まるか。
function linesOf(src: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const text of src.split("\n")) {
    out.push({ text, at });
    at += text.length + 1;
  }
  return out;
}

// 囲みのコード。この中のタグは字であって、囲みの開き閉じではない。記法の
// 見本として `<callout>` を囲みに入れて書くと、そこで本文が切られてしまう。
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function fenceOf(line: string): string | null {
  return FENCE.exec(line)?.[1] ?? null;
}

// 開いた囲みを閉じるか。同じ字で、開いたときと同じ数以上。後ろに字を置けない。
export function closesFence(line: string, open: string): boolean {
  const mark = fenceOf(line);
  if (!mark || mark[0] !== open[0] || mark.length < open.length) return false;
  return line.trim().slice(mark.length).trim() === "";
}

// 開きの行から、深さを数えて釣り合う閉じの行を探す。入れ子の囲みで外側が
// 内側の閉じで閉じないようにする。見つからなければ -1。
export function closeLineOf(
  lines: string[],
  from: number,
  kind: ContainerKind,
): number {
  const { open, close } = CONTAINERS[kind];
  let depth = 1;
  let fence: string | null = null;
  for (let i = from + 1; i < lines.length; i++) {
    const text = lines[i].trim();
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
      continue;
    }
    const opened = fenceOf(lines[i]);
    if (opened) {
      fence = opened;
      continue;
    }
    if (open.test(text)) depth++;
    else if (text === close && --depth === 0) return i;
  }
  return -1;
}

// その行に立っている囲みの種類。
export function kindOf(line: string): ContainerKind | null {
  const text = line.trim();
  return KINDS.find((k) => CONTAINERS[k].open.test(text)) ?? null;
}

// 桁 0 に立っている囲みの範囲。項目の中の囲みは一覧ごと 1 つのブロックに
// したいので、字下げのある開きは対象にしない。
export function containerSpans(src: string): ContainerSpan[] {
  if (!src.includes("<callout") && !src.includes("<details")) return [];

  const lines = linesOf(src);
  const out: ContainerSpan[] = [];

  const texts = lines.map((l) => l.text);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = fenceOf(line);
    if (opened) {
      fence = opened;
      continue;
    }
    if (indentOf(line) !== "") continue;
    const kind = kindOf(line);
    if (!kind) continue;
    const end = closeLineOf(texts, i, kind);
    if (end < 0) continue;
    out.push({ kind, start: lines[i].at, end: lines[end].at + lines[end].text.length });
    i = end;
  }

  return out;
}

export interface Unpadded {
  text: string;
  // 落とした後の位置から、元の位置へ戻す。
  back: (at: number) => number;
}

// 各行の頭から pad を落とし、落とした後の位置から元の位置を引ける表を作る。
export function unpadLines(text: string, pad: string): Unpadded | null {
  if (!pad) return null;
  const out: string[] = [];
  const map: number[] = [];
  let at = 0;
  text.split("\n").forEach((line, i) => {
    if (i > 0) {
      map.push(at);
      at += 1;
    }
    // 字下げが揃っていない行は、空白のあるところまでしか落とさない。
    const room = line.startsWith(pad) ? pad.length : indentOf(line).length;
    const drop = Math.min(pad.length, room);
    at += drop;
    const rest = line.slice(drop);
    for (let j = 0; j < rest.length; j++) map.push(at + j);
    at += rest.length;
    out.push(rest);
  });
  map.push(at);
  return {
    text: out.join("\n"),
    back: (i) => map[Math.min(Math.max(i, 0), map.length - 1)],
  };
}

// 囲みの中身から落としてよい字下げ。
//
// 囲みが立っている桁の分は当然落とす（項目の中の囲みはその桁に立っている）。
// そこから先も、タブ・空白を問わず落とす。Notion は囲みの中身を開きタグより
// 深い桁で書き出すことがあり、空白 4 つ以上で残すとその段落ごとコードとして
// 読まれる（強調も生のまま出る）。
//
// 囲みの中でコードを書くときはフェンスを使う。桁を落としても開きと閉じの
// 対応は崩れないので、中身はコードのまま残る。
export function innerPad(lines: string[], pad: string): string {
  const common = commonIndent(lines);
  return common.startsWith(pad) ? common : pad;
}

const MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;

// 字下げコードに見えているが、実は親の項目を失った一覧か。
//
// どちらかに当たれば一覧として読む。
//   - 空でない行がすべて箇条書きの印で始まる
//   - 空でない行がすべてタブで始まり、箇条書きの印の行が 1 つ以上ある
//     （タブは Notion が入れ子を写した跡。中に画像やトグルが混ざる）
// 空白字下げで印を持たないものは触らない（本物の字下げコード）。
export function lostList(src: string): boolean {
  if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(src)) return false;
  const rows = src.split("\n").filter((line) => line.trim() !== "");
  if (!rows.length) return false;
  if (commonIndent(rows) === "") return false;
  if (rows.every((line) => MARKER.test(line))) return true;
  return rows.every((line) => line.startsWith("\t")) && rows.some((line) => MARKER.test(line));
}
