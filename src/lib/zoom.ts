// 拡大して見る画面の、倍率と位置の計算。
//
// 画面の側は wheel とドラッグを受けて、ここに決めさせる。位置合わせは
// 「指した点が動かない」ことが要で、そこを目で確かめるのは難しい。

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// いまの見え方。x, y は枠の中心からの、画面上でのずれ。
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const FIT: View = { scale: 0, x: 0, y: 0 };

// 倍率の上限と下限。下限は、大きな図を全体像として見るときに要る。
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 40;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

// 枠に収めるときの余白。縁にぴったり付くと、切れているのか収まっているのか
// 分かりにくい。狭い枠では取れる分だけにする。
export const MARGIN = 24;

// 枠に収める倍率。原寸より大きくはしない（小さい画像を引き伸ばさない）。
export function fitScale(natural: Size, box: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  if (box.width <= 0 || box.height <= 0) return 1;
  const room = {
    width: Math.max(box.width / 2, box.width - MARGIN * 2),
    height: Math.max(box.height / 2, box.height - MARGIN * 2),
  };
  return Math.min(1, room.width / natural.width, room.height / natural.height);
}

// 枠の中に収まっている向きは中央に固定し、はみ出す向きだけ端で止める。
// 端を越えて引けると、画像を画面の外まで放り出せてしまう。
export function clampPan(view: View, natural: Size, box: Size): View {
  const shown = { width: natural.width * view.scale, height: natural.height * view.scale };
  const slackX = Math.max(0, (shown.width - box.width) / 2);
  const slackY = Math.max(0, (shown.height - box.height) / 2);
  return {
    scale: view.scale,
    x: Math.min(slackX, Math.max(-slackX, view.x)),
    y: Math.min(slackY, Math.max(-slackY, view.y)),
  };
}

// 指した点を動かさずに倍率を変える。at は枠の左上から測った位置。
export function zoomAt(
  view: View,
  natural: Size,
  box: Size,
  scale: number,
  at: Point,
): View {
  const next = clampScale(scale);
  // 枠の中心から見た、指した点。
  const dx = at.x - box.width / 2;
  const dy = at.y - box.height / 2;
  // 指した点の下にある「画像の中の場所」を、倍率を変えても同じ位置に置く。
  const k = next / view.scale;
  return clampPan(
    { scale: next, x: dx - (dx - view.x) * k, y: dy - (dy - view.y) * k },
    natural,
    box,
  );
}

// 平行移動。
export const panBy = (view: View, by: Point, natural: Size, box: Size): View =>
  clampPan({ scale: view.scale, x: view.x + by.x, y: view.y + by.y }, natural, box);

// ホイールの刻みを倍率の比に直す。macOS のピンチは ctrlKey 付きの wheel で
// 届き、刻みは指の動きに比例する。そのまま足すと大きい画像で暴れるので、
// 指数で効かせて、どの倍率でも同じ手触りにする。
export const wheelZoom = (scale: number, deltaY: number): number =>
  clampScale(scale * Math.exp(-deltaY / 180));
