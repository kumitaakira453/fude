// 画面に浮かせるものの置き場所。相手のすぐ下に出し、入らなければ上へ回す。
//
// 選んだ文字の帯は「選んだところの下」に出るのが素直だが、いちばん下の行を
// 選ぶと下に余地が無く、そのまま置くと枠の外へ出て見えなくなる。
// BlockMenu の placeY と同じ考え方を、横のはみ出しも含めて 1 か所に持つ。
//
// 収める枠は画面ぜんたいとは限らない。本文はペインの中に組まれているので、
// 画面で止めるとタブやツールバーの上まで出てしまう。枠は原点ごと受ける。

// 相手との隙間。詰めると選んだ字と帯が一体に見える。
const GAP = 8;
// 枠の縁との隙間。端に張り付くと、影が切れて浮いて見えない。
const EDGE = 8;

export interface Spot {
  top: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Room extends Size {
  top: number;
  left: number;
}

// 枠の中に収める。相手が送られて枠の外へ出ても、そこで止める。
const within = (value: number, span: number, from: number, to: number): number =>
  Math.max(from, Math.min(value, to - span));

// 縦を縁で止めるか。止めないものは、相手が枠の外へ流れれば一緒に出ていく
// （選んだ字から離れて縁に残っても、もう相手が見えないので用が無い）。
export function placeNear(
  at: Spot,
  size: Size,
  room: Room,
  hold = true,
): { top: number; left: number } {
  const head = room.top + EDGE;
  const foot = room.top + room.height - EDGE;
  const below = at.bottom + GAP;
  const above = at.top - GAP - size.height;
  // 下に入るなら下。入らないなら上。どちらにも入らなければ下のまま。
  const want = below + size.height <= foot ? below : above >= head ? above : below;
  return {
    // 横は流れないので、止めるかどうかに関わらず枠の中に収める。
    top: hold ? within(want, size.height, head, foot) : want,
    left: within(at.left, size.width, room.left + EDGE, room.left + room.width - EDGE),
  };
}

// その矩形が枠に掛かっているか。外れたものは出す意味がない。
export const seenIn = (at: { top: number; bottom: number }, room: Room): boolean =>
  at.bottom > room.top && at.top < room.top + room.height;

// 収める枠。渡されなければ画面ぜんたい。
export const roomOf = (el: HTMLElement | null | undefined): Room => {
  if (!el) return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const box = el.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
};
