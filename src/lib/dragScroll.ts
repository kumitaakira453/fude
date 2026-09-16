// 掴んだまま端へ寄ったら、その下にある面を送る。
//
// 掴んで運ぶ操作（本文のブロック、表の行と列、ファイルの木、タブ）は、どれも
// dragover の座標で置き先を決めるだけで、面を送る手が無い。それだと運べる範囲が
// そのとき画面に出ている分に限られ、長い文書で段落を上の方へは動かせない。
//
// 掴みものの種類は見ない（dataTransfer を読まない）。座標の下にある「まだ送る
// 余地のある面」を探して送るだけなので、どの掴みものにもそのまま効く。

// 端とみなす幅。
const EDGE = 56;
// 1 フレームに送る量。端に寄るほど速くする。一定の速さだと、少し掛かっただけで
// 飛びすぎて、掴んだものをどこへ置いているのか見失う。
const SLOW = 2;
const FAST = 18;

interface Spot {
  x: number;
  y: number;
}

// 掴んでいる間だけ効く。返ってくるのは見張りをやめる手。
export function watchDragScroll(): () => void {
  let spot: Spot | null = null;
  let frame = 0;

  const step = () => {
    frame = 0;
    if (!spot) return;
    send(spot);
    frame = requestAnimationFrame(step);
  };

  // 座標は dragover から取る。drag は WebKit で座標が信用できない。
  const onOver = (e: DragEvent) => {
    spot = { x: e.clientX, y: e.clientY };
    if (frame === 0) frame = requestAnimationFrame(step);
  };

  // 取り消し（Esc・対象外で離す）でも dragend は来る。
  const stop = () => {
    spot = null;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  window.addEventListener("dragover", onOver, true);
  window.addEventListener("dragend", stop, true);
  window.addEventListener("drop", stop, true);
  return () => {
    stop();
    window.removeEventListener("dragover", onOver, true);
    window.removeEventListener("dragend", stop, true);
    window.removeEventListener("drop", stop, true);
  };
}

// その座標で送るべき面を探して、1 フレーム分だけ送る。
function send(spot: Spot): void {
  const el = document.elementFromPoint(spot.x, spot.y);
  for (let node = el; node instanceof Element; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const how = getComputedStyle(node);

    const dy = speed(spot.y - box.top, box.bottom - spot.y);
    if (dy !== 0 && scrolls(how.overflowY) && room(node, "y", dy)) {
      node.scrollTop += dy;
      return;
    }
    const dx = speed(spot.x - box.left, box.right - spot.x);
    if (dx !== 0 && scrolls(how.overflowX) && room(node, "x", dx)) {
      node.scrollLeft += dx;
      return;
    }
  }
}

// 端からの近さを、1 フレームに送る量に直す。どちらの端にも掛かっていなければ 0。
function speed(fromHead: number, fromFoot: number): number {
  if (fromHead < EDGE && fromHead < fromFoot) {
    return -ramp(fromHead);
  }
  if (fromFoot < EDGE) return ramp(fromFoot);
  return 0;
}

function ramp(gap: number): number {
  // 枠の外まで出ているときは最大。端に近いほど速い。
  const near = Math.min(1, Math.max(0, (EDGE - gap) / EDGE));
  return SLOW + (FAST - SLOW) * near;
}

function scrolls(how: string): boolean {
  return how === "auto" || how === "scroll" || how === "overlay";
}

// その向きへ、まだ送る余地があるか。無ければ外側の面へ譲る（本文の中の表で
// 上端に居ても、本文そのものが送られるように）。
function room(el: HTMLElement, axis: "x" | "y", delta: number): boolean {
  const at = axis === "y" ? el.scrollTop : el.scrollLeft;
  const full = axis === "y" ? el.scrollHeight : el.scrollWidth;
  const seen = axis === "y" ? el.clientHeight : el.clientWidth;
  return delta < 0 ? at > 0 : at < full - seen - 1;
}
