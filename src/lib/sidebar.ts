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
