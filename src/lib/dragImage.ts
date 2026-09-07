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

// 表の行・列を掴んだときの写し。
//
// 行は tr、列は行ごとに散った升目で、どちらも単体では表として組まれない
// （table の外に出すと桁の決め方が効かない）。升目を並べ直すと組みが崩れて
// 別物に見えるので、表そのものを写して要らない行・列を落とす。桁は実測した
// 幅で固定する。地と書体は本文の入れ物のクラスをそのまま被せて借りる。
//
// 全部を並べると画面を覆う写しが付いてくるので、高さは上限までで切る。
const STACK_MAX = 320;

export function setDragTablePart(
  data: DataTransfer,
  table: HTMLTableElement | null,
  kind: "row" | "col",
  at: number,
  label: string,
): void {
  const rows = table ? Array.from(table.rows) : [];
  if (!table || rows.length === 0) {
    setDragChip(data, label);
    return;
  }

  // 桁と高さを先に測る。写しを組んだ後では元の表を測れない。
  const widths = Array.from(rows[0].cells).map(
    (cell) => cell.getBoundingClientRect().width,
  );
  const heights = rows.map((row) => row.getBoundingClientRect().height);

  const copy = table.cloneNode(true) as HTMLTableElement;
  const kept = Array.from(copy.rows);
  if (kind === "row") {
    if (at < 0 || at >= kept.length) {
      setDragChip(data, label);
      return;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (i !== at) kept[i].remove();
    }
  } else {
    if (at < 0 || at >= widths.length) {
      setDragChip(data, label);
      return;
    }
    // 上限を超える行は落とす。表の頭から入る分だけを見せる。
    let room = 0;
    for (let i = 0; i < kept.length; i++) {
      if (i > 0 && room + heights[i] > STACK_MAX) {
        for (let j = kept.length - 1; j >= i; j--) kept[j].remove();
        break;
      }
      room += heights[i];
    }
    // 数えるのは控えの並びで。消すたびに残った升目の cellIndex がずれるので、
    // それを見ると狙った列まで消える（先頭の列だけ偶然通っていた）。
    for (const row of Array.from(copy.rows)) {
      const cells = Array.from(row.cells);
      for (let i = cells.length - 1; i >= 0; i--) {
        if (i !== at) cells[i].remove();
      }
    }
  }

  // 残した升目の桁を実測の幅で固定する。
  for (const row of Array.from(copy.rows)) {
    const cells = Array.from(row.cells);
    for (let i = 0; i < cells.length; i++) {
      const width = widths[kind === "col" ? at : i];
      if (width) cells[i].style.width = `${width}px`;
    }
  }

  // 本文の入れ物のクラスを被せて、地と書体と枠線をそのまま借りる。
  const skin = table.closest(".mg-prose");
  const shell = document.createElement("div");
  shell.className = `mg-drag-table ${skin?.className ?? ""}`.trim();
  const style = getComputedStyle(skin ?? table);
  shell.style.fontFamily = style.fontFamily;
  shell.style.fontSize = style.fontSize;

  const wrap = table.closest(".mg-table-wrap");
  const inner = document.createElement("div");
  inner.className = wrap?.className ?? "mg-table-wrap";
  inner.appendChild(copy);
  shell.appendChild(inner);

  // 画面外に置く。setDragImage は描画済みの要素しか写せない。
  document.body.appendChild(shell);
  const box = shell.getBoundingClientRect();
  if (box.height <= 0 || box.width <= 0) {
    shell.remove();
    setDragChip(data, label);
    return;
  }
  data.setDragImage(shell, 12, Math.min(box.height / 2, 22));
  // 写しは同期で取られるので、次のフレームには捨ててよい。
  requestAnimationFrame(() => shell.remove());
}
