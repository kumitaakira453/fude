import { useEffect, useState, type RefObject } from "react";
import { colName } from "../lib/csv";

// CSV の表の上の欄。選んでいる升目の位置と中身を出し、直して Enter で書き戻す
// （Excel の数式バーと同じ置き方）。Esc か、欄の外へ移ると直す前に戻す。
// 改行は ⇧Enter・⌥Enter で入れる。

// 欄が伸びる行の数の上限。これより長い値は欄の中で送る。
const MAX_LINES = 6;

export function CsvCellBar({
  cell,
  value,
  inputRef,
  onCommit,
  onDone,
}: {
  cell: { row: number; col: number } | null;
  value: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  onCommit: (value: string) => void;
  // 確定・取り消しのあと、表へ戻す。
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, cell?.row, cell?.col]);

  const lines = Math.min(MAX_LINES, draft.split("\n").length);
  return (
    <div className="mg-csv-bar">
      <span className="mg-csv-bar-at">{cell ? `${colName(cell.col)}${cell.row + 1}` : ""}</span>
      <textarea
        ref={inputRef}
        className="mg-csv-bar-input"
        rows={lines}
        value={cell ? draft : ""}
        disabled={!cell}
        spellCheck={false}
        aria-label="選んでいる升目の値"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(value)}
        onKeyDown={(e) => {
          // 変換を確定する Enter・Esc は変換のもの。
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && e.altKey) {
            e.preventDefault();
            e.currentTarget.setRangeText("\n", e.currentTarget.selectionStart, e.currentTarget.selectionEnd, "end");
            setDraft(e.currentTarget.value);
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (cell && draft !== value) onCommit(draft);
            onDone();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            onDone();
          }
        }}
      />
    </div>
  );
}
