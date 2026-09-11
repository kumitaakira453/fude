import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./fromMarkdown";
import { outTopBack, outTopUp } from "./plugins";

// 本文の先頭から、その上のフロントマターの欄へ抜ける。
//
// ↑ は「画面の上端の行にいるか」で見るので、折り返した段落の 2 行目からは
// 抜けない。← と Backspace は本文のいちばん先頭の位置でだけ抜ける。

const SRC = `一つめの段落。

二つめの段落。
`;

const LIST = `- 一つ
- 二つ
`;

function cursor(body: string, pos: number): EditorState {
  const state = EditorState.create({ doc: fromMarkdown(body).doc });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

// その文で始まるテキストブロックの、いちばん頭の位置。
function headOf(state: EditorState, text: string): number {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent.startsWith(text)) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  return at;
}

// 行の上端かどうかだけを答える、測らない編集面。jsdom は描画を持たないので
// 本物の endOfTextblock は使えない。
const seen = (top: boolean) =>
  ({ endOfTextblock: () => top }) as unknown as EditorView;

describe("↑ で上へ抜ける", () => {
  it("先頭ブロックの上端の行からは抜ける", () => {
    let left = 0;
    const go = outTopUp(() => {
      left++;
      return true;
    });
    expect(go(cursor(SRC, 1), undefined, seen(true))).toBe(true);
    expect(left).toBe(1);
  });

  it("折り返した 2 行目からは抜けない（本文の中の移動に譲る）", () => {
    let left = 0;
    const go = outTopUp(() => {
      left++;
      return true;
    });
    expect(go(cursor(SRC, 1), undefined, seen(false))).toBe(false);
    expect(left).toBe(0);
  });

  it("先頭ブロックの途中の字からでも、上端の行なら抜ける", () => {
    const go = outTopUp(() => true);
    expect(go(cursor(SRC, 4), undefined, seen(true))).toBe(true);
  });

  it("2 つめ以降のブロックからは抜けない", () => {
    const state = cursor(SRC, 1);
    const at = headOf(state, "二つめ");
    const go = outTopUp(() => true);
    expect(go(cursor(SRC, at), undefined, seen(true))).toBe(false);
  });

  it("受け取る先が無ければ抜けない", () => {
    const go = outTopUp(() => false);
    expect(go(cursor(SRC, 1), undefined, seen(true))).toBe(false);
  });
});

describe("← と Backspace で上へ抜ける", () => {
  it("本文のいちばん先頭でだけ抜ける", () => {
    const go = outTopBack(() => true);
    expect(go(cursor(SRC, 1), undefined)).toBe(true);
    expect(go(cursor(SRC, 2), undefined)).toBe(false);
  });

  it("箇条書きで始まる本文でも、その先頭でだけ抜ける", () => {
    const go = outTopBack(() => true);
    const state = cursor(LIST, 1);
    const first = headOf(state, "一つ");
    const second = headOf(state, "二つ");
    expect(go(cursor(LIST, first), undefined)).toBe(true);
    expect(go(cursor(LIST, second), undefined)).toBe(false);
  });

  it("字を選んでいるときは抜けない", () => {
    const state = EditorState.create({ doc: fromMarkdown(SRC).doc });
    const picked = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 4)),
    );
    expect(outTopBack(() => true)(picked, undefined)).toBe(false);
  });
});
