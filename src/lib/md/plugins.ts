import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { Plugin, type Command } from "prosemirror-state";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import type { Transform } from "prosemirror-transform";
import { highlightCode } from "./highlight";
import { rules } from "./inputRules";
import { insideBlock } from "./nodeViews";
import { schema } from "./schema";
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

export function editorPlugins({ onSave }: { onSave: () => void }): Plugin[] {
  const item = schema.nodes.listItem;
  const typed = inputRules({ rules });
  const kept = rememberRule(typed);

  return [
    history(),
    typed,
    kept,
    keymap({
      // 変換した直後に打ち消せないと、記号そのものを書けなくなる。
      Backspace: undoRule(kept),
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
      "Shift-Enter": lineBreak,
      "Mod-Enter": lineBreak,
      "Shift-Mod-Enter": lineBreak,
      // 表の中では隣のセルへ。そうでなければ箇条書きの字下げ。
      Tab: chainCommands(goToNextCell(1), sinkListItem(item)),
      "Shift-Tab": chainCommands(goToNextCell(-1), liftListItem(item)),
    }),
    keymap(baseKeymap),
    // セルの選択と、いま触っているセルの印。
    tableEditing(),
    focusedCell,
    // コードの色と、カーソルの居る塊の印（図だけを出しているときに使う）。
    highlightCode,
    insideBlock,
  ];
}
