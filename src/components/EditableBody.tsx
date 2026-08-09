import { useCallback, useMemo, useState } from "react";
import { replaceBlock, splitBlocks } from "../lib/blocks";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { Markdown } from "./Markdown";

// タスク行（- [ ] / 1. [x] など）
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

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

  const commit = (index: number, newSrc: string) => {
    setEditing(null);
    const block = blocks[index];
    if (!block || newSrc === block.src) return;
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
            onDoubleClick={(e) =>
              setEditing({ index: b.index, x: e.clientX, y: e.clientY })
            }
          >
            <Markdown
              body={b.src}
              editorial={editorial}
              blockIndex={b.index}
              onToggleTask={toggleTask}
            />
          </div>
        );
      })}
    </>
  );
}
