import type { RefObject } from "react";
import { colName } from "../lib/csv";

// CSV の表の上の欄。選んでいる升目の位置と値を出す（Google スプレッドシートの
// 上の欄と同じ置き方）。押せばいつでも直せ、打った字は升目の中の欄にもその場で
// 映る（直している値 draft を表と分け合う）。Enter で確定してその場に残り、Tab で
// 確定して右へ、Esc で直す前に戻す。改行は ⌥Enter で入れる。

// 欄が伸びる行の数の上限。これより長い値は欄の中で送る。
const MAX_LINES = 6;

export function CsvCellBar({
  cell,
  value,
  draft,
  inputRef,
  onDraft,
  onCommit,
  onCancel,
}: {
  cell: { row: number; col: number } | null;
  // 升目の今の値。
  value: string;
  // 直している値。null なら直していない。
  draft: string | null;
  inputRef: RefObject<HTMLTextAreaElement>;
  onDraft: (next: string) => void;
  // 確定する。tab なら確定して右（⇧ で左）へ移る。
  onCommit: (value: string, tab?: 1 | -1) => void;
  onCancel: () => void;
}) {
  const shown = draft ?? value;
  const lines = Math.min(MAX_LINES, shown.split("\n").length);
  return (
    <div className="mg-csv-bar">
      <span className="mg-csv-bar-at">{cell ? `${colName(cell.col)}${cell.row + 1}` : ""}</span>
      <textarea
        ref={inputRef}
        className="mg-csv-bar-input"
        rows={lines}
        value={cell ? shown : ""}
        disabled={!cell}
        spellCheck={false}
        aria-label="選んでいる升目の値"
        onFocus={() => {
          if (draft === null) onDraft(value);
        }}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          // 変換を確定する Enter・Esc は変換のもの。
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && e.altKey) {
            e.preventDefault();
            e.currentTarget.setRangeText("\n", e.currentTarget.selectionStart, e.currentTarget.selectionEnd, "end");
            onDraft(e.currentTarget.value);
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onCommit(shown);
          } else if (e.key === "Tab") {
            e.preventDefault();
            onCommit(shown, e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}
