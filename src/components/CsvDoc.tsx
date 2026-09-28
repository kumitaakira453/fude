import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { colName, CSV_TONES, csvLines, csvRows, delimOf } from "../lib/csv";
import { readText } from "../lib/fsAccess";
import { measureText, widestText } from "../lib/textWidth";
import { assetVersionAtom, csvViewAtom } from "../state/atoms";
import { SourceView } from "./SourceView";

// CSV・TSV を読む。開いたときは原文を列ごとの色で出し、釦か ⌘⇧V で
// 表（Excel の見た目）に替える。どちらで見るかは全体で 1 つ覚える。
//
// 書き換えはしない（ほかの字のファイルと同じく読む面だけ）。
//
// どちらの見た目も、組むのは見えている行とその前後だけ（useVisibleRows）。

// 表の行の高さ（px）。index.css の .mg-csv-table と対にする。
const TABLE_ROW = 26;

export function CsvDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [view, setView] = useAtom(csvViewAtom);
  const [text, setText] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const delim = delimOf(abs) ?? ",";

  useEffect(() => {
    let alive = true;
    setText(null);
    setLost(false);
    void readText(abs).then(
      (read) => alive && setText(read),
      () => alive && setLost(true),
    );
    return () => {
      alive = false;
    };
  }, [abs, version]);

  const rows = useMemo(() => (text === null ? null : csvRows(text, delim)), [text, delim]);
  const lines = useMemo(
    () => (text === null || view !== "rainbow" ? null : csvLines(text, delim)),
    [text, delim, view],
  );
  const table = view === "table";
  const width = rows?.[0]?.length ?? 0;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 端で勢いよく送っても弾ませない。弾むと固定した見出しごと枠がずれ、
          枠の外の下地が見える。 */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        {lost ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            このファイルは字として読めませんでした
          </div>
        ) : table ? (
          rows && <CsvTable rows={rows} />
        ) : (
          text !== null && lines && <SourceView code={text} lang={null} painted={lines} />
        )}
      </div>
      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">
          {lost || !rows
            ? ""
            : `${delim === "\t" ? "TSV" : "CSV"} · ${rows.length.toLocaleString()} 行 × ${width.toLocaleString()} 列`}
        </span>
        {!lost && (
          <button
            type="button"
            className={`mg-small${table ? " is-on" : ""}`}
            title="見た目を切り替える（⌘⇧V）"
            onClick={() => setView(table ? "rainbow" : "table")}
          >
            {table ? "原文で見る" : "表で見る"}
          </button>
        )}
      </div>
    </div>
  );
}

// 升目の幅の上下（px）。
const CELL_MIN = 56;
const CELL_MAX = 320;
const CELL_PAD = 20;
const NO_WIDTH = 52;
// 幅を決めるのに見る行の数。これより下に長い値があれば、その升目は … で切れる。
const SAMPLE_ROWS = 20_000;

// 表。上に列の名前（A・B・…）、その下に 1 行目（ヘッダー行）を固定し、
// 左に行番号を固定する。番号と列の名前は字ではなく data-n から描く
// （⌘F の探し先や、選んで写した中身に混ざらない）。
function CsvTable({ rows }: { rows: string[][] }) {
  const head = rows[0] ?? [];
  const body = Math.max(0, rows.length - 1);
  const box = useRef<HTMLTableElement>(null);
  // 行の並びの上には、固定した 2 行（列の名前とヘッダー行）がある。
  const [start, end] = useVisibleRows(box, body, TABLE_ROW, TABLE_ROW * 2);

  const widths = useMemo(() => {
    const family = getComputedStyle(document.body).fontFamily;
    const font = `12.5px ${family || "sans-serif"}`;
    const bold = `600 12.5px ${family || "sans-serif"}`;
    return head.map((h, c) => {
      const cells = rows.slice(1, SAMPLE_ROWS + 1).map((r) => r[c]);
      const w = Math.max(measureText(h, bold), widestText(cells, font));
      return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.ceil(w) + CELL_PAD));
    });
  }, [rows, head]);
  const total = widths.reduce((a, b) => a + b, NO_WIDTH);

  if (!rows[0]) return null;
  return (
    <table ref={box} className="mg-csv-table" style={{ width: total }}>
      <colgroup>
        <col style={{ width: NO_WIDTH }} />
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr className="mg-csv-letters">
          <th className="mg-csv-no" />
          {head.map((_, i) => (
            <th key={i} className={`mg-csv-c${i % CSV_TONES}`} data-n={colName(i)} />
          ))}
        </tr>
        <tr className="mg-csv-head">
          <th className="mg-csv-no" data-n={1} />
          {head.map((v, i) => (
            <th key={i} title={v}>
              {v}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {start > 0 && (
          <tr className="mg-csv-gap" style={{ height: start * TABLE_ROW }}>
            <td colSpan={head.length + 1} />
          </tr>
        )}
        {rows.slice(start + 1, end + 1).map((row, n) => (
          <tr key={start + n}>
            <th className="mg-csv-no" data-n={start + n + 2} />
            {row.map((v, i) => (
              <td key={i} title={v}>
                {v}
              </td>
            ))}
          </tr>
        ))}
        {end < body && (
          <tr className="mg-csv-gap" style={{ height: (body - end) * TABLE_ROW }}>
            <td colSpan={head.length + 1} />
          </tr>
        )}
      </tbody>
    </table>
  );
}
