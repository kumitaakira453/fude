import { useMemo, useState } from "react";
import { replaceBlock, splitBlocks } from "../lib/blocks";
import { BlockSourceEditor } from "./BlockSourceEditor";
import { Markdown } from "./Markdown";

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
  const [editing, setEditing] = useState<number | null>(null);

  const commit = (index: number, newSrc: string) => {
    setEditing(null);
    const block = blocks[index];
    if (!block || newSrc === block.src) return;
    onSaveBody(replaceBlock(body, block, newSrc));
  };

  return (
    <>
      {blocks.map((b) =>
        editing === b.index ? (
          <BlockSourceEditor
            key={b.index}
            src={b.src}
            onCommit={(s) => commit(b.index, s)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          // display:contents で余白（prose の縦リズム）を崩さずに
          // ダブルクリックだけ拾う
          <div
            key={b.index}
            className="mg-block"
            onDoubleClick={() => setEditing(b.index)}
          >
            <Markdown body={b.src} editorial={editorial} />
          </div>
        ),
      )}
    </>
  );
}
