// 直前のレビュー操作（削除・解決）を戻す手。⌘Z と知らせの「元に戻す」から呼ぶ。
//
// 画面ごとに持たない。本文の画面とレビュー画面は互いに差し替わるので、
// どちらかのコンポーネントに置くと画面を移った時点で戻し先が消える。
let pending: null | (() => Promise<void>) = null;

export function setReviewUndo(run: (() => Promise<void>) | null): void {
  pending = run;
}

// 戻すものがあれば戻して true。無ければ false を返し、⌘Z を本文の undo に譲る。
export function runReviewUndo(): boolean {
  const run = pending;
  if (!run) return false;
  pending = null;
  void run();
  return true;
}
