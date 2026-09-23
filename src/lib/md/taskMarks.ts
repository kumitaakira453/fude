// タスクの印。
//
// GFM は `[ ]` と `[x]` しか持たない。進行中・取りやめのような途中の状態は
// 印として書けず、`- [/] やること` は「[/] やること」という字になる。
//
// 原文はそのまま置き、読むときにこちらで印として読み取る。Obsidian と同じ
// 書き方なので、他の道具で開いても字として残り、壊れない。
//
// 木の直し方（readTaskMarks）は 3 つの経路が同じものを通る。
//
//   読む面        Markdown.tsx の remark の段
//   編集面        fromMarkdown.ts（読み込み）と toMarkdown.ts（書き戻し）
//   選んだ位置    projection.ts（画面の字から原文の位置を割り出す）
//
// 1 つでも外れると、描いている字と原文の位置が印の分だけずれる。

export interface TaskMark {
  // 角括弧の中の 1 字。これをそのまま原文に書く。
  ch: string;
  name: string;
  icon: string;
  // 済んだものとして扱う。字を薄くして線を引く。
  done?: boolean;
}

export const BLANK = " ";
export const DONE = "x";

// いつでもある 2 つ。GFM の印そのもの。
export const BASE_MARKS: TaskMark[] = [
  { ch: BLANK, name: "未完了", icon: "check_box_outline_blank" },
  { ch: DONE, name: "完了", icon: "check_box", done: true },
];

// 設定で選ぶもの。切ってあるものは今までどおり字として出る
// （`[?]` を文章の中で書く人を巻き込まない）。
export const EXTRA_MARKS: TaskMark[] = [
  { ch: "/", name: "進行中", icon: "indeterminate_check_box" },
  { ch: "-", name: "取りやめ", icon: "disabled_by_default", done: true },
  { ch: ">", name: "先送り", icon: "schedule" },
  { ch: "?", name: "疑問", icon: "help" },
];

export const DEFAULT_MARKS = ["/", "-"];

// 頭の 2 つを足した並び。設定が持つのは特殊な印だけ。
export function marksOf(extra: readonly string[]): string[] {
  return [BLANK, DONE, ...extra];
}

// 読む面の remark の段。有効な印を渡して組み直させる（設定を変えたその場で
// 印が出る・字に戻る）。
export function remarkTaskMarks(marks: string[]) {
  return (tree: unknown) => {
    readTaskMarks(tree, marks);
  };
}

// いま有効な特殊の印。設定から App.tsx が渡す（inputRules の setNotionKeys と
// 同じ経路）。読む面は atom を見て組み直すので、ここを見るのは編集面と
// 原文の書き換え。
let extra: string[] = DEFAULT_MARKS;

export function setTaskMarks(list: readonly string[]): void {
  const known = new Set(EXTRA_MARKS.map((m) => m.ch));
  extra = list.filter((ch) => known.has(ch));
}

// 使える印の並び。頭の 2 つは常に入る。
export function taskMarks(): string[] {
  return [BLANK, DONE, ...extra];
}

export function markOf(ch: string): TaskMark | undefined {
  return [...BASE_MARKS, ...EXTRA_MARKS].find((m) => m.ch === ch);
}

export function iconOfMark(ch: string): string {
  return markOf(ch)?.icon ?? BASE_MARKS[0].icon;
}

// 済んだものとして描くか（薄く・取り消し線）。
export function markDone(ch: string | null): boolean {
  return ch !== null && !!markOf(ch)?.done;
}

// 押したときの行き先。完了なら未完了へ、それ以外はすべて完了へ。
// 特殊な印から押したときも 1 手で片付く。
export function flipped(ch: string): string {
  return ch === DONE ? BLANK : DONE;
}

// 正規表現に入れても意味を持たないように逃がす。
const safe = (chars: string[]): string =>
  chars.map((c) => c.replace(/[\\\]^-]/g, "\\$&")).join("");

// 行頭に書かれた印。`[c]` の後ろは空白か行末（続きの行があるときは改行）。
// 落とすのは印と、その直後の空白ひとつだけ。改行まで落とすと行が繋がる。
export function markHead(
  text: string,
  marks: string[] = taskMarks(),
): { mark: string; cut: number } | null {
  const hit = new RegExp(`^\\[([${safe(marks)}])\\](?=[ \\t\\n]|$)`).exec(text);
  if (!hit) return null;
  return { mark: hit[1], cut: /[ \t]/.test(text[3] ?? "") ? 4 : 3 };
}

// ---- 字として残っている印を、項目の属性へ移す ----

interface Node {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: Node[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  data?: { box?: string; hProperties?: Record<string, string> };
}

export function readTaskMarks(tree: unknown, marks: string[] = taskMarks()): void {
  walk(tree as Node, marks);
}

function walk(node: Node, marks: string[]): void {
  if (node.type === "listItem") {
    // GFM の印も同じ場所へ移す。読む側・書く側とも、項目に付いた印だけを
    // 見ればよくなる（GFM の真偽と特殊な印で経路が割れない）。
    if (node.checked == null) take(node, marks);
    else put(node, node.checked ? DONE : BLANK);
  }
  node.children?.forEach((kid) => walk(kid, marks));
}

function put(item: Node, box: string): void {
  item.data = { ...item.data, box, hProperties: { "data-box": box } };
  item.checked = null;
}

// 中身の無いタスク項目（`- [ ]` だけの行）も同じ道を通る。GFM は印として
// 読まないので字で残っており、読む面と編集面のどちらでも印として出す。
function take(item: Node, marks: string[]): void {
  const para = item.children?.[0];
  if (para?.type !== "paragraph") return;
  const text = para.children?.[0];
  if (text?.type !== "text" || !text.value) return;
  const head = markHead(text.value, marks);
  if (!head) return;

  const cut = head.cut;
  put(item, head.mark);
  text.value = text.value.slice(cut);
  // 原文のどこから来たかも進める。ここを置いていくと、選んだ字から割り出す
  // 位置が印の分だけ前へずれ、書き換えが 4 文字左にはみ出す。
  if (text.position) {
    text.position.start.column += cut;
    if (text.position.start.offset !== undefined) text.position.start.offset += cut;
  }
  if (text.value === "") para.children = para.children!.slice(1);
}

// 項目に移した印。読み取る前の木には無い。
export function boxOf(item: unknown): string | null {
  return (item as Node | null | undefined)?.data?.box ?? null;
}
