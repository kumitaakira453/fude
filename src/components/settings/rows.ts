import type { WritableAtom } from "jotai";

// 設定の項目。責務ごとに面を分け、面の中は項目の表で持つ。
//
// 同じ形の行（記号・名前・説明・スイッチ）を面ごとに手で書くと、項目を足すたびに
// 貼り付けが増え、面をまたいで探すこともできない。形を型で決めておけば、描くのは
// 1 つの部品で済み、絞り込みも表を舐めるだけになる。

export type Face = "look" | "write" | "files" | "app";

export const FACES: { id: Face; label: string; icon: string }[] = [
  { id: "look", label: "見た目", icon: "palette" },
  { id: "write", label: "書く", icon: "edit_note" },
  { id: "files", label: "ファイル", icon: "folder" },
  { id: "app", label: "このアプリ", icon: "info" },
];

// 切り替えできる設定。読み書きは atom に委ねる。
export type Flag = WritableAtom<boolean, [boolean], void>;
export type Words = WritableAtom<string, [string], void>;
export type Chars = WritableAtom<string[], [string[]], void>;

interface Base {
  id: string;
  face: Face;
  name: string;
  note: string;
  // 名前と説明では当たらない呼び方。絞り込みで使う（すべて小文字）。
  aliases?: string[];
}

export interface SwitchRow extends Base {
  kind: "switch";
  icon: string;
  beta?: boolean;
  atom: Flag;
}

export interface WordsRow extends Base {
  kind: "words";
  // 切り替えの行と同じ絵の桁を持つ。無いと名前の左端だけが内側へ寄る。
  icon: string;
  // 1 行で足りるか、何行も書くか。
  lines: "one" | "many";
  atom: Words;
  placeholder: string;
}

// 決まった一覧から、使うものを選ぶもの（タスクの印）。
export interface MarksRow extends Base {
  kind: "marks";
  icon: string;
  beta?: boolean;
  atom: Chars;
}

// 見本を出して選ぶもの（テーマ・書体・本文幅）。描き方がそれぞれ違うので、
// 中身は Settings の側で組む。ここでは面と当て方だけを持つ。
export interface PickRow extends Base {
  kind: "pick";
  pick: "theme" | "font" | "width";
}

// 押すと何かが起きるもの。
export interface DoRow extends Base {
  kind: "do";
  icon: string;
  label: string;
}

// このアプリの版と説明。
export interface AboutRow extends Base {
  kind: "about";
}

export type Row = SwitchRow | WordsRow | MarksRow | PickRow | DoRow | AboutRow;

// 絞り込みの当て方。名前・説明・別名・面の名前を見る。
export function matches(row: Row, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const face = FACES.find((f) => f.id === row.face)?.label ?? "";
  const hay = [row.name, row.note, face, ...(row.aliases ?? [])]
    .join(" ")
    .toLowerCase();
  // 空白で区切って、すべて含むものを当てる。
  return q.split(/\s+/).every((word) => hay.includes(word));
}
