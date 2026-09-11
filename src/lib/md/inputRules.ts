import {
  InputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { MarkType } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { DETAILS_HEAD, schema } from "./schema";

// 打った記号から構造を作る。
//
// このモードは記号を画面に残さないので、打った瞬間にノードへ変える必要がある。
// 打った記号そのもの（箇条書きの - か *、コードの囲みと言語、水平線の形）は
// attrs に残す。保存では原文の書き方へ戻すので、* で作った箇条書きが - に
// なって返ることはない。

// 記号で囲んで装飾する規則。閉じ記号を打った時点で、囲みを消して mark を付ける。
// 既製の規則はブロック向けだけなので、行内は自分で組む。
function markRule(pattern: RegExp, type: MarkType) {
  return new InputRule(pattern, (state, match, start, end) => {
    const body = match[1];
    if (!body) return null;
    const from = start + match[0].indexOf(body);
    const to = from + body.length;
    // 後ろから消す。先に前を消すと、後ろの位置がずれる。
    const tr = state.tr;
    if (to < end) tr.delete(to, end);
    if (from > start) tr.delete(start, from);
    return tr
      .addMark(start, start + body.length, type.create())
      .removeStoredMark(type);
  });
}

// 行内コードは中に別の装飾を持てないので、打ち直して mark を付ける。
// 日本語入力のままだと全角の ｀ が入ることがあるので、どちらも受ける。
const codeRule = new InputRule(/(?<![`｀])[`｀]([^`｀\n]+)[`｀]$/, (state, match, start, end) => {
  const body = match[1];
  return state.tr
    .replaceWith(start, end, schema.text(body))
    .addMark(start, start + body.length, schema.marks.code.create())
    .removeStoredMark(schema.marks.code);
});

// [題](url) を打ったらリンクにする。
const linkRule = new InputRule(
  /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"\n]*)")?\)$/,
  (state, match, start, end) => {
    const [, label, href, title] = match;
    const mark = schema.marks.link.create({ href, title: title ?? null });
    return state.tr
      .replaceWith(start, end, schema.text(label, [mark]))
      .removeStoredMark(schema.marks.link);
  },
);

// --- や *** を打ったら水平線にする。打った形をそのまま覚える。
const ruleRule = new InputRule(/^(-{3,}|\*{3,}|_{3,})$/, (state, match, start, end) =>
  // 段落の中に線は置けない。範囲ごと差し替えて、段落そのものを線にする。
  state.tr.replaceRangeWith(
    start,
    end,
    schema.nodes.thematicBreak.create({ marker: match[1] }),
  ),
);

// 箇条書きの項目の頭で [ ] / [x] を打ったらタスクにする。
// 箇条書きにする規則と重ねて使う（"- " で項目になり、続く "[ ] " でタスクになる）。
const taskRule = new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  for (let depth = $start.depth; depth > 0; depth--) {
    if ($start.node(depth).type !== schema.nodes.listItem) continue;
    return state.tr
      .delete(start, end)
      .setNodeMarkup($start.before(depth), undefined, {
        checked: match[1].toLowerCase() === "x",
      });
  }
  return null;
});

// Notion 風の打ち込み（試験中の設定）。入れると `>` がトグル、`|` が引用になる。
// 既定は Markdown のまま（`>` が引用）。規則は打鍵のたびに走るので、設定の値は
// ここに持たせて App から入れ直す。
let notionKeys = false;

export const setNotionKeys = (on: boolean) => {
  notionKeys = on;
};

// いまの塊をトグルの中身にする。`/トグル要素` と同じ形。
function toToggle(state: EditorState, start: number, end: number): Transaction | null {
  const details = schema.nodes.details;
  const $start = state.doc.resolve(start);
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), details)) {
    return null;
  }
  const tr = state.tr.delete(start, end);
  const $from = tr.selection.$from;
  const at = $from.before();
  const inner = schema.nodes.paragraph.create(null, $from.parent.content);
  tr.replaceRangeWith(at, $from.after(), details.create({ head: DETAILS_HEAD }, inner));
  return tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1), 1));
}

// `>` の規則。設定が入っていないときは何もしないので、後ろの引用の規則が拾う。
const toggleRule = new InputRule(/^\s*>\s$/, (state, _match, start, end) =>
  notionKeys ? toToggle(state, start, end) : null,
);

const quoteByPipe = wrappingInputRule(/^\s*\|\s$/, schema.nodes.blockquote);

// `|` で引用。設定が入っているときだけ効かせる（`|` は表の記号でもある）。
const pipeRule = new InputRule(/^\s*\|\s$/, (state, match, start, end) =>
  notionKeys ? quoteByPipe.handler(state, match, start, end) : null,
);

export const rules = [
  // ブロック
  textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
    level: match[1].length,
  })),
  textblockTypeInputRule(/^[`｀]{3}([a-zA-Z0-9_+-]*)\s$/, schema.nodes.codeBlock, (match) => ({
    lang: match[1] || null,
    fenced: true,
    fence: "```",
  })),
  // 先に見る。設定が入っていなければ素通りして、次の引用の規則が拾う。
  toggleRule,
  wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
  pipeRule,
  wrappingInputRule(/^\s*([-*+])\s$/, schema.nodes.bulletList, (match) => ({
    marker: match[1],
  })),
  wrappingInputRule(
    /^(\d+)([.)])\s$/,
    schema.nodes.orderedList,
    (match) => ({ start: Number(match[1]), marker: match[2] }),
    (match, node) => node.childCount + node.attrs.start === Number(match[1]),
  ),
  taskRule,
  ruleRule,

  // 行内。強い → 取り消し → 斜めの順に見る（** を * が先に拾わないように）。
  codeRule,
  linkRule,
  markRule(/(?<!\*)\*\*([^*\n]+)\*\*$/, schema.marks.strong),
  markRule(/(?<!~)~~([^~\n]+)~~$/, schema.marks.strike),
  markRule(/(?<![*\w])\*([^*\n]+)\*$/, schema.marks.em),
];
