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

// 枠を出す場所。塊の始まりと、その塊が空かどうか。
//
// 空の塊なら、その塊を畳んで枠を差し替える。何か載っている塊（絵など）なら、
// 枠はその塊の**下**に出し、決まった絵も新しい塊として下へ入れる。上に出すと、
// 打った場所と入る場所が食い違う。
interface Pick {
  block: number;
  empty: boolean;
}

const pickKey = new PluginKey<Pick | null>("imagePick");

export function openImagePick(view: EditorView): void {
  const $at = view.state.selection.$from;
  const depth = Math.max($at.depth, 1);
  view.dispatch(
    view.state.tr.setMeta(pickKey, {
      block: $at.before(depth),
      empty: $at.parent.content.size === 0,
    } satisfies Pick),
  );
}

function closePick(view: EditorView): void {
  if (pickKey.getState(view.state) === null) return;
  view.dispatch(view.state.tr.setMeta(pickKey, null));
}

// 決まった道筋を本文へ書き、枠を閉じる。
function write(view: EditorView, spot: Pick, src: string): void {
  const nodes = view.state.schema.nodes;
  const image = nodes.image.create({ src, alt: "", title: null });
  const doc = view.state.doc;
  const block = Math.min(Math.max(spot.block, 0), doc.content.size);
  const tr = view.state.tr.setMeta(pickKey, null);
  if (spot.empty) {
    tr.insert(block + 1, image);
  } else {
    // 何か載っている塊の下に、新しい塊として置く。同じ塊へ入れると、絵が
    // 2 枚並んだ 1 つの段落になり、塊ごとの操作がどちらの絵にも当たらない。
    const node = doc.nodeAt(block);
    tr.insert(block + (node?.nodeSize ?? 0), nodes.paragraph.create(null, image));
  }
  view.dispatch(tr.scrollIntoView());
}

function frame(view: EditorView, spot: Pick, goes: ImageGoes): HTMLElement {
  // not-prose で本文の組版から切り離す。枠の中の字は本文ではない。
  const box = document.createElement("div");
  box.className = "mg-imgpick not-prose";
  box.contentEditable = "false";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "mg-imgpick-open";
  open.appendChild(icon("image", 18));
  const name = document.createElement("span");
  name.textContent = "画像を選ぶ";
  open.appendChild(name);
  open.addEventListener("click", () => {
    void goes.pick().then((path) => {
      if (!path) return;
      void goes.take(path).then((src) => {
        if (src && !view.isDestroyed) write(view, spot, src);
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
        const spot = pickKey.getState(state);
        if (!spot) return null;
        const block = Math.min(Math.max(spot.block, 0), state.doc.content.size);
        const node = state.doc.nodeAt(block);
        if (!node) return null;
        const end = block + node.nodeSize;

        const marks = [
          // 空の塊は畳んで差し替えるので上に、載っている塊はその下に置く。
          Decoration.widget(spot.empty ? block : end, (view) => frame(view, spot, goes), {
            key: "imgpick",
            side: -1,
            // 枠の中の出来事は編集面の仕事にしない。
            stopEvent: () => true,
            ignoreSelection: true,
          }),
        ];
        // 空の塊はしまう。枠のすぐ上に何もない行とカーソルが残ると、
        // どちらへ書くのか読めない。
        if (spot.empty) {
          marks.push(Decoration.node(block, end, { class: "mg-imgpick-gone" }));
        }
        return DecorationSet.create(state.doc, marks);
      },
    },
  });
