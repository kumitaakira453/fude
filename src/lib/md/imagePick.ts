import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { ImageGoes } from "./imageDrop";
import { icon } from "./nodeViews";

// /image で置く仮置きの枠。
//
// まだ画像は選ばれていない。この時点で `![]()` を本文へ書くと、選ぶ前に保存が
// 走ったとき壊れた記法が文書に残る。仮置きは編集面だけの状態として持ち、
// 画像が決まってから初めて本文へ書く。
//
// 枠は**塊の外**へ出す。段落の中に widget を差すと、その行の高さが枠の高さに
// なってカーソルが枠と同じ丈で立ち、本文の組版（字間・寄せ）もそのまま枠に
// 掛かる。外へ出したうえで、空になった段落は畳んで隠す。

const pickKey = new PluginKey<number | null>("imagePick");

export function openImagePick(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(pickKey, view.state.selection.from));
}

function closePick(view: EditorView): void {
  if (pickKey.getState(view.state) === null) return;
  view.dispatch(view.state.tr.setMeta(pickKey, null));
}

// 決まった道筋を本文へ書き、枠を閉じる。
function write(view: EditorView, at: number, src: string): void {
  const node = view.state.schema.nodes.image.create({ src, alt: "", title: null });
  const here = Math.min(Math.max(at, 0), view.state.doc.content.size);
  view.dispatch(view.state.tr.setMeta(pickKey, null).insert(here, node).scrollIntoView());
}

function frame(view: EditorView, at: number, goes: ImageGoes): HTMLElement {
  // not-prose で本文の組版から切り離す。枠の中の字は本文ではない。
  const box = document.createElement("div");
  box.className = "mg-imgpick not-prose";
  box.contentEditable = "false";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "mg-imgpick-open";
  open.appendChild(icon("image", 18));
  const name = document.createElement("span");
  name.textContent = "画像を選ぶか、ここに落とす";
  open.appendChild(name);
  open.addEventListener("click", () => {
    void goes.pick().then((path) => {
      if (!path) return;
      void goes.take(path).then((src) => {
        if (src && !view.isDestroyed) write(view, at, src);
      });
    });
  });
  box.appendChild(open);

  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "mg-imgpick-x";
  shut.title = "やめる";
  shut.appendChild(icon("close", 15));
  shut.addEventListener("click", () => closePick(view));
  box.appendChild(shut);

  // 枠の中の押下は編集面へ渡さない。
  box.addEventListener("mousedown", (event) => event.stopPropagation());
  return box;
}

export const imagePicker = (goes: ImageGoes): Plugin<number | null> =>
  new Plugin<number | null>({
    key: pickKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(pickKey) as number | null | undefined;
        if (meta !== undefined) return meta;
        if (prev === null) return null;
        // 本文が動いたら閉じる。画像が入ったときも、書き始めたときもここを通る。
        return tr.docChanged ? null : prev;
      },
    },
    props: {
      decorations(state) {
        const at = pickKey.getState(state);
        if (at === null || at === undefined) return null;
        const here = Math.min(Math.max(at, 0), state.doc.content.size);
        const $at = state.doc.resolve(here);
        const depth = Math.max($at.depth, 1);
        const start = $at.before(depth);
        const end = $at.after(depth);

        const marks = [
          Decoration.widget(start, (view) => frame(view, here, goes), {
            key: "imgpick",
            side: -1,
            // 枠の中の出来事は編集面の仕事にしない。
            stopEvent: () => true,
            ignoreSelection: true,
          }),
        ];
        // 空の塊はしまう。枠のすぐ上に何もない行とカーソルが残ると、
        // どちらへ書くのか読めない。
        if ($at.parent.content.size === 0) {
          marks.push(Decoration.node(start, end, { class: "mg-imgpick-gone" }));
        }
        return DecorationSet.create(state.doc, marks);
      },
    },
  });
