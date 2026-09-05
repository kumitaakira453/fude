import { baseKeymap, chainCommands, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  Fragment,
  Slice,
  type Mark,
  type MarkType,
  type Node as PmNode,
  type ResolvedPos,
} from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { Plugin, TextSelection, type Command } from "prosemirror-state";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import type { Transform } from "prosemirror-transform";
import { fromMarkdown } from "./fromMarkdown";
import { highlightCode } from "./highlight";
import { rules } from "./inputRules";
import { insideBlock } from "./nodeViews";
import { nestOf, schema } from "./schema";
import { slashMenu } from "./slash";
import {
  cellDown,
  cellEnd,
  cellEnter,
  cellLeft,
  cellRight,
  cellStart,
  cellUp,
  focusedCell,
} from "./tableKeys";

// 編集面の振る舞い一式。画面を作らずに同じ組み合わせを試せるよう、
// EditorView から切り離してある。

// ```lang と打って改行したときも、コードの塊にする。入力変換は空白で終わる
// 打鍵しか見ないので、改行で確定する人には効かない。
export const fenceOnEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const m = /^[`｀]{3,}([a-zA-Z0-9_+-]*)$/.exec($from.parent.textContent);
  if (!m) return false;
  if (dispatch) {
    const at = $from.start();
    dispatch(
      state.tr
        .delete(at, $from.end())
        .setBlockType(at, at, schema.nodes.codeBlock, {
          lang: m[1] || null,
          fenced: true,
          fence: "```",
        })
        .scrollIntoView(),
    );
  }
  return true;
};

// 行の中の改行。表のセルでは <br> を置く（GFM の表は行を分けられない）。
export const lineBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const inCell = (() => {
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type === schema.nodes.tableCell) return true;
    }
    return false;
  })();
  if (dispatch) {
    const node = inCell
      ? schema.nodes.rawInline.create({ value: "<br>" })
      : schema.nodes.hardBreak.create();
    dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  }
  return true;
};

// 打った記号から構造ができた直後の 1 回分。
interface Undone {
  transform: Transform;
  from: number;
  to: number;
  text: string;
}

// 入力変換の「直前の 1 回」を、選択を読み直しただけでは失わないように控える。
//
// prosemirror-inputrules は選択が動く transaction で控えを捨てる。WebKit は
// 文字を差し替えた直後に DOM 側の選択を読み直して同じ位置へ置き直すことがあり、
// それだけで控えが消えて、変換の直後の Backspace が字を消してしまう。
// 位置が本当に動いたときだけ捨てる。
function rememberRule(typed: Plugin): Plugin<Undone | null> {
  return new Plugin<Undone | null>({
    state: {
      init: () => null,
      apply(tr, prev, old, next) {
        const now = typed.getState(next) as Undone | null;
        if (now) return now;
        if (tr.docChanged) return null;
        return old.selection.eq(next.selection) ? prev : null;
      },
    },
  });
}

// 打った記号へ戻す。記号そのものを書きたいときの逃げ道。
function undoRule(kept: Plugin<Undone | null>): Command {
  return (state, dispatch) => {
    const back = kept.getState(state);
    if (!back) return false;
    if (dispatch) {
      const tr = state.tr;
      for (let i = back.transform.steps.length - 1; i >= 0; i--) {
        tr.step(back.transform.steps[i].invert(back.transform.docs[i]));
      }
      if (back.text) {
        const marks = tr.doc.resolve(back.from).marks();
        tr.replaceWith(back.from, back.to, schema.text(back.text, marks));
      } else {
        tr.delete(back.from, back.to);
      }
      dispatch(tr);
    }
    return true;
  };
}

// 項目を割るとき、いまの項目の性格（タスクかどうか）を次へ引き継ぐ。
// 素の splitListItem は既定の attrs で作るので、タスクの続きが素の項目になる。
const splitItem: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  let checked: boolean | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === schema.nodes.listItem) {
      checked = $from.node(d).attrs.checked as boolean | null;
      break;
    }
  }
  return splitListItem(
    schema.nodes.listItem,
    // チェックの入った項目を割ったら、続きは未了から始める。
    checked === null ? undefined : { checked: false },
  )(state, dispatch, view);
};

// 組版された姿から、書いたときの記号へ戻す。
//
// 記号を画面に出さない代わりに、記号そのものへ戻る道が要る。打った直後なら
// 入力変換の打ち消しで戻せるが、ファイルから開いたものには控えが無い。
// ブロックの先頭で Backspace、末尾で Delete をこれに当てる。
//
// 水平線は中身を持たないので、そのままでは触れない（節点として選べないように
// してある）。記号を 1 つ減らした段落に戻す。3 本そろわない "--" は水平線に
// 読まれないので、段落の文字として何も逃がさずに書ける。丸ごと文字に戻すと
// "\---" と逃がされ、Backspace 一回で中身が変わってしまう。
function hrToSource(at: number, hr: PmNode, back: boolean): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const marker = (hr.attrs.marker as string) || "---";
      // 戻る向きなら末尾の 1 つ、進む向きなら先頭の 1 つを落とす。
      const left = back ? marker.slice(0, -1) : marker.slice(1);
      const tr = state.tr.replaceWith(
        at,
        at + hr.nodeSize,
        schema.nodes.paragraph.create(null, schema.text(left)),
      );
      dispatch(
        tr
          .setSelection(TextSelection.create(tr.doc, back ? at + 1 + left.length : at + 1))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

// ブロックの先頭で Backspace。直前の水平線を記号へ戻し、見出しは飾りを外す。
const toSourceBack: Command = (state, dispatch, view) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0 || !$from.parent.isTextblock) return false;

  const head = $from.before();
  const prev = state.doc.resolve(head).nodeBefore;
  if (prev?.type === schema.nodes.thematicBreak) {
    return hrToSource(head - prev.nodeSize, prev, true)(state, dispatch, view);
  }

  // 見出しは飾りを外して段落にする。"#" を文字として戻すことはできない
  // （1 つ減らした "# " は h1 として読まれてしまう）。
  if ($from.parent.type === schema.nodes.heading) {
    if (dispatch) {
      dispatch(
        state.tr.setBlockType($from.pos, $from.pos, schema.nodes.paragraph).scrollIntoView(),
      );
    }
    return true;
  }
  return false;
};

// ブロックの末尾で Delete。直後の水平線を記号へ戻す。文書の最後に水平線が
// あると後ろへ回り込めないので、こちら側の道も要る。
const toSourceForward: Command = (state, dispatch, view) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;

  const tail = $from.after();
  const next = state.doc.resolve(tail).nodeAfter;
  if (next?.type !== schema.nodes.thematicBreak) return false;
  return hrToSource(tail, next, false)(state, dispatch, view);
};

// 行内の装飾を付け外しする。
//
// 記号を画面に出さないモードでは、入力変換で付けることはできても外す道が無い。
// 選んでいなければ、カーソルの居る装飾の範囲まるごとを外す（`code` の囲みを
// 消したいときに、いちいち選ばせない）。

// カーソルの居る装飾の範囲。隣り合っていれば、原文で分かれて書かれていても
// 1 つの範囲として返す。続いている装飾を 1 回で外せる。
function markRun($pos: ResolvedPos, type: MarkType): { from: number; to: number } | null {
  const parts: { from: number; to: number; on: boolean }[] = [];
  let at = $pos.start();
  $pos.parent.forEach((child) => {
    parts.push({ from: at, to: at + child.nodeSize, on: !!type.isInSet(child.marks) });
    at += child.nodeSize;
  });

  // 末尾も範囲に含める。そこで打つと装飾が続くので、同じ範囲と見なす。
  const hit = parts.findIndex((p) => p.on && $pos.pos > p.from && $pos.pos <= p.to);
  if (hit < 0) return null;
  let head = hit;
  let tail = hit;
  while (head > 0 && parts[head - 1].on) head--;
  while (tail < parts.length - 1 && parts[tail + 1].on) tail++;
  return { from: parts[head].from, to: parts[tail].to };
}

function toggleInline(type: MarkType): Command {
  return (state, dispatch, view) => {
    const { empty, $from } = state.selection;
    if (empty) {
      const run = markRun($from, type);
      if (run) {
        if (dispatch) {
          dispatch(state.tr.removeMark(run.from, run.to, type).removeStoredMark(type));
        }
        return true;
      }
    }
    return toggleMark(type)(state, dispatch, view);
  };
}

// 打った字が継ぐ装飾を、入れ子として書ける組み合わせに直す。
//
// ProseMirror は装飾ごとに「範囲の末尾で継ぐか」を決める。link は継がず
// （inclusive: false）code は継ぐので、[`名前.md`](url) の末尾で打った字は
// 「リンクの外にある行内コード」になる。Markdown の記号は必ず入れ子になるので
// この重なりは原文に書けず、行内コードが 2 つの ` 対に割れて出る。画面でも
// 囲みが 2 つ並ぶ。
//
// 内側の装飾が残るなら、それを包む外側の装飾も一緒に残す。リンクだけで囲った
// 文字の末尾では内側に何も残らないので、リンクが続かない既定の振る舞いは
// そのまま。
function nested(marks: readonly Mark[], before: readonly Mark[]): readonly Mark[] | null {
  const inner = Math.max(...marks.map((m) => nestOf(m.type.name)), -1);
  const add = before.filter((m) => nestOf(m.type.name) < inner && !m.isInSet(marks));
  if (!add.length) return null;
  return add.reduce((set: readonly Mark[], m) => m.addToSet(set), marks);
}

const keepNesting = new Plugin({
  appendTransaction(_trs, _old, state) {
    const { empty, $from } = state.selection;
    if (!empty || !$from.parent.inlineContent) return null;
    // 装飾の範囲の末尾に居るときだけ。文字の途中では継ぐ装飾が決まっている。
    if ($from.textOffset || !$from.nodeBefore) return null;
    const marks = nested(state.storedMarks ?? $from.marks(), $from.nodeBefore.marks);
    return marks ? state.tr.setStoredMarks(marks) : null;
  },
});

// コードの塊の中の Tab。字下げとして扱う（他と同じ半角 4 つ）。
const INDENT = "    ";

const indentCode: Command = (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (!$from.parent.type.spec.code) return false;
  if (dispatch) {
    if (empty) {
      dispatch(state.tr.insertText(INDENT, from).scrollIntoView());
    } else {
      // 選んだ範囲は行ごとに送る。
      const text = state.doc.textBetween(from, to, "\n");
      const moved = text.replace(/^/gm, INDENT);
      dispatch(state.tr.insertText(moved, from, to).scrollIntoView());
    }
  }
  return true;
};

const outdentCode: Command = (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (!$from.parent.type.spec.code) return false;
  if (dispatch) {
    if (empty) {
      // カーソルの手前にある字下げを 1 段だけ削る。
      const head = $from.start();
      const before = state.doc.textBetween(head, from, "\n");
      const back = /(?: {1,4}|\t)$/.exec(before);
      if (!back) return true;
      dispatch(state.tr.delete(from - back[0].length, from).scrollIntoView());
    } else {
      const text = state.doc.textBetween(from, to, "\n");
      const moved = text.replace(/^(?: {1,4}|\t)/gm, "");
      dispatch(state.tr.insertText(moved, from, to).scrollIntoView());
    }
  }
  return true;
};

// 貼り付けた文字を Markdown として読む。
//
// そのまま文字として入れると、保存のときに # や - が原文へ戻るように逃がされて
// 「\#」のような形になる。書いたとおりの構造として入れれば、逃がす必要が無い。
export function markdownSlice(text: string): Slice | null {
  const doc = fromMarkdown(text).doc;
  if (!doc.childCount) return null;

  const blocks: PmNode[] = [];
  doc.forEach((node) => {
    // 読み込んだ本文の目印と混ざらないよう、貼り付けた分の目印は外す。
    // 目印が無ければ、保存のときに原文から出さずに組み直す（正しい振る舞い）。
    const attrs = node.attrs.id === undefined ? node.attrs : { ...node.attrs, id: null };
    blocks.push(node.type.create(attrs, node.content, node.marks));
  });

  // 段落 1 つだけなら、いま書いている行の続きとして入れる。
  if (blocks.length === 1 && blocks[0].type === schema.nodes.paragraph) {
    return new Slice(blocks[0].content, 0, 0);
  }
  return new Slice(Fragment.from(blocks), 0, 0);
}

const pasteMarkdown = new Plugin({
  props: {
    handlePaste(view, event) {
      const data = event.clipboardData;
      if (!data) return false;
      // 書式付き（このアプリの中での複写を含む）は、そちらの読み取りに任せる。
      if (data.getData("text/html")) return false;
      const text = data.getData("text/plain");
      if (!text.trim()) return false;
      // コードの中は文字のまま入れる。
      if (view.state.selection.$from.parent.type.spec.code) return false;
      const slice = markdownSlice(text);
      if (!slice) return false;
      const tr = view.state.tr.replaceSelection(slice);
      // 貼り付けた最後が水平線のような葉ブロックだと、既定では「その塊を選んだ」
      // 状態になって枠が出る。文字の位置へ置き直す。
      view.dispatch(
        tr
          .setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to), 1))
          .scrollIntoView(),
      );
      return true;
    },
  },
});

export function editorPlugins({ onSave }: { onSave: () => void }): Plugin[] {
  const item = schema.nodes.listItem;
  const typed = inputRules({ rules });
  const kept = rememberRule(typed);

  return [
    history(),
    pasteMarkdown,
    typed,
    kept,
    // 段落の先頭の "/" から構造を選ぶ。矢印と Enter を先に取るので keymap より前。
    slashMenu,
    keymap({
      // 変換した直後に打ち消せないと、記号そのものを書けなくなる。
      // 打った直後でなくても、ブロックの先頭からは記号へ戻せるようにする。
      Backspace: chainCommands(undoRule(kept), toSourceBack),
      Delete: toSourceForward,
      "Mod-s": () => {
        onSave();
        return true;
      },
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      Enter: chainCommands(cellEnter, fenceOnEnter, splitItem),
      ArrowUp: cellUp,
      ArrowDown: cellDown,
      ArrowLeft: cellLeft,
      ArrowRight: cellRight,
      "Mod-ArrowLeft": cellStart,
      "Mod-ArrowRight": cellEnd,
      // 行内の装飾。付けるだけでなく外せるようにする。
      "Mod-b": toggleInline(schema.marks.strong),
      "Mod-i": toggleInline(schema.marks.em),
      "Shift-Mod-x": toggleInline(schema.marks.strike),
      "Shift-Mod-c": toggleInline(schema.marks.code),
      "Shift-Enter": lineBreak,
      "Mod-Enter": lineBreak,
      "Shift-Mod-Enter": lineBreak,
      // コードの塊の中は字下げ。表の中では隣のセルへ。それ以外は箇条書きの字下げ。
      Tab: chainCommands(indentCode, goToNextCell(1), sinkListItem(item)),
      "Shift-Tab": chainCommands(outdentCode, goToNextCell(-1), liftListItem(item)),
    }),
    keymap(baseKeymap),
    // 打った字が継ぐ装飾の直し。入力変換より後に置き、規則が控えを触ったあとの
    // 組み合わせを見る。
    keepNesting,
    // セルの選択と、いま触っているセルの印。
    tableEditing(),
    focusedCell,
    // コードの色と、カーソルの居る塊の印（図だけを出しているときに使う）。
    highlightCode,
    insideBlock,
  ];
}
