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
  const box = document.createElement("div");
  box.className = "mg-imgpick";
  box.contentEditable = "false";

  const head = document.createElement("div");
  head.className = "mg-imgpick-head";
  head.appendChild(icon("image", 17));
  const name = document.createElement("span");
  name.textContent = "画像を選ぶか、ここに落とす";
  head.appendChild(name);

  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "mg-imgpick-x";
  shut.title = "やめる";
  shut.appendChild(icon("close", 15));
  shut.addEventListener("click", () => closePick(view));
  head.appendChild(shut);
  box.appendChild(head);

  const row = document.createElement("div");
  row.className = "mg-imgpick-row";

  const take = (path: string | null) => {
    if (!path) return;
    void goes.take(path).then((src) => {
      if (src && !view.isDestroyed) write(view, at, src);
    });
  };

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "mg-imgpick-pick";
  choose.textContent = "ファイルを選ぶ";
  choose.addEventListener("click", () => void goes.pick().then(take));
  row.appendChild(choose);

  const typed = document.createElement("input");
  typed.className = "mg-imgpick-path";
  typed.placeholder = "道筋を打つ（/… でも ./… でも）";
  typed.spellcheck = false;
  typed.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      take(typed.value.trim() || null);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePick(view);
    }
  });
  row.appendChild(typed);
  box.appendChild(row);

  // 枠の中の押下・打鍵は編集面へ渡さない（入力欄が焦点を保てない）。
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
        return DecorationSet.create(state.doc, [
          Decoration.widget(here, (view) => frame(view, here, goes), {
            key: "imgpick",
            side: 1,
            // 枠の中の出来事は編集面の仕事にしない。
            stopEvent: () => true,
            ignoreSelection: true,
          }),
        ]);
      },
    },
  });
