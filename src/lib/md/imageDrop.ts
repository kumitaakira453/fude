import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { imageFiles, readIncoming, type Held, type Incoming } from "../images";
import { schema } from "./schema";

// 外から持ち込まれた画像を本文へ入れる。落とすのと貼るの 2 経路。
//
// 取り込みそのもの（どこへ置くか・どう名付けるか）は lib/images が持つ。
// ここは「持ち込みかどうかを見分けて、決まった道筋を本文へ書く」だけにする。

export interface ImageGoes {
  // バイト列を取り込み、本文に書く道筋を返す。取り込めなければ null。
  stow: (incoming: Incoming) => Promise<string | null>;
  // 既にあるファイルを取り込む。絶対パスでも文書からの相対でもよい。
  take: (path: string) => Promise<string | null>;
  // ファイルを選ぶ小窓を出し、選ばれた絶対パスを返す。選ばなければ null。
  pick: () => Promise<string | null>;
  // 本文の道筋が指す画像を、そのまま写し取る。
  copy: (src: string) => void;
}

// その位置の絵。絵だけの塊（imageBlock）のときに返す。
//
// つまみのメニューは塊を相手にするので、行の中に字と混ざっている絵は返さない
// （どの絵の話か決められない）。
export function loneImage(doc: PmNode, blockPos: number): { at: number; node: PmNode } | null {
  const block = doc.nodeAt(blockPos);
  if (block?.type !== schema.nodes.imageBlock) return null;
  return { at: blockPos, node: block };
}

// 置ける位置か。コードの塊の中は字のまま扱うので、絵は入れない。
export function canHold(view: EditorView, pos: number): boolean {
  const at = Math.min(Math.max(pos, 0), view.state.doc.content.size);
  const $at = view.state.doc.resolve(at);
  for (let d = $at.depth; d > 0; d--) if ($at.node(d).type.spec.code) return false;
  return true;
}

// 画像を 1 枚ずつ、その位置へ置く。
//
// 取り込みは待ちを挟むので、置く位置は書き込むたびに取り直す。1 枚目を
// 入れた時点で 2 枚目の位置はずれている。
async function land(view: EditorView, at: number, files: File[], goes: ImageGoes) {
  let pos = at;
  for (const shot of await readIncoming(files)) {
    const src = await goes.stow(shot);
    if (!src || view.isDestroyed) continue;
    const here = blockAfter(view.state.doc.resolve(Math.min(Math.max(pos, 0), view.state.doc.content.size)));
    const node = schema.nodes.imageBlock.create({ src, alt: "", title: null });
    const tr = view.state.tr.insert(here, node);
    view.dispatch(
      tr
        .setSelection(TextSelection.near(tr.doc.resolve(here + node.nodeSize), 1))
        .scrollIntoView(),
    );
    pos = view.state.selection.to;
  }
}

// 絵を置く塊の境目。空の塊ならその場、何か載っていればその下。
//
// 絵は塊なので、字の途中には入れられない。書いている行を割らずに、行の
// 切れ目へ置く。
export function blockAfter($at: ResolvedPos): number {
  const depth = Math.max($at.depth, 1);
  return $at.parent.content.size === 0 ? $at.before(depth) : $at.after(depth);
}

// 持ち込みを受けるかどうかを決め、受けるなら取り込みを始める。
//
// 落とす側と貼る側で同じ判断をする。画像を持たない持ち込み（ブロックの移動、
// 字の貼り付け）は受けない。受けなかったものは今までどおりに流れる。
export function takeImages(
  view: EditorView,
  data: Held | null,
  pos: number,
  goes: ImageGoes,
): boolean {
  const files = imageFiles(data);
  if (files.length === 0) return false;
  if (!canHold(view, pos)) return false;
  void land(view, pos, files, goes);
  return true;
}

export const imageDrops = (goes: ImageGoes): Plugin =>
  new Plugin({
    props: {
      // 落とす。ブロックの移動も同じ仕組みを使っているので、外から持ち込まれた
      // 画像のときだけ受ける。
      handleDrop(view, event) {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const took = takeImages(view, event.dataTransfer, at?.pos ?? view.state.selection.from, goes);
        // 窓に任せると、落としたファイルを開いて画面ごと差し替えてしまう。
        if (took) event.preventDefault();
        return took;
      },
      // 貼る。撮った画面はここから入る。
      handlePaste(view, event) {
        return takeImages(view, event.clipboardData, view.state.selection.from, goes);
      },
    },
  });
