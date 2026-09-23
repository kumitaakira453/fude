import type { MarkType, ResolvedPos } from "prosemirror-model";
import { toggleMark } from "prosemirror-commands";
import type { Command, EditorState } from "prosemirror-state";
import { schema } from "./schema";
import { SLASH_ITEMS, type SlashItem } from "./slash";

// 装飾（太字・斜体・下線・打ち消し・行内コード・リンク）の付け外しと、
// いま何が付いているかの問い合わせ。
//
// 打鍵（keymap）と、選んだときに出す帯の両方から呼ぶ。どちらから触っても
// 同じ振る舞いになるように 1 か所に置く。

// カーソルが居る「ひと続きの装飾」の範囲。
//
// 範囲を選んでいないときに囲みを外すために使う。末尾も範囲に含めるので、
// 囲みの終わりに居るときもその囲みを外せる。
function markRun(
  $pos: ResolvedPos,
  type: MarkType,
): { from: number; to: number } | null {
  const parts: { from: number; to: number; on: boolean }[] = [];
  let at = $pos.start();
  $pos.parent.forEach((child) => {
    parts.push({ from: at, to: at + child.nodeSize, on: !!type.isInSet(child.marks) });
    at += child.nodeSize;
  });

  const hit = parts.findIndex((p) => p.on && $pos.pos > p.from && $pos.pos <= p.to);
  if (hit < 0) return null;
  let head = hit;
  let tail = hit;
  while (head > 0 && parts[head - 1].on) head--;
  while (tail < parts.length - 1 && parts[tail + 1].on) tail++;
  return { from: parts[head].from, to: parts[tail].to };
}

export function toggleInline(type: MarkType): Command {
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
    // 一部にしか付いていない範囲は、外すのではなく全部に付ける。既定は
    // 「どこかに付いていれば外す」で、囲みと囲みの外を一緒に選んで付け直す
    // ときに、選んだところが丸ごと素に戻ってしまう。
    return toggleMark(type, null, { removeWhenPresent: false })(state, dispatch, view);
  };
}

// いま付いているか。帯のボタンを押し込んで見せるのに使う。
//
// 範囲を選んでいるときは「丸ごと付いている」を付いていると見る（一部だけの
// ときに押し込んで見せると、押しても外れずに増えるので操作と合わない）。
export function markedWith(state: EditorState, type: MarkType): boolean {
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    const stored = state.storedMarks ?? $from.marks();
    return !!type.isInSet(stored);
  }
  return state.doc.rangeHasMark(from, to, type) && whole(state, type);
}

// 範囲のすべての文字に付いているか。
function whole(state: EditorState, type: MarkType): boolean {
  const { from, to } = state.selection;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!all) return false;
    if (!node.isText) return true;
    if (!type.isInSet(node.marks)) all = false;
    return false;
  });
  return all;
}

// 選んだところに付いているリンクの行き先。無ければ null。
export function linkAt(state: EditorState): string | null {
  const { from, to, empty, $from } = state.selection;
  const type = schema.marks.link;
  if (empty) {
    const mark = type.isInSet(state.storedMarks ?? $from.marks());
    return mark ? ((mark.attrs.href as string) ?? "") : null;
  }
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (href !== null || !node.isText) return href === null;
    const mark = type.isInSet(node.marks);
    if (mark) href = (mark.attrs.href as string) ?? "";
    return false;
  });
  return href;
}

// その位置にあるリンクの範囲と行き先。無ければ null。
//
// 押した / 指した先から辿るのに使う（帯は選んだ範囲を相手にするが、こちらは
// リンクそのものを相手にする）。
export function linkSpanAt(
  state: EditorState,
  pos: number,
): { from: number; to: number; href: string } | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const type = schema.marks.link;
  const run = markRun(state.doc.resolve(pos), type);
  if (!run) return null;
  const mark = type.isInSet(state.doc.nodeAt(run.from)?.marks ?? []);
  return mark ? { ...run, href: (mark.attrs.href as string) ?? "" } : null;
}

// その範囲のリンクを張り替える。行き先が空ならリンクを外す。
export function relink(span: { from: number; to: number }, href: string): Command {
  return (state, dispatch) => {
    if (span.to <= span.from) return false;
    if (dispatch) {
      const type = schema.marks.link;
      const tr = state.tr.removeMark(span.from, span.to, type);
      if (href) tr.addMark(span.from, span.to, type.create({ href, title: null }));
      dispatch(tr);
    }
    return true;
  };
}

// リンクを張り直す。範囲が空なら何もしない（張る先の文字が無い）。
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty || !href) return false;
    if (dispatch) {
      const type = schema.marks.link;
      dispatch(
        state.tr
          .removeMark(from, to, type)
          .addMark(from, to, type.create({ href, title: null })),
      );
    }
    return true;
  };
}

export const clearLink: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const type = schema.marks.link;
  if (empty) {
    const run = markRun(state.selection.$from, type);
    if (!run) return false;
    if (dispatch) dispatch(state.tr.removeMark(run.from, run.to, type));
    return true;
  }
  if (!state.doc.rangeHasMark(from, to, type)) return false;
  if (dispatch) dispatch(state.tr.removeMark(from, to, type));
  return true;
};

// 選んだところの装飾を全部落とす。
//
// 何がどう重なっているかを見ずに素へ戻せる道。1 つずつ外すと、囲みと強調が
// 重なったところで押す順序によって残りが変わる。
const ALL_MARKS = Object.values(schema.marks);

export const clearMarks: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) {
    // カーソルだけのときは、これから打つ字が継ぐ装飾を落とす。
    if (!(state.storedMarks ?? state.selection.$from.marks()).length) return false;
    if (dispatch) dispatch(state.tr.setStoredMarks([]));
    return true;
  }
  if (!ALL_MARKS.some((type) => state.doc.rangeHasMark(from, to, type))) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const type of ALL_MARKS) tr.removeMark(from, to, type);
    dispatch(tr);
  }
  return true;
};

// 選んだところが式ひとつなら、その中身。無ければ null。
//
// 式の上を選んで押し直したときに、打ち直しとして開けるようにする。
export function mathAt(state: EditorState): string | null {
  const { from, to } = state.selection;
  const node = state.doc.nodeAt(from);
  if (!node || node.type !== schema.nodes.inlineMath) return null;
  return from + node.nodeSize === to ? (node.attrs.tex as string) : null;
}

// 選んだところを式にする。中身が空なら何もしない。
export function setMath(tex: string): Command {
  return (state, dispatch) => {
    const { empty } = state.selection;
    if (empty || !tex.trim()) return false;
    if (dispatch) {
      // 装飾は継がせない。式を太字にしても組み方は変わらないのに、原文には
      // 記号が残る。
      dispatch(
        state.tr.replaceSelectionWith(
          schema.nodes.inlineMath.create({ tex, raw: null }),
          false,
        ),
      );
    }
    return true;
  };
}

// 表のセルの中か。セルは行内しか持てないので、ブロックの種別を変える入口は
// ここでは出さない。
export function inCell(state: EditorState): boolean {
  const $at = state.selection.$from;
  for (let depth = $at.depth; depth > 0; depth--) {
    if ($at.node(depth).type === schema.nodes.tableCell) return true;
  }
  return false;
}

// いまカーソルが居るブロックの種別。帯に名前を出すのに使う。
//
// 見分けるのは節点の型と印だけ。スラッシュコマンドと同じ一覧から引くので、
// 出す名前と変換の入口が食い違わない。
export function blockKindOf(state: EditorState): SlashItem | null {
  const $at = state.selection.$from;
  for (let depth = $at.depth; depth > 0; depth--) {
    const id = kindOf($at.node(depth), $at.node(depth - 1));
    if (id) return SLASH_ITEMS.find((item) => item.id === id) ?? null;
  }
  return null;
}

function kindOf(
  node: ReturnType<ResolvedPos["node"]>,
  parent: ReturnType<ResolvedPos["node"]>,
): string | null {
  const n = schema.nodes;
  switch (node.type) {
    case n.heading:
      return `h${node.attrs.level}`;
    case n.table:
      return "table";
    case n.blockquote:
      return "quote";
    case n.codeBlock:
      return "code";
    case n.callout:
      return "callout";
    case n.details:
      return "toggle";
    case n.thematicBreak:
      return "rule";
    case n.listItem:
      // TODO の箇条書きは項目に印が付く。
      if (node.attrs.box !== null) return "todo";
      return parent.type === n.orderedList ? "ordered" : "bullet";
    case n.paragraph:
      return parent.type === n.doc ? "text" : null;
    default:
      return null;
  }
}
