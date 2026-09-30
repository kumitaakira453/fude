import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { colName, CSV_TONES, csvLines, csvRows, delimOf } from "../lib/csv";
import { readText } from "../lib/fsAccess";
import { measureText, widestText } from "../lib/textWidth";
import { assetVersionAtom, csvViewAtom, csvWidthsAtom } from "../state/atoms";
import { SourceView } from "./SourceView";
import { ValuePeek } from "./ValuePeek";

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
          rows && <CsvTable rows={rows} abs={abs} />
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
// つまみで変えられる幅の上下（px）。中身から決める幅（CELL_MAX まで）より広くできる。
const GRIP_MIN = 32;
const GRIP_MAX = 1600;
// 幅を決めるのに見る行の数。これより下に長い値があれば、その升目は … で切れる。
const SAMPLE_ROWS = 20_000;

// 表。上に列の名前（A・B・…）、その下に 1 行目（ヘッダー行）を固定し、
// 左に行番号を固定する。番号と列の名前は字ではなく data-n から描く
// （⌘F の探し先や、選んで写した中身に混ざらない）。
function CsvTable({ rows, abs }: { rows: string[][]; abs: string }) {
  const head = rows[0] ?? [];
  const body = Math.max(0, rows.length - 1);
  const box = useRef<HTMLTableElement>(null);
  // 行の並びの上には、固定した 2 行（列の名前とヘッダー行）がある。
  const [start, end] = useVisibleRows(box, body, TABLE_ROW, TABLE_ROW * 2);

  const family = useMemo(() => getComputedStyle(document.body).fontFamily || "sans-serif", []);
  const font = `12.5px ${family}`;
  const bold = `600 12.5px ${family}`;
  const auto = useMemo(
    () =>
      head.map((h, c) => {
        const cells = rows.slice(1, SAMPLE_ROWS + 1).map((r) => r[c]);
        const w = Math.max(measureText(h, bold), widestText(cells, font));
        return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.ceil(w) + CELL_PAD));
      }),
    [rows, head, font, bold],
  );
  // 列の名前の右端のつまみで幅を変える。変えた幅はファイルごとに覚え、次に
  // 開いたときも同じ幅で出す。つまみを 2 度押すと、中身に合わせた幅へ戻す。
  const [saved, setSaved] = useAtom(csvWidthsAtom);
  const [drag, setDrag] = useState<{ col: number; w: number } | null>(null);
  const mine = saved[abs];
  const widths = auto.map((w, c) => (drag?.col === c ? drag.w : (mine?.[c] ?? w)));
  const resize = (e: React.MouseEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widths[col];
    let w = w0;
    const onMove = (m: MouseEvent) => {
      w = Math.round(Math.min(GRIP_MAX, Math.max(GRIP_MIN, w0 + m.clientX - x0)));
      setDrag({ col, w });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("mg-col-resizing");
      setDrag(null);
      if (w !== w0) setSaved((was) => ({ ...was, [abs]: { ...was[abs], [col]: w } }));
    };
    document.body.classList.add("mg-col-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const fit = (col: number) =>
    setSaved((was) => {
      const { [col]: _, ...rest } = was[abs] ?? {};
      const next = { ...was };
      if (Object.keys(rest).length) next[abs] = rest;
      else delete next[abs];
      return next;
    });
  const total = widths.reduce((a, b) => a + b, NO_WIDTH);

  // 選んでいる升目。row は rows の中の位置（0 がヘッダー行）。押すか矢印で
  // 動かす。Enter で升目の全文を小窓に出す（… で切れた値を読む。WKWebView は
  // title の吹き出しを出さない）。出したまま矢印で動かすと、小窓も付いてくる。
  const [sel, setSel] = useState<Cell | null>(null);
  const [peekOn, setPeekOn] = useState(false);
  const peekBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSel(null);
    setPeekOn(false);
  }, [rows]);

  // 選んだ升目が見える位置まで送る。見えている行だけを組むので、行の位置は
  // 要素からではなく行の番号から出す。上の 2 行と左の行番号は固定なので、
  // その下・右に来るように送る。
  const reveal = (c: Cell) => {
    const sc = box.current?.parentElement;
    if (!sc) return;
    const fixedTop = TABLE_ROW * 2;
    if (c.row > 0) {
      const top = fixedTop + (c.row - 1) * TABLE_ROW;
      if (top < sc.scrollTop + fixedTop) sc.scrollTop = top - fixedTop;
      else if (top + TABLE_ROW > sc.scrollTop + sc.clientHeight)
        sc.scrollTop = top + TABLE_ROW - sc.clientHeight;
    }
    const left = widths.slice(0, c.col).reduce((a, b) => a + b, NO_WIDTH);
    const right = left + widths[c.col];
    if (left < sc.scrollLeft + NO_WIDTH) sc.scrollLeft = left - NO_WIDTH;
    else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth;
  };

  const onCell = (e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("td[data-c], th[data-c]");
    if (!cell) return;
    box.current?.focus({ preventScroll: true });
    setSel({ row: Number(cell.dataset.r), col: Number(cell.dataset.c) });
  };

  const MOVES: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!sel || e.metaKey || e.ctrlKey || e.altKey) return;
    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      const next = {
        row: Math.min(rows.length - 1, Math.max(0, sel.row + move[0])),
        col: Math.min(head.length - 1, Math.max(0, sel.col + move[1])),
      };
      setSel(next);
      reveal(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPeekOn((on) => !on);
    } else if (e.key === "Escape") {
      // 小窓が出ていれば小窓だけ、出ていなければ選択を外す。
      if (peekOn) setPeekOn(false);
      else setSel(null);
    }
  };

  // 表と小窓の外を押したら、選択を外す。
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (box.current?.contains(t) || peekBox.current?.contains(t)) return;
      setSel(null);
      setPeekOn(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [sel]);

  const on = (r: number, c: number) =>
    sel && sel.row === r && sel.col === c ? "is-sel" : undefined;
  const peek = peekOn ? sel : null;

  if (!rows[0]) return null;
  return (
    <>
      <table
        ref={box}
        tabIndex={0}
        className="mg-csv-table"
        style={{ width: total }}
        onClick={onCell}
        onKeyDown={onKey}
      >
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
              <th key={i} className={`mg-csv-c${i % CSV_TONES}`} data-n={colName(i)}>
                <span
                  className="mg-csv-grip"
                  onMouseDown={(e) => resize(e, i)}
                  onDoubleClick={() => fit(i)}
                />
              </th>
            ))}
          </tr>
          <tr className="mg-csv-head">
            <th className="mg-csv-no" data-n={1} />
            {head.map((v, i) => (
              <th key={i} data-r={0} data-c={i} className={on(0, i)}>
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
            // 1 行おきに地を変える。見えている行だけを組むので、何行目かは
            // 組んだ並びの中の位置ではなく、表の中の位置で決める。
            <tr key={start + n} className={(start + n) % 2 === 1 ? "is-even" : undefined}>
              <th className="mg-csv-no" data-n={start + n + 2} />
              {row.map((v, i) => (
                <td key={i} data-r={start + n + 1} data-c={i} className={on(start + n + 1, i)}>
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
      {peek && (
        <ValuePeek
          boxRef={peekBox}
          anchor={() => box.current?.querySelector(`[data-r="${peek.row}"][data-c="${peek.col}"]`) ?? null}
          frame={() => box.current?.parentElement?.getBoundingClientRect()}
          watch={`${peek.row},${peek.col}`}
          label={`${colName(peek.col)}${peek.row + 1}`}
          value={rows[peek.row]?.[peek.col] ?? ""}
          onClose={() => {
            setPeekOn(false);
            box.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

interface Cell {
  row: number;
  col: number;
}
