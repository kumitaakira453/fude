import {
  InputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { MarkType } from "prosemirror-model";
import { schema } from "./schema";

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
const codeRule = new InputRule(/(?<!`)`([^`\n]+)`$/, (state, match, start, end) => {
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

export const rules = [
  // ブロック
  textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
    level: match[1].length,
  })),
  textblockTypeInputRule(/^```([a-zA-Z0-9_+-]*)\s$/, schema.nodes.codeBlock, (match) => ({
    lang: match[1] || null,
    fenced: true,
    fence: "```",
  })),
  wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
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
