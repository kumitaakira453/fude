import { useCallback, useMemo, useState } from "react";
import { replaceBlock, splitBlocks } from "../lib/blocks";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { type CellEditInfo, type ItemEditInfo, Markdown } from "./Markdown";

// タスク行（- [ ] / 1. [x] など）
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// mermaid コードフェンスのブロックか（インライン編集の対象外にする）
const isMermaidBlock = (src: string) => /^\s*`{3,}\s*mermaid\b/i.test(src);

// GFM テーブルのブロックか（2 行目が区切り行 `| --- | --- |`）
const isTableBlock = (src: string) => {
  const lines = src.split("\n");
  return (
    lines.length >= 2 &&
    /^[\s|:-]+$/.test(lines[1]) &&
    lines[1].includes("-") &&
    lines[1].includes("|")
  );
};

// 1 行を「エスケープされていない `|`」で分割する（`\|` は区切りにしない）
function splitRow(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// DOM 列 index を分割済み parts の index に変換（先頭 `|` があれば +1）
const partIndexOf = (line: string, colIndex: number) =>
  colIndex + (/^\s*\|/.test(line) ? 1 : 0);

const getCellValue = (src: string, lineIndex: number, colIndex: number) => {
  const line = src.split("\n")[lineIndex] ?? "";
  return (splitRow(line)[partIndexOf(line, colIndex)] ?? "").trim();
};

const setCellValue = (
  src: string,
  lineIndex: number,
  colIndex: number,
  value: string,
) => {
  const lines = src.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return src;
  const parts = splitRow(line);
  const idx = partIndexOf(line, colIndex);
  if (idx < 0 || idx >= parts.length) return src;
  const t = value.trim();
  parts[idx] = t ? ` ${t} ` : "  ";
  lines[lineIndex] = parts.join("|");
  return lines.join("\n");
};

interface EditingCell {
  blockIndex: number;
  cellStart: number;
  lineIndex: number;
  colIndex: number;
  value: string;
}

interface EditingItem {
  blockIndex: number;
  anchor: number;
  start: number;
  end: number;
  value: string;
}

// 箇条書き項目のマーカー（インデント + - / 1. + 任意の [ ] チェックボックス）
const ITEM_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

// anchor を含む 1 行から、マーカーを除いた「項目の本文」の範囲を求める。
// 子リストは別の行なので範囲に入らず、マーカーも保たれる。
function itemTextRange(
  src: string,
  anchor: number,
): { start: number; end: number } | null {
  const at = Math.max(0, Math.min(anchor, src.length));
  const lineStart = src.lastIndexOf("\n", at - 1) + 1;
  const nl = src.indexOf("\n", lineStart);
  const lineEnd = nl === -1 ? src.length : nl;
  const line = src.slice(lineStart, lineEnd);
  const marker = ITEM_MARKER_RE.exec(line);
  if (!marker) return null;
  let start = lineStart + marker[0].length;
  let end = lineEnd;
  while (end > start && /\s/.test(src[end - 1])) end--;
  return start < end ? { start, end } : null;
}

// レンダリング表示を保ったまま、ダブルクリックしたブロックだけをその場で
// 生ソース編集にする。編集対象以外は一切動かない（目線を動かさない）。
export function EditableBody({
  body,
  editorial,
  onSaveBody,
}: {
  body: string;
  editorial: boolean;
  onSaveBody: (newBody: string) => void;
}) {
  const blocks = useMemo(() => splitBlocks(body), [body]);
  // 編集対象ブロックと、開始時のダブルクリック座標（カーソル配置に使う）
  const [editing, setEditing] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  // 編集中のテーブルセル（ブロック全体ではなく 1 セルだけ）
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  // 編集中の箇条書き項目（リスト全体ではなく 1 項目の本文だけ）
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

  const handleEditItem = useCallback(
    (info: ItemEditInfo) => {
      const block = blocks[info.blockIndex];
      if (!block) return;
      const range = itemTextRange(block.src, info.anchor);
      // 行からマーカーが読めない（継続行など）場合は項目編集にせず、
      // ブロック全体編集へのフォールバックに任せる。
      if (!range) return;
      setEditing(null);
      setEditingCell(null);
      setEditingItem({
        blockIndex: info.blockIndex,
        anchor: info.anchor,
        start: range.start,
        end: range.end,
        value: block.src.slice(range.start, range.end),
      });
    },
    [blocks],
  );

  const commitItem = useCallback(
    (v: string) => {
      if (!editingItem) return;
      const block = blocks[editingItem.blockIndex];
      setEditingItem(null);
      if (!block) return;
      const newSrc =
        block.src.slice(0, editingItem.start) +
        v +
        block.src.slice(editingItem.end);
      if (newSrc !== block.src) onSaveBody(replaceBlock(body, block, newSrc));
    },
    [editingItem, blocks, body, onSaveBody],
  );

  const cancelItem = useCallback(() => setEditingItem(null), []);

  // ダブルクリックされたセルの位置から編集対象を確定する
  const handleEditCell = useCallback(
    (info: CellEditInfo) => {
      const block = blocks[info.blockIndex];
      if (!block) return;
      const lineIndex = info.rowKind === "head" ? 0 : 2 + info.rowIndex;
      setEditing(null);
      setEditingItem(null);
      setEditingCell({
        blockIndex: info.blockIndex,
        cellStart: info.cellStart,
        lineIndex,
        colIndex: info.colIndex,
        value: getCellValue(block.src, lineIndex, info.colIndex),
      });
    },
    [blocks],
  );

  const commitCell = useCallback(
    (v: string) => {
      if (!editingCell) return;
      const block = blocks[editingCell.blockIndex];
      setEditingCell(null);
      if (!block) return;
      const newSrc = setCellValue(
        block.src,
        editingCell.lineIndex,
        editingCell.colIndex,
        v,
      );
      if (newSrc !== block.src) onSaveBody(replaceBlock(body, block, newSrc));
    },
    [editingCell, blocks, body, onSaveBody],
  );

  const cancelCell = useCallback(() => setEditingCell(null), []);

  const commit = (index: number, newSrc: string) => {
    setEditing(null);
    const block = blocks[index];
    if (!block || newSrc === block.src) return;
    if (newSrc.trim() === "") {
      // ブロック丸ごと削除: 継ぎ目の空行を畳んで、跡地に大きな隙間を残さない
      const before = body.slice(0, block.start).replace(/\n+$/, "");
      const after = body.slice(block.end).replace(/^\n+/, "");
      onSaveBody(before && after ? `${before}\n\n${after}` : before + after);
      return;
    }
    onSaveBody(replaceBlock(body, block, newSrc));
  };

  // ブロック内 ordinal 番目のタスクの [ ]↔[x] をトグルして保存
  const toggleTask = useCallback(
    (blockIndex: number, ordinal: number) => {
      const block = blocks[blockIndex];
      if (!block) return;
      const lines = block.src.split("\n");
      let count = -1;
      for (let i = 0; i < lines.length; i++) {
        if (!TASK_RE.test(lines[i])) continue;
        count++;
        if (count !== ordinal) continue;
        lines[i] = lines[i].replace(
          TASK_RE,
          (_m, a, c, b) => a + (c === " " ? "x" : " ") + b,
        );
        onSaveBody(replaceBlock(body, block, lines.join("\n")));
        return;
      }
    },
    [blocks, body, onSaveBody],
  );

  // 内容ベースの安定 key。ブロックの追加/削除で index がずれても、内容が
  // 変わらないブロックは同じ key を保ち再マウントしない（削除時のちらつき防止）。
  const seen = new Map<string, number>();
  const keyOf = (src: string) => {
    const n = seen.get(src) ?? 0;
    seen.set(src, n + 1);
    return `${n}:${src}`;
  };

  return (
    <>
      {blocks.map((b) => {
        const key = keyOf(b.src);
        const isTable = isTableBlock(b.src);
        return editing?.index === b.index ? (
          <BlockSourceEditor
            key={key}
            src={b.src}
            clickX={editing.x}
            clickY={editing.y}
            onCommit={(s) => commit(b.index, s)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          // display:contents で余白（prose の縦リズム）を崩さずに
          // ダブルクリックだけ拾う
          <div
            key={key}
            className="mg-block"
            onDoubleClick={
              // mermaid・テーブルはブロック全体編集の対象外（テーブルはセル単位）。
              // 箇条書きは項目単位で編集するが、項目の範囲が取れない場合は li 側が
              // イベントを止めないので、ここに落ちてリスト全体の編集になる。
              isMermaidBlock(b.src) || isTable
                ? undefined
                : (e) =>
                    setEditing({ index: b.index, x: e.clientX, y: e.clientY })
            }
          >
            <Markdown
              body={b.src}
              editorial={editorial}
              blockIndex={b.index}
              onToggleTask={toggleTask}
              onEditCell={isTable ? handleEditCell : undefined}
              editCell={
                editingCell?.blockIndex === b.index
                  ? {
                      cellStart: editingCell.cellStart,
                      value: editingCell.value,
                    }
                  : undefined
              }
              onCellCommit={
                editingCell?.blockIndex === b.index ? commitCell : undefined
              }
              onCellCancel={
                editingCell?.blockIndex === b.index ? cancelCell : undefined
              }
              onEditItem={handleEditItem}
              editItem={
                editingItem?.blockIndex === b.index
                  ? { anchor: editingItem.anchor, value: editingItem.value }
                  : undefined
              }
              onItemCommit={
                editingItem?.blockIndex === b.index ? commitItem : undefined
              }
              onItemCancel={
                editingItem?.blockIndex === b.index ? cancelItem : undefined
              }
            />
          </div>
        );
      })}
    </>
  );
}
