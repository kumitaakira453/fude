import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { pastedImage } from "../clip";
import {
  carriesNoText,
  imageFiles,
  imagePaths,
  readIncoming,
  type Held,
  type Incoming,
} from "../images";
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

// 画像を 1 枚ずつ、その位置へ置く。取り込みの手（take）は本文に書く道筋を返す。
//
// 取り込みは待ちを挟むので、置く位置は書き込むたびに取り直す。1 枚目を
// 入れた時点で 2 枚目の位置はずれている。
async function land(
  view: EditorView,
  at: number,
  takes: (() => Promise<string | null>)[],
) {
  let pos = at;
  for (const take of takes) {
    const src = await take();
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
  void readIncoming(files).then((shots) =>
    land(view, pos, shots.map((shot) => () => goes.stow(shot))),
  );
  return true;
}

// 貼り付け。中身のファイル → 写したファイルの道筋 → アプリ側から読む画像、の
// 順に探す。どれも無ければ受けない（字の貼り付けとして流れる）。
export function pasteImages(
  view: EditorView,
  data: Held | null,
  pos: number,
  goes: ImageGoes,
): boolean {
  if (takeImages(view, data, pos, goes)) return true;
  if (!canHold(view, pos)) return false;
  const paths = imagePaths(data);
  if (paths.length > 0) {
    void land(view, pos, paths.map((path) => () => goes.take(path)));
    return true;
  }
  if (!carriesNoText(data)) return false;
  // 字の無い貼り付け。窓に任せると、中身の読めない絵（webkit-fake-url）が
  // 本文に入る。画像が無ければ何も起きない。
  void land(view, pos, [
    async () => {
      const shot = await pastedImage();
      return shot ? goes.stow({ bytes: shot.bytes, name: null, mime: shot.mime }) : null;
    },
  ]);
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
        return pasteImages(view, event.clipboardData, view.state.selection.from, goes);
      },
    },
  });
