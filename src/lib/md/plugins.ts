import { baseKeymap, chainCommands, lift } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  Fragment,
  Slice,
  type Mark,
  type Node as PmNode,
  type ResolvedPos,
} from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import {
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import { canJoin, type Transform } from "prosemirror-transform";
import { fromMarkdown } from "./fromMarkdown";
import { highlightCode } from "./highlight";
import { rules } from "./inputRules";
import { anchors } from "./anchors";
import { emojiMenu } from "./emoji";
import { editingMark } from "./editing";
import { imageDrops, type ImageGoes } from "./imageDrop";
import { imagePicker } from "./imagePick";
import { mathEditing } from "./math";
import { inCell, setLink, toggleInline } from "./marks";
import { lifted } from "./lifted";
import { composingKeys } from "./ime";
import { insideBlock, loneImages } from "./nodeViews";
import { DETAILS_HEAD, nestOf, schema } from "./schema";
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
  if (dispatch) {
    const node = inCell(state)
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
export const splitItem: Command = (state, dispatch, view) => {
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

// ⌘⏎。タスクの項目の中ならチェックを入れ替える。
//
// 手を離してチェックを押しにいかなくても、書きながら済みにできる。タスクで
// なければ何もしない（行の中の改行に譲る）。
export const toggleTask: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type !== schema.nodes.listItem) continue;
    const checked = node.attrs.checked as boolean | null;
    if (checked === null) return false;
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup($from.before(d), undefined, {
          ...node.attrs,
          checked: !checked,
        }),
      );
    }
    return true;
  }
  return false;
};

// ⌘⌫。コードの塊の中では行の頭までを消す。
//
// 既定の動作に任せると、塊の中では DOM だけが書き換わって編集モデルとずれる。
// 消したあとカーソルが行の端まで来ず、押しても塊へ入れ直せなくなる（塊の頭に
// 触れない札を置いているので、WebKit の行削除がそこをまたいで働く）。
//
// 塊の中の改行は字として持っているので、直前の改行の後ろまでを消せばよい。
export const eraseToLineStart: Command = (state, dispatch) => {
  const { empty, $head } = state.selection;
  if (!empty || $head.parent.type !== schema.nodes.codeBlock) return false;
  const before = $head.parent.textBetween(0, $head.parentOffset);
  const from = $head.start() + before.lastIndexOf("\n") + 1;
  // 行の頭に居るなら消すものが無い。塊に中身が残っているなら、それでも
  // 既定へは渡さない（渡すと上と同じずれが起きる）。空の塊は消す番へ譲る。
  if (from >= $head.pos) return $head.parent.content.size > 0;
  if (dispatch) {
    dispatch(state.tr.delete(from, $head.pos).scrollIntoView());
  }
  return true;
};

// 中身の無いブロックの先頭で Backspace。そのブロックを消す。
//
// 既定（joinBackward）は直前が囲みだと、その最後の子として今のブロックを
// 差し込む。中身のあるブロックを前の行へ継ぐのは正しいが、空のブロックが
// 囲みへ潜っても意味が無い。空の塊が callout の中へ入り、空の callout が
// 箇条書きの項目に化けていたのはこれ。
const HOLDERS = new Set([
  schema.nodes.callout,
  schema.nodes.details,
  schema.nodes.blockquote,
]);

// 空の行を消して並びどうしが隣り合ったら、一つに繋ぐ。
//
// 項目から飾りを外すと（unlistBack）、その行を境に箇条書きが二つに割れる。
// 行を消せば隣り合うが、節点は二つのままで、原文では間に空行が入る。
// CommonMark はそこに空行があっても一つの並びとして読み直すので、開き直すと
// 繋がっている——書いている間だけ区切られて見える、という食い違いになる。
//
// 繋ぐのは並びどうしだけ。段落まで繋ぐと、別々だった文が一続きになる。
const LISTS = new Set([schema.nodes.bulletList, schema.nodes.orderedList]);

function joinLists(tr: Transaction, at: number): void {
  const $at = tr.doc.resolve(at);
  const before = $at.nodeBefore;
  const after = $at.nodeAfter;
  if (!before || !after || before.type !== after.type) return;
  if (!LISTS.has(before.type) || !canJoin(tr.doc, at)) return;
  tr.join(at);
}

export const dropEmptyBack: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  if ($from.parentOffset !== 0 || $from.parent.content.size > 0) return false;

  let from = $from.before();
  let to = $from.after();
  const holder = $from.depth > 0 ? $from.node(-1) : null;
  // トグルは題と中身で組むので、中身を空にはできない。題へ移る番に譲る。
  if (holder?.type === schema.nodes.details && holder.childCount === 2) return false;
  // 囲みの唯一の子なら囲みごと消す。中身が無いので失うものがない。
  if (holder && HOLDERS.has(holder.type) && holder.childCount === 1) {
    from = $from.before(-1);
    to = $from.after(-1);
  }
  // 文書にこれしか無いなら、消すと空の文書になる。何もしない。
  if (from === 0 && to === state.doc.content.size) return false;

  if (dispatch) {
    const tr = state.tr.delete(from, to);
    joinLists(tr, from);
    // 直前のブロックの末尾へ。前に何も無ければ後ろへ送る（near が向きを見る）。
    const at = Selection.near(tr.doc.resolve(Math.max(0, from - 1)), -1);
    dispatch(tr.setSelection(at).scrollIntoView());
  }
  return true;
};

// 並びの中で、いちばん後ろにある字の塊の末尾。入れ子があればその奥まで見る。
function lastTextEnd(list: PmNode, listStart: number): number | null {
  let end: number | null = null;
  list.descendants((node, pos) => {
    if (node.isTextblock) end = listStart + 1 + pos + 1 + node.content.size;
    return true;
  });
  return end;
}

// 箇条書きの直後にある、中身のある行の先頭で Backspace。前の項目の末尾へ継ぐ。
//
// 項目の先頭で押すと、まず飾りが外れてその場に段落が残る（unlistBack）。
// もう一度押したときの行き先がここ。素の joinBackward は段落を項目として
// 並びへ差し戻すだけなので、押すたびに外れる・戻るを往復して、前の行の末尾に
// つなぐ道がどこにも無かった。
//
// 継いだあとは、割れていた並びを一つに戻す（joinLists）。原文に空行が残ると、
// 開き直したときだけ一つに見えるという食い違いになる。
export const joinItemBack: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
  // 空の行は消す番（dropEmptyBack）に譲る。
  if ($from.parent.content.size === 0) return false;
  if ($from.depth < 1) return false;

  const depth = $from.depth - 1;
  const index = $from.index(depth);
  if (index === 0) return false;
  const before = $from.node(depth).child(index - 1);
  if (!LISTS.has(before.type)) return false;

  const from = $from.before();
  const at = lastTextEnd(before, from - before.nodeSize);
  if (at === null) return false;

  if (dispatch) {
    const block = $from.parent;
    const tr = state.tr.delete(from, $from.after());
    // 継ぎ先は消したところより前なので、位置はずれない。
    tr.insert(at, block.content);
    joinLists(tr, tr.mapping.map(from));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at)).scrollIntoView());
  }
  return true;
};

// ---- トグルの中の行き来 ----
//
// トグルは「題」と「中身」の 2 段でできている。どちらも本文の節点なので、
// 押す・矢印・選ぶは既定のまま動く。決めておくのは次の行き先だけ。
//
//   畳んだ題で Enter       … 次のトグルを作り、その題へ
//   開いた題で Enter       … 中身の先頭に行を足して、そこへ
//   題の頭で Backspace     … 見出しトグルなら素のトグルへ。素なら囲みを解く
//   中身の先頭で Backspace … その塊を囲みの外（直後）へ出す。囲みは残る
//   空の行で Backspace     … その行を囲みの外（直後）へ出す。囲みは残る
//   空の中身で Backspace   … 題へ（頭に置く。題を後ろから食べない）
//   空の中身で Enter       … 囲みの外（直後）の行へ出る。囲みは残る
//
// 外へ出る道は Backspace で一本に通してある。空の行で押せば外の行へ出て、
// 中身が空になれば題へ、題でもう一度押せば囲みが解ける。
//
// 「囲みは残る」を通している。題の字は書いたものなので、中身が空になった
// くらいで消さない。畳んだまま中身へ入れないのも同じ考えで、見えない場所へ
// カーソルを置かない。

// 空になったトグルの中で Enter。囲みは残し、その下の行へ出る。
export const outEnter: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.content.size > 0) return false;
  if ($from.depth < 2) return false;
  const depth = $from.depth - 1;
  const holder = $from.node(depth);
  // 題（1 つ目）＋空の中身（2 つ目）だけのとき。
  if (holder.type !== schema.nodes.details || holder.childCount !== 2) return false;

  if (dispatch) {
    const after = $from.after(depth);
    const next = state.doc.resolve(after).nodeAfter;
    // すぐ下が空の行なら、そこへ移るだけ（空行を積み増さない）。
    const tr =
      next?.isTextblock && next.content.size === 0
        ? state.tr
        : state.tr.insert(after, schema.nodes.paragraph.create());
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1)).scrollIntoView(),
    );
  }
  return true;
};

// トグルの中の空の行で Backspace。その行を囲みの外（直後）へ出す。
//
// 既定（と dropEmptyBack）は空の行を消して前の行の末尾へ戻すので、何度押しても
// 中に留まったままになる。空の行は「ここから書き続けたい」の印なので、字下げを
// 一段解く方に寄せる。
//
// 題のすぐ下 1 つだけのときは譲る。そちらは題へ移る番で、トグルは残す。
export const outOfDetailsBack: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  if ($from.parentOffset !== 0 || $from.parent.content.size > 0) return false;
  if ($from.depth < 2) return false;
  const depth = $from.depth - 1;
  const box = $from.node(depth);
  if (box.type !== schema.nodes.details || box.childCount <= 2) return false;
  // 題そのものは対象外（題は空でも消さない）。
  if ($from.index(depth) < 1) return false;

  if (dispatch) {
    const end = $from.after(depth);
    const tr = state.tr.delete($from.before(), $from.after());
    const at = tr.mapping.map(end);
    tr.insert(at, schema.nodes.paragraph.create());
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1), 1)).scrollIntoView(),
    );
  }
  return true;
};

// 空になったトグルの中で Backspace。囲みは消さず、見出しへ移る。
//
// 中身が無くなってもトグルは残す（見出しの字は書いたもの）。続けて押したときの
// 行き先は、その見出しの入力欄。ここから題を直せる。
export const toDetailsHead: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
  if ($from.parent.content.size > 0 || $from.depth < 2) return false;
  const depth = $from.depth - 1;
  if ($from.node(depth).type !== schema.nodes.details) return false;
  // 中身の先頭（題のすぐ下）に居るときだけ。
  if ($from.index(depth) !== 1) return false;
  if (dispatch) {
    const title = $from.before();
    dispatch(
      state.tr
        .setSelection(TextSelection.near(state.doc.resolve(title - 1), -1))
        .scrollIntoView(),
    );
  }
  return true;
};

// トグルの題で Enter。題は割らない。行き先は畳み方で分ける。
//
// 畳んでいるときに中身へ入れると、中身は隠れているのでカーソルが消えたように
// 見える。畳んだまま続けて書きたいのは「次のトグル」なので、そちらを作る。
export const outOfDetailsHead: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  if ($from.parent.type !== schema.nodes.detailsSummary) return false;
  const depth = $from.depth - 1;
  const box = $from.node(depth);
  if (box.type !== schema.nodes.details) return false;

  if (closedAt(view, $from.before(depth))) {
    if (dispatch) {
      const after = $from.after(depth);
      const tr = state.tr.insert(after, newDetails());
      dispatch(
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 2), 1)).scrollIntoView(),
      );
    }
    return true;
  }

  if (dispatch) {
    const head = $from.after();
    const first = state.doc.resolve(head).nodeAfter;
    // 先頭が既に空の行なら、足さずにそこへ入る（空行を積み増さない）。
    const tr =
      first?.isTextblock && first.content.size === 0
        ? state.tr
        : state.tr.insert(head, schema.nodes.paragraph.create());
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(head + 1), 1)).scrollIntoView(),
    );
  }
  return true;
};

// 題と空の中身だけの新しいトグル。
const newDetails = () =>
  schema.nodes.details.create({ head: DETAILS_HEAD }, [
    schema.nodes.detailsSummary.create(),
    schema.nodes.paragraph.create(),
  ]);

// そのトグルが畳まれているか。開閉は描いている側（nodeView）が持っているので、
// 出ている結果をそのまま読む。
function closedAt(view: EditorView | undefined, at: number): boolean {
  const dom = view?.nodeDOM(at);
  return dom instanceof HTMLElement && dom.classList.contains("is-closed");
}

// トグルの題の頭で Backspace。見出しトグルなら段を外し、素のトグルなら囲みを
// 解く。題は段落として残し、中身はその後ろへ並べる（書いた字を失わない）。
export const plainDetailsHead: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const title = $from.parent;
  if (title.type !== schema.nodes.detailsSummary) return false;

  if (title.attrs.level !== null) {
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup($from.before(), undefined, { level: null }));
    }
    return true;
  }

  if (dispatch) {
    const depth = $from.depth - 1;
    const box = $from.node(depth);
    const start = $from.before(depth);
    const body: PmNode[] = [];
    box.forEach((child, _offset, index) => {
      if (index > 0) body.push(child);
    });
    // 中身が空の段落 1 つだけなら、題だけを残す（空の行を積み増さない）。
    const kept = body.filter(
      (node) => !(node.isTextblock && node.content.size === 0) || body.length > 1,
    );
    const tr = state.tr.replaceWith(start, $from.after(depth), [
      schema.nodes.paragraph.create(null, title.content),
      ...kept,
    ]);
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1), 1)).scrollIntoView(),
    );
  }
  return true;
};

// トグルの中身の先頭で Backspace。その塊を囲みの外へ出す。
//
// 既定（joinBackward）は囲みごと畳んでしまい、トグルでは見出し（<summary> の
// 字）まで消える。中身が 2 つ以上あるときは手前の塊に継がれるだけで、字下げは
// 解けない。どちらも「外へ出したい」という操作に応えていないので、自分で出す。
//
// 引用や callout は触らない。畳まれても失うものが無く、Markdown としても
// 自然な畳み方になる。
export const outdentBack: Command = (state, dispatch, view) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
  if ($from.depth < 2) return false;
  const depth = $from.depth - 1;
  const holder = $from.node(depth);
  if (!HOLDERS.has(holder.type)) return false;
  // トグルは先頭の子が題なので、中身の先頭は 1 つ目。
  const first = holder.type === schema.nodes.details ? 1 : 0;
  // それより後ろの塊は、同じ囲みの中で手前の塊へ継ぐのが正しい。
  if ($from.index(depth) !== first) return false;

  // 引用と callout は、囲みが先頭に居るなら既定に任せる（塊が外へ出て囲みが
  // 畳まれる、Markdown として自然な形）。手前に別の塊があるときだけ自分で
  // 出す。既定はそのとき、囲みを丸ごと手前の項目の中へ押し込んでしまう。
  if (holder.type !== schema.nodes.details) {
    if ($from.index(depth - 1) === 0) return false;
    return lift(state, dispatch, view);
  }

  if (dispatch) {
    const block = $from.parent;
    const start = $from.before(depth);
    const end = $from.after(depth);
    const tr = state.tr;
    let at: number;
    if (holder.childCount === 1) {
      // 中身が空になる。空の段落を 1 つ残して、見出しごと囲みを保つ。
      const kept = holder.type.create(holder.attrs, schema.nodes.paragraph.create());
      tr.replaceWith(start, end, [kept, block]);
      at = start + kept.nodeSize;
    } else {
      tr.delete($from.before(), $from.after());
      at = tr.mapping.map(end);
      tr.insert(at, block);
    }
    dispatch(
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1), 1)).scrollIntoView(),
    );
  }
  return true;
};

// 表のセルを 3 回押したら、そのセルの字を全部選ぶ。
//
// prosemirror-tables は 3 回目でセルの塊ごと選ぶ（CellSelection）ので、
// 字を打ち直したりコピーしたりができない。文章の上では「段落を選ぶ」のが
// OS の作法なので、そちらへ寄せる。
const cellTripleClick = new Plugin({
  props: {
    handleTripleClick(view, pos) {
      const $at = view.state.doc.resolve(pos);
      for (let d = $at.depth; d > 0; d--) {
        if ($at.node(d).type !== schema.nodes.tableCell) continue;
        const from = $at.start(d);
        const to = $at.end(d);
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.between(view.state.doc.resolve(from), view.state.doc.resolve(to)),
          ),
        );
        return true;
      }
      return false;
    },
  },
});

// 囲みの後ろの塊の先頭で Backspace。囲みの中へ引きずり込まない。
//
// 既定（joinBackward）は手前が囲みだと、その最後の子として今の塊を差し込む。
// 書いている人からは「外に置いたはずの段落がトグルの中へ吸い込まれる」ように
// 見える。ここでは文書を変えず、直前の字の末尾へ寄せるだけにする（続けて
// 押せば、そこから 1 字ずつ消える）。
export const keepOutOfHolder: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
  // 空の塊は消す番（dropEmptyBack）に譲る。
  if ($from.parent.content.size === 0) return false;
  if ($from.depth < 1) return false;
  const depth = $from.depth - 1;
  const index = $from.index(depth);
  if (index === 0) return false;
  if (!HOLDERS.has($from.node(depth).child(index - 1).type)) return false;
  if (dispatch) {
    const at = Selection.near(state.doc.resolve($from.before() - 1), -1);
    dispatch(state.tr.setSelection(at).scrollIntoView());
  }
  return true;
};

// 項目の先頭で Backspace。飾りを外して 1 段浅くする。いちばん外なら
// 箇条書きを抜けて段落に戻る。
//
// 素の joinBackward は手前の項目へ中身を継ぎ足すので、消したいのが点や番号
// だけのときに前の行と文がつながってしまう。
export const unlistBack: Command = (state, dispatch, view) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  if ($from.depth < 2 || $from.node(-1).type !== schema.nodes.listItem) return false;
  // 項目の最初のブロックにいるときだけ。2 つ目以降の段落は、同じ項目の中で
  // 手前の段落へ継ぐのが正しい。
  if ($from.index(-1) !== 0) return false;
  return liftListItem(schema.nodes.listItem)(state, dispatch, view);
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

// 消した 1 文字の分だけ後ろへ戻る位置。絵文字や結合文字は複数の符号単位で
// 1 文字なので、区切りを引いて末尾のひと塊を測る。
function lastUnit(text: string): number {
  const parts = [...new Intl.Segmenter().segment(text)];
  return parts.length ? parts[parts.length - 1].segment.length : 1;
}

// 装飾の範囲の末尾で Backspace。消した字と同じ装飾を控える。
//
// 行内コードは囲みの直後で打った字を中に入れない（schema の inclusive: false）。
// そのままでは、打ち間違いを消して打ち直したときに囲みの外へ出てしまう。消した
// 字の装飾を控えておけば、打ち直しは元と同じ囲みの中へ入る。
const eraseInMark: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.textOffset || !$from.parent.inlineContent) return false;
  const before = $from.nodeBefore;
  if (!before?.isText) return false;
  // 既定で継ぐ装飾が消した字と同じなら、ブラウザの削除に任せる。
  const marks = $from.marks();
  if (before.marks.every((m) => m.isInSet(marks))) return false;
  if (dispatch) {
    const back = lastUnit(before.text ?? "");
    const tr = state.tr.delete($from.pos - back, $from.pos);
    dispatch(tr.ensureMarks(before.marks).scrollIntoView());
  }
  return true;
};

// 行の頭に置かれた Backspace の始末。飾りを外す・空の行を消す・手前へ継ぐ、を
// 順に試す。どれも「行の頭に居ること」を条件にしているので、並べる順は
// 互いに干渉しない。
const backAtHead: Command[] = [
  toSourceBack,
  unlistBack,
  plainDetailsHead,
  toDetailsHead,
  outOfDetailsBack,
  dropEmptyBack,
  joinItemBack,
  outdentBack,
  keepOutOfHolder,
];

// ⌘⌫。行の頭までを消す。
//
// 行の頭に居るなら、前に消すものはもう無い。そこで素の Backspace と同じ
// 後片付けへ進む。ここを配らないと、字を消して空になった項目に点だけが残り、
// 押すたびに積み上がる（ブラウザの行削除は字を消すだけで、項目には触れない）。
export const eraseLineBack: Command = chainCommands(eraseToLineStart, ...backAtHead);

// 行内の装飾を付け外しする。
//
// 記号を画面に出さないモードでは、入力変換で付けることはできても外す道が無い。
// 選んでいなければ、カーソルの居る装飾の範囲まるごとを外す（`code` の囲みを
// 消したいときに、いちいち選ばせない）。

// カーソルの居る装飾の範囲。隣り合っていれば、原文で分かれて書かれていても
// 1 つの範囲として返す。続いている装飾を 1 回で外せる。
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

// 貼り付けた字が URL 1 本ならその行き先。そうでなければ null。
//
// 選んだ字の上に URL を貼るのは「ここをここへ繋ぎたい」という操作なので、
// 字を URL で置き換えるのではなくリンクにする。
const LINK = /^(https?:\/\/|mailto:)\S+$/;

export function pastedLink(text: string): string | null {
  const one = text.trim();
  return LINK.test(one) ? one : null;
}

// 選んだ字の上に URL を貼ったとき、その字をリンクにする。
export const linkOnPaste =
  (text: string): Command =>
  (state, dispatch) => {
    if (state.selection.empty) return false;
    // コードの中は文字のまま入れる。
    if (state.selection.$from.parent.type.spec.code) return false;
    const href = pastedLink(text);
    return href ? setLink(href)(state, dispatch) : false;
  };

// 貼り付けたものを、貼り先の項目に合わせる。
//
// TODO の中に素の箇条書きを貼ると、チェックと点が混ざって階層が読めなくなる。
// 貼り先がタスクなら貼る側にも印を付け、素の項目なら印を外す。階層はそのまま。
function sameMark(node: PmNode, checked: boolean | null): PmNode {
  const item = node.type === schema.nodes.listItem;
  if (node.isText || !node.content.size) {
    return item ? node.type.create({ ...node.attrs, checked }, node.content, node.marks) : node;
  }
  const kids: PmNode[] = [];
  node.forEach((child) => kids.push(sameMark(child, checked)));
  const content = Fragment.fromArray(kids);
  return item
    ? node.type.create({ ...node.attrs, checked }, content, node.marks)
    : node.copy(content);
}

// カーソルの居る項目の印。項目の外なら undefined。
function markAt($at: ResolvedPos): boolean | null | undefined {
  for (let d = $at.depth; d > 0; d--) {
    if ($at.node(d).type === schema.nodes.listItem) {
      return $at.node(d).attrs.checked as boolean | null;
    }
  }
  return undefined;
}

const pasteInto = new Plugin({
  props: {
    transformPasted(slice, view) {
      const checked = markAt(view.state.selection.$from);
      if (checked === undefined) return slice;
      const kids: PmNode[] = [];
      slice.content.forEach((child) => kids.push(sameMark(child, checked)));
      return new Slice(Fragment.fromArray(kids), slice.openStart, slice.openEnd);
    },
  },
});

// 編集面のリンクを押したときの行き先。
//
// 何も手当てしないと、素の <a> のまま窓の既定の遷移に落ちる（読む面には手当てが
// あるのに、編集面には無かった）。押下をここで受け、読む面と同じ振り分けをする。
//
// ⌥ を押しながらのときは触らない。リンクの中へ字を置きたいときの逃げ道。
export interface LinkGoes {
  // 外（http / mailto / tel）。
  out: (href: string) => void;
  // 同じ文書の節へ。
  anchor: (id: string) => void;
  // 別のファイルへ。
  file: (href: string) => void;
}

export const linkClicks = (goes: LinkGoes): Plugin =>
  new Plugin({
    // 押下は DOM で受ける。prosemirror の handleClickOn は、押し下げから
    // 離すまでの組と位置の解決が揃ったときにしか呼ばれない（本物の押下を
    // 投げても走らないことを試験で確かめた）。リンクは字の上を押した時点で
    // 窓が遷移を始めるので、そこへ間に合う口で受ける。
    view(view) {
      const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
        const target = event.target;
        const el = target instanceof Element ? target.closest("a[href]") : null;
        if (!el || !view.dom.contains(el)) return;
        const href = el.getAttribute("href") ?? "";
        if (!href) return;
        event.preventDefault();
        event.stopPropagation();
        if (/^(https?:|mailto:|tel:)/.test(href)) goes.out(href);
        else if (href.startsWith("#")) goes.anchor(href.slice(1));
        else goes.file(href);
      };
      view.dom.addEventListener("click", onClick, true);
      return {
        destroy: () => view.dom.removeEventListener("click", onClick, true),
      };
    },
  });

const pasteMarkdown = new Plugin({
  props: {
    handlePaste(view, event) {
      const data = event.clipboardData;
      if (!data) return false;
      // 書式の有無より先に見る。ブラウザから複写した URL は書式も一緒に
      // 載ってくるので、後ろに置くと素通りしてしまう。
      if (linkOnPaste(data.getData("text/plain"))(view.state, view.dispatch)) return true;
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

// 差分から作られた打鍵は、手に渡さない。
//
// prosemirror-view は本文と DOM の差分を読んで「これは Enter を押した形だ」と
// 見たとき、Enter の手を流し直す（readDOMChange）。WebKit は変換を確定する
// とき、変換中の字をいったん消してから確定した字を入れ直すので、その「消す」
// 側の差分がちょうど Enter の形に見える。流し直された Enter が走ると、
//
//   - 見出しの中なら後ろに段落ができ、確定した字がそちらへ移る（見出しが
//     素の文に戻ったように見える）
//   - タスクの項目なら項目が割れ、新しい項目は印を持たない（TODO がただの
//     箇条書きに戻る）
//   - 変換中の字が本文から外れ、確定の分と合わせて同じ文が二重に残る
//
// 流し直された打鍵は document.createEvent で組まれた素の Event で、本物の
// 打鍵（KeyboardEvent）ではない。そこで見分ける。
//
// 変換の最中も同じく渡さない。止めるのは差分から作られた分だけで、止めれば
// 本文は差分どおりに直る（その差分が壊れないよう、読み取りを束ねるのは
// ime.ts の側でやっている）。
const realKeys = (map: Record<string, Command>): Plugin => {
  const inner = keymap(map);
  const handle = inner.props.handleKeyDown;
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (view.composing || !(event instanceof KeyboardEvent)) return false;
        return handle?.call(inner, view, event) ?? false;
      },
    },
  });
};

export function editorPlugins({
  onSave,
  links,
  images,
}: {
  onSave: () => void;
  // リンクを押したときの行き先。渡さなければ押下は素通り（試験など）。
  links?: LinkGoes;
  // 持ち込まれた画像の取り込み先。渡さなければ落とす・貼るは素通り。
  images?: ImageGoes;
}): Plugin[] {
  const item = schema.nodes.listItem;
  const typed = inputRules({ rules });
  const kept = rememberRule(typed);

  return [
    history(),
    ...(links ? [linkClicks(links)] : []),
    // 画像の持ち込みは、字としての貼り付けより先に見る。
    ...(images ? [imageDrops(images), imagePicker(images)] : []),
    pasteMarkdown,
    // 貼ったものの印を、貼り先の項目にそろえる。
    pasteInto,
    typed,
    kept,
    // 段落の先頭の "/" から構造を選ぶ。矢印と Enter を先に取るので keymap より前。
    slashMenu,
    // ":" から絵文字を選ぶ。同じく矢印と Enter を先に取る。
    emojiMenu,
    mathEditing,
    editingMark,
    realKeys({
      // 変換した直後に打ち消せないと、記号そのものを書けなくなる。
      // 打った直後でなくても、ブロックの先頭からは記号へ戻せるようにする。
      // 項目の先頭では飾りを外し、装飾の末尾で消したときは打ち直しが同じ
      // 装飾へ入るようにする。
      Backspace: chainCommands(undoRule(kept), eraseInMark, ...backAtHead),
      Delete: toSourceForward,
      "Mod-s": () => {
        onSave();
        return true;
      },
      "Mod-Backspace": eraseLineBack,
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      Enter: chainCommands(cellEnter, outOfDetailsHead, fenceOnEnter, outEnter, splitItem),
      ArrowUp: cellUp,
      ArrowDown: cellDown,
      ArrowLeft: cellLeft,
      ArrowRight: cellRight,
      "Mod-ArrowLeft": cellStart,
      "Mod-ArrowRight": cellEnd,
      // 行内の装飾。付けるだけでなく外せるようにする。
      "Mod-b": toggleInline(schema.marks.strong),
      "Mod-i": toggleInline(schema.marks.em),
      "Mod-u": toggleInline(schema.marks.underline),
      "Shift-Mod-x": toggleInline(schema.marks.strike),
      "Shift-Mod-c": toggleInline(schema.marks.code),
      "Shift-Enter": lineBreak,
      "Mod-Enter": chainCommands(toggleTask, lineBreak),
      "Shift-Mod-Enter": lineBreak,
      // コードの塊の中は字下げ。表の中では隣のセルへ。それ以外は箇条書きの字下げ。
      Tab: chainCommands(indentCode, goToNextCell(1), sinkListItem(item)),
      "Shift-Tab": chainCommands(outdentCode, goToNextCell(-1), liftListItem(item)),
    }),
    realKeys(baseKeymap),
    // 打った字が継ぐ装飾の直し。入力変換より後に置き、規則が控えを触ったあとの
    // 組み合わせを見る。
    keepNesting,
    // セルを 3 回押したら、そのセルの字を選ぶ。tableEditing より前に置く
    // （後ろだと、セルの塊ごと選ぶ既定に取られる）。
    cellTripleClick,
    // セルの選択と、いま触っているセルの印。
    tableEditing(),
    focusedCell,
    // コードの色と、カーソルの居る塊の印（図だけを出しているときに使う）。
    highlightCode,
    insideBlock,
    loneImages,
    // 掴んでいるあいだ実体を薄くする印。
    lifted,
    // 指摘の居場所。打っても付いてくるように、位置を写していく。
    anchors,
    // 変換を確定した直後の打鍵を、編集面へ渡す。
    composingKeys(),
  ];
}
