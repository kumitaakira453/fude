import { useCallback, useMemo, useState } from "react";
import { replaceBlock, splitBlocks } from "../lib/blocks";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { type CellEditInfo, Markdown } from "./Markdown";

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

  // ダブルクリックされたセルの位置から編集対象を確定する
  const handleEditCell = useCallback(
    (info: CellEditInfo) => {
      const block = blocks[info.blockIndex];
      if (!block) return;
      const lineIndex = info.rowKind === "head" ? 0 : 2 + info.rowIndex;
      setEditing(null);
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
              // mermaid・テーブルはブロック全体編集の対象外。
              // テーブルはセル単位のインライン編集（handleEditCell）を使う。
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
            />
          </div>
        );
      })}
    </>
  );
}
