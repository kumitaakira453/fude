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
// exact なら at はそのまま塊の境目（落とした先）。そうでなければカーソルの
// 位置で、そこを含む塊の境目へ寄せる。2 枚目からは 1 枚目の直後に並べる。
// 取り込みは待ちを挟むので、書き込む前に位置を本文の長さへ収める。
async function land(
  view: EditorView,
  at: number,
  takes: (() => Promise<string | null>)[],
  exact = false,
) {
  let here: number | null = exact ? at : null;
  for (const take of takes) {
    const src = await take();
    if (!src || view.isDestroyed) continue;
    const size = view.state.doc.content.size;
    const pos =
      here === null
        ? blockAfter(view.state.doc.resolve(Math.min(Math.max(at, 0), size)))
        : Math.min(Math.max(here, 0), size);
    const node = schema.nodes.imageBlock.create({ src, alt: "", title: null });
    const tr = view.state.tr.insert(pos, node);
    view.dispatch(
      tr
        .setSelection(TextSelection.near(tr.doc.resolve(pos + node.nodeSize), 1))
        .scrollIntoView(),
    );
    here = pos + node.nodeSize;
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
  exact = false,
): boolean {
  const files = imageFiles(data);
  if (files.length === 0) return false;
  if (!canHold(view, pos)) return false;
  void readIncoming(files).then((shots) =>
    land(view, pos, shots.map((shot) => () => goes.stow(shot)), exact),
  );
  return true;
}

// 落とす先。指している塊の上半分なら上、下半分なら下の境目に入れる。空の塊は
// その場に入れる。line は入る位置に出す線（画面の座標）。
//
// 横位置は編集面の中へ寄せてから引く。余白の上では位置が取れず、落としても
// 何も起きない。
export function dropSpot(
  view: EditorView,
  x: number,
  y: number,
): { pos: number; line: { top: number; left: number; width: number } } | null {
  const box = view.dom.getBoundingClientRect();
  const left = Math.min(Math.max(x, box.left + 2), box.right - 2);
  const at = view.posAtCoords({ left, top: y });
  if (!at) return null;
  const $at = view.state.doc.resolve(at.pos);
  if ($at.depth === 0) {
    // 塊と塊のあいだ。後ろの塊の上端（無ければ前の塊の下端）に線を出す。
    const after = view.nodeDOM(at.pos);
    const before = $at.nodeBefore ? view.nodeDOM(at.pos - $at.nodeBefore.nodeSize) : null;
    const el = after instanceof HTMLElement ? after : before instanceof HTMLElement ? before : null;
    if (!el || !canHold(view, at.pos)) return null;
    const rect = el.getBoundingClientRect();
    const top = after instanceof HTMLElement ? rect.top : rect.bottom;
    return { pos: at.pos, line: { top, left: rect.left, width: rect.width } };
  }
  const start = $at.before($at.depth);
  const el = view.nodeDOM(start);
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  const below = $at.parent.content.size > 0 && y > rect.top + rect.height / 2;
  const pos = below ? $at.after($at.depth) : start;
  if (!canHold(view, pos)) return null;
  return { pos, line: { top: below ? rect.bottom : rect.top, left: rect.left, width: rect.width } };
}

const carriesFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

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

export const imageDrops = (goes: ImageGoes): Plugin => {
  // 入る位置の線。画面の座標で置くので、本文の外（body）に 1 本だけ持つ。
  let line: HTMLElement | null = null;
  const hide = () => line?.remove();
  const show = (at: { top: number; left: number; width: number }) => {
    line ??= Object.assign(document.createElement("div"), { className: "mg-drop-line" });
    line.style.top = `${at.top}px`;
    line.style.left = `${at.left}px`;
    line.style.width = `${at.width}px`;
    if (!line.isConnected) document.body.appendChild(line);
  };

  return new Plugin({
    view: () => ({ destroy: hide }),
    props: {
      handleDOMEvents: {
        // ファイルを運んでいるあいだだけ線を出す。ブロックの移動は別の線を持つ。
        dragover(view, event) {
          if (!carriesFiles(event)) return false;
          const spot = dropSpot(view, event.clientX, event.clientY);
          if (spot) show(spot.line);
          else hide();
          return false;
        },
        dragleave(view, event) {
          const to = event.relatedTarget;
          if (!(to instanceof Node) || !view.dom.contains(to)) hide();
          return false;
        },
        dragend() {
          hide();
          return false;
        },
      },
      // 落とす。ブロックの移動も同じ仕組みを使っているので、外から持ち込まれた
      // 画像のときだけ受ける。
      handleDrop(view, event) {
        hide();
        const spot = dropSpot(view, event.clientX, event.clientY);
        const took = spot
          ? takeImages(view, event.dataTransfer, spot.pos, goes, true)
          : takeImages(view, event.dataTransfer, view.state.selection.from, goes);
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
};
