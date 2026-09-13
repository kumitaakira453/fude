// 画面に浮かせるものの置き場所。相手のすぐ下に出し、入らなければ上へ回す。
//
// 選んだ文字の帯は「選んだところの下」に出るのが素直だが、画面のいちばん下の
// 行を選ぶと下に余地が無く、そのまま置くと画面の外へ出て見えなくなる。
// BlockMenu の placeY と同じ考え方を、横のはみ出しも含めて 1 か所に持つ。

// 相手との隙間。詰めると選んだ字と帯が一体に見える。
const GAP = 8;
// 画面の縁との隙間。端に張り付くと、影が切れて浮いて見えない。
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

// 画面の中に収める。相手が送られて画面の外へ出ても、帯は縁で止める。
const within = (value: number, span: number, room: number): number =>
  Math.max(EDGE, Math.min(value, room - EDGE - span));

export function placeNear(at: Spot, size: Size, room: Size): { top: number; left: number } {
  const below = at.bottom + GAP;
  const above = at.top - GAP - size.height;
  // 下に入るなら下。入らないなら上。どちらにも入らなければ縁で止める。
  const want = below + size.height <= room.height - EDGE ? below : above >= EDGE ? above : below;
  return {
    top: within(want, size.height, room.height),
    left: within(at.left, size.width, room.width),
  };
}
