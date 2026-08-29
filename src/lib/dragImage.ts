// ドラッグ中にカーソルへ付いてくる見た目。
//
// 既定のままだと掴んだ要素の半透明な写しが出るだけで、タブの列やツリーの行は
// 背景が薄く何を掴んでいるのか読み取りにくい。ファイル名だけを載せた札に置き換える。

export function setFileDragImage(data: DataTransfer, name: string): void {
  const chip = document.createElement("div");
  chip.className = "mg-drag-chip";
  chip.textContent = name;
  // 画面外に置く。setDragImage は描画済みの要素しか写せない。
  document.body.appendChild(chip);
  data.setDragImage(chip, 16, 16);
  // 写しは同期で取られるので、次のフレームには捨ててよい。
  requestAnimationFrame(() => chip.remove());
}
