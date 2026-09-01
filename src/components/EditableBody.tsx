import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
  isMermaidBlock,
  itemTextRange,
  partIndexOf,
  replaceBlock,
  splitBlocks,
  splitRow,
  unitAt,
} from "../lib/blocks";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { Markdown } from "./Markdown";

// タスク行（- [ ] / 1. [x] など）
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// 漸進描画の粒度。最初のひと塊は 1 画面を埋める程度、以降はフレームごとに足す。
const FIRST_CHUNK = 24;
const NEXT_CHUNK = 40;

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

// レンダリング表示を保ったまま、ダブルクリックしたブロックだけをその場で
// 生ソース編集にする。編集対象以外は一切動かない（目線を動かさない）。
export function EditableBody({
  body,
  editorial,
  onSaveBody,
  editRequest,
  onDeleted,
}: {
  body: string;
  editorial: boolean;
  onSaveBody: (newBody: string) => void;
  // 外から編集を始める頼み。選択メニューの「編集する」が立てる。
  // nonce が変わるたびに読み直すので、同じ場所を続けて頼んでも効く。
  editRequest?: {
    blockIndex: number;
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null;
  // 削除したときに、消す前の本文を渡す（取り消しに使う）。
  onDeleted?: (previousBody: string) => void;
}) {
  const blocks = useMemo(() => splitBlocks(body), [body]);

  // 本文は先頭から順に描画する。全ブロックを 1 回のペイントで描くと、
  // 400 ブロックのファイルで初回描画に 900ms 以上かかって固まって見えるため、
  // 最初のひと塊だけ即座に出し、残りはフレームごとに足していく。
  // limit は初期値のみ（DocPane がファイルごとに key で貼り替える）。編集で
  // body が変わっても描き直しにはならない。
  const [limit, setLimit] = useState(FIRST_CHUNK);
  useEffect(() => {
    if (limit >= blocks.length) return;
    const id = requestAnimationFrame(() => {
      // 低優先度で足すことで、この間の入力やスクロールを妨げない
      startTransition(() =>
        setLimit((l) => Math.min(l + NEXT_CHUNK, blocks.length)),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [limit, blocks.length]);
  const shown = limit >= blocks.length ? blocks : blocks.slice(0, limit);
  // 編集対象ブロックと、開始時のダブルクリック座標（カーソル配置に使う）
  // 座標はカーソルの初期位置に使う。選択メニューから開いたときは持たない。
  const [editing, setEditing] = useState<{
    index: number;
    x: number | null;
    y: number | null;
  } | null>(null);
  // 編集中のテーブルセル（ブロック全体ではなく 1 セルだけ）
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  // 編集中の箇条書き項目（リスト全体ではなく 1 項目の本文だけ）
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);

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

  // 外からの頼みを受けて編集を始める。どの単位で開くかは選択された位置から
  // 決める（表ならセル、箇条書きなら項目、それ以外はブロック全体）。
  // mermaid は生ソースを編集させない（図が壊れる）。
  useEffect(() => {
    if (!editRequest) return;
    const block = blocks[editRequest.blockIndex];
    if (!block || isMermaidBlock(block.src)) return;
    setEditing(null);
    setEditingCell(null);
    setEditingItem(null);

    // 表のセル。目印は描画側が持っているソースオフセットなので、行と列は
    // そこから数え直せる。画面に出ている文字の位置から数えると、表では
    // 区切りがソースにしか無いぶんだけずれる。
    if (editRequest.cellStart !== undefined) {
      const unit = unitAt(block.src, editRequest.cellStart);
      if (unit.kind === "cell") {
        setEditingCell({
          blockIndex: block.index,
          cellStart: editRequest.cellStart,
          lineIndex: unit.lineIndex,
          colIndex: unit.colIndex,
          value: getCellValue(block.src, unit.lineIndex, unit.colIndex),
        });
        return;
      }
    }

    // 箇条書きの項目。マーカーが読めない行（継続行）はブロック全体に落ちる。
    if (editRequest.itemAnchor !== undefined) {
      const range = itemTextRange(block.src, editRequest.itemAnchor);
      if (range) {
        setEditingItem({
          blockIndex: block.index,
          anchor: editRequest.itemAnchor,
          start: range.start,
          end: range.end,
          value: block.src.slice(range.start, range.end),
        });
        return;
      }
    }

    setEditing({ index: block.index, x: null, y: null });
    // nonce だけを見る。同じ場所を続けて頼んでも開き直せる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.nonce]);

  // ブロックごと削除する。消す前の本文を渡して、取り消せるようにする。
  const remove = useCallback(
    (index: number) => {
      setEditing(null);
      const block = blocks[index];
      if (!block) return;
      const previous = body;
      onSaveBody(replaceBlock(body, block, ""));
      onDeleted?.(previous);
    },
    [blocks, body, onSaveBody, onDeleted],
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
      {shown.map((b) => {
        const key = keyOf(b.src);
        return editing?.index === b.index ? (
          <BlockSourceEditor
            key={key}
            src={b.src}
            clickX={editing.x}
            clickY={editing.y}
            onCommit={(s) => commit(b.index, s)}
            onCancel={() => setEditing(null)}
            onDelete={() => remove(b.index)}
          />
        ) : (
          // display:contents で余白（prose の縦リズム）を崩さずに
          // ダブルクリックだけ拾う
          <div
            key={key}
            className="mg-block"
            // 選択範囲からどのブロックかを辿るための目印。display:contents でも
            // 属性は残るので、キーボードでの選択でもブロックを特定できる。
            data-mg-block={b.index}
          >
            <Markdown
              body={b.src}
              editorial={editorial}
              blockIndex={b.index}
              onToggleTask={toggleTask}
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
