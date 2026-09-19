// 左の欄（ファイルツリー・検索）の幅。
//
// 決め打ちだと、深い階層や長いファイル名が truncate で切れるだけで読めない。
// 掴んで変えられるようにし、窓ごとに覚える。

// ダブルクリックで戻る幅。決め打ちだったときの w-72。
export const SIDEBAR_WIDTH = 288;
// ツリーの字が読める下限と、広げすぎの上限。上限は元の幅の 2 倍まで。
// それ以上広げても、道筋が長い一部のファイルのために本文を狭めるだけになる。
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = SIDEBAR_WIDTH * 2;
// 本文に残す下限。窓を狭めたときに本文が 0 にならないようにする。
export const MIN_DOC = 360;

// 控えに入れる値を上下限へ収める。
//
// 画面に出す幅は CSS の min-width / max-width が窓の広さに合わせて抑えるので、
// ここで見るのは「残す値として妥当か」だけ。
export function fitSidebarWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), SIDEBAR_MIN), SIDEBAR_MAX);
}

// レビュー画面の右の欄（やり取りと操作）の幅。
//
// やり取りが長くなると狭く、本文を広く見たいときは縮めたい。左の欄と同じく
// 掴んで変えられるようにし、窓ごとに覚える。
export const REVIEW_SIDE_WIDTH = 368;
export const REVIEW_SIDE_MIN = 280;
export const REVIEW_SIDE_MAX = 640;

export function fitReviewSideWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), REVIEW_SIDE_MIN), REVIEW_SIDE_MAX);
}

// 本文の横に出すコメントの欄。
//
// 指摘には表やコードが入ることがあり、288px では折り返しばかりになる。今の幅を
// 下限にして、2 倍まで広げられるようにする。
export const RAIL_WIDTH = 288;
export const RAIL_MAX = RAIL_WIDTH * 2;

export function fitRailWidth(w: number): number {
  return Math.min(Math.max(Math.round(w), RAIL_WIDTH), RAIL_MAX);
}

// 右の欄を出せる窓の広さ。これより狭いと、本文と欄が両方とも読めなくなる。
export const RAIL_ROOM = "(min-width: 1024px)";
