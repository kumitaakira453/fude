import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { COLS, emojiReady, rememberEmoji, searchEmoji } from "../emoji";

// 本文で `:` を打ったら絵文字の盤を出す。
//
// 仕掛けはスラッシュコマンド（slash.ts）と同じ形にしてある。打鍵の横取り・
// 変換中の見送り・位置の写し・閉じる条件は、あちらで詰めたものをそのまま使う。
// 違うのは出す先だけで、盤は React 側（BodyEditor）が出す。

export interface EmojiState {
  // `:` の位置。
  from: number;
  // `:` の後ろに打った絞り込みの文字。
  query: string;
  // いま選ばれている候補の番号。
  active: number;
  // 打ち込みではなく /emoji から開いたか。閉じるときに `:` を消さない。
  bare?: boolean;
}

type Meta =
  | { type: "open"; from: number }
  | { type: "board"; from: number }
  | { type: "close" }
  | { type: "move"; by: number }
  | { type: "at"; index: number };

export const emojiKey = new PluginKey<EmojiState | null>("emoji");

// `:` の直前。英数字の後ろでは出さない（`12:30` や `http://` で邪魔しない）。
function canOpen(state: EditorState, from: number): boolean {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const at = from - $from.start();
  if (at < 0) return false;
  if (at === 0) return true;
  const before = $from.parent.textBetween(at - 1, at);
  return !/[0-9A-Za-z:/]/.test(before);
}

// `:` とその後ろに打った文字を読む。閉じるべき状態なら null。
export function queryAt(state: EditorState, from: number): string | null {
  if (!state.selection.empty || from < 0 || from >= state.doc.content.size) {
    return null;
  }
  const $from = state.doc.resolve(from);
  const $head = state.selection.$head;
  if (!$from.sameParent($head)) return null;

  const at = from - $from.start();
  const to = $head.parentOffset;
  if (at < 0 || to <= at || at + 1 > $from.parent.content.size) return null;
  if ($from.parent.textBetween(at, at + 1) !== ":") return null;

  const text = $from.parent.textBetween(at + 1, to);
  // 空白まで打ったら、ただの文字として書きたい合図と見る。
  return /\s/.test(text) ? null : text;
}

// 決めた絵文字を入れる。打った `:xxx` は先に消す。
export function takeEmoji(view: EditorView, char: string): void {
  const now = emojiKey.getState(view.state);
  const tr = view.state.tr;
  if (now && !now.bare) tr.delete(now.from, view.state.selection.head);
  tr.insertText(char);
  view.dispatch(tr.setMeta(emojiKey, { type: "close" } satisfies Meta));
  rememberEmoji(char);
  if (!view.hasFocus()) view.focus();
}

export function closeEmoji(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(emojiKey, { type: "close" } satisfies Meta));
}

// スラッシュコマンドから開く。打ち込みが無いので、閉じても本文は変わらない。
export function openEmojiBoard(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(emojiKey, {
      type: "board",
      from: view.state.selection.head,
    } satisfies Meta),
  );
}

export const emojiMenu = new Plugin<EmojiState | null>({
  key: emojiKey,
  state: {
    init: () => null,
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(emojiKey) as Meta | undefined;
      if (meta?.type === "open") return { from: meta.from, query: "", active: 0 };
      if (meta?.type === "board") {
        return { from: meta.from, query: "", active: 0, bare: true };
      }
      if (meta?.type === "close" || !prev) return null;

      const from = tr.docChanged ? tr.mapping.map(prev.from, -1) : prev.from;
      // /emoji から開いた盤は、本文の打ち込みでは絞り込まない。本文が動いたら
      // 閉じる（対象の位置を見失うため）。
      if (prev.bare) return tr.docChanged ? null : { ...prev, from };

      const query = queryAt(next, from);
      if (query === null) return null;

      if (meta?.type === "move") {
        return { from, query, active: Math.max(0, prev.active + meta.by) };
      }
      if (meta?.type === "at") {
        return { from, query, active: Math.max(0, meta.index) };
      }
      if (query !== prev.query) return { from, query, active: 0 };
      return from === prev.from ? prev : { ...prev, from };
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      // 変換中は横取りしない。
      if (text !== ":" || view.composing || !canOpen(view.state, from)) return false;
      view.dispatch(
        view.state.tr
          .insertText(":", from, to)
          .setMeta(emojiKey, { type: "open", from } satisfies Meta),
      );
      return true;
    },

    handleKeyDown(view, event) {
      const now = emojiKey.getState(view.state);
      if (!now || view.composing) return false;
      const send = (meta: Meta) => view.dispatch(view.state.tr.setMeta(emojiKey, meta));

      switch (event.key) {
        case "Escape":
          send({ type: "close" });
          return true;
        case "ArrowRight":
          send({ type: "move", by: 1 });
          return true;
        case "ArrowLeft":
          send({ type: "move", by: -1 });
          return true;
        case "ArrowDown":
          send({ type: "move", by: COLS });
          return true;
        case "ArrowUp":
          send({ type: "move", by: -COLS });
          return true;
        case "Enter": {
          // 打ち込みで絞り込んでいるときだけ Enter で決める。/emoji から
          // 開いた盤は押す相手が決まっていないので、改行に譲る。
          const all = emojiReady();
          if (now.bare || !all) return false;
          const found = searchEmoji(all, now.query);
          const one = found[Math.min(now.active, found.length - 1)];
          if (!one) return false;
          takeEmoji(view, one.char);
          return true;
        }
        default:
          return false;
      }
    },
  },
});
