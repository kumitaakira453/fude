// ドラッグ中にカーソルへ付いてくる見た目。
//
// 既定のままだと掴んだ要素の半透明な写しが出るだけで、タブの列やツリーの行、
// 本文のブロックは何を掴んでいるのか読み取りにくい。名前を載せた札に置き換える。

export function setDragChip(data: DataTransfer, label: string): void {
  const chip = document.createElement("div");
  chip.className = "mg-drag-chip";
  chip.textContent = label;
  // 画面外に置く。setDragImage は描画済みの要素しか写せない。
  document.body.appendChild(chip);
  data.setDragImage(chip, 16, 16);
  // 写しは同期で取られるので、次のフレームには捨ててよい。
  requestAnimationFrame(() => chip.remove());
}

// 掴んだものそのものを薄い写しとして見せる。組版の見た目を保ったまま運べる。
// 背の高いものは札に落とす（画面を覆う写しが付いてくると位置が読めない）。
const PREVIEW_MAX = 180;

export function setDragPreview(
  data: DataTransfer,
  el: Element | null,
  label: string,
): void {
  const box = el?.getBoundingClientRect();
  if (el && box && box.height > 0 && box.height <= PREVIEW_MAX && box.width > 0) {
    data.setDragImage(el, 12, Math.min(box.height / 2, 22));
    return;
  }
  setDragChip(data, label);
}
