import { useAtom, useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import {
  colName,
  CSV_TONES,
  csvLines,
  csvRows,
  delimOf,
  movedIndex,
  moveColumn,
  setCell,
} from "../lib/csv";
import {
  isActive,
  loadView,
  moveStoredView,
  shownRows,
  storeView,
  type ColFilter,
  type ColSort,
  type Filters,
} from "../lib/csvFilter";
import { readText, writeFile } from "../lib/fsAccess";
import { measureText, widestText } from "../lib/textWidth";
import {
  assetVersionAtom,
  csvFiltersAtom,
  csvViewAtom,
  csvWidthsAtom,
  savingCountAtom,
} from "../state/atoms";
import { CsvCellBar } from "./CsvCellBar";
import { CsvFilterPop } from "./CsvFilterPop";
import { Icon } from "./Icon";
import { SourceView } from "./SourceView";
import { ValuePeek } from "./ValuePeek";

// CSV・TSV を読む。開いたときは原文を列ごとの色で出し、釦か ⌘⇧V で
// 表（Excel の見た目）に替える。どちらで見るかは全体で 1 つ覚える。
//
// 表では、上の欄で選んだ升目の値を直せる。書き戻すのはその値の原文だけで、
// ほかの値の囲みや改行の字は変えない（setCell）。
//
// どちらの見た目も、組むのは見えている行とその前後だけ（useVisibleRows）。

// 表の行の高さ（px）。index.css の .mg-csv-table と対にする。
const TABLE_ROW = 26;
// 列を掴んで動かすときのデータの型。タブや木のドラッグとは混ぜない。
const COL_DRAG = "application/x-fude-csvcol";

export function CsvDoc({ abs }: { abs: string }) {
  const store = useStore();
  const version = useAtomValue(assetVersionAtom);
  const [view, setView] = useAtom(csvViewAtom);
  const [text, setText] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [failed, setFailed] = useState(false);
  const delim = delimOf(abs) ?? ",";
  const textRef = useRef(text);
  textRef.current = text;
  // ディスクにあるはずの中身（読んだもの・自分が書いたもの）。読み直したものが
  // これと同じなら、自分の保存が返ってきただけなので組み直さない。
  const savedRef = useRef<string | null>(null);
  // このファイルを開いている間の書き換えの前の原文。⌘Z で 1 つずつ戻す。列を
  // 動かしたときは、列幅・絞り込みを元の列へ付け替える手順も一緒に積む。
  const undo = useRef<{ text: string; restore?: () => void }[]>([]);
  const [sel, setSel] = useState<Cell | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const barRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(null);
    setSel(null);
    setFailed(false);
    savedRef.current = null;
    undo.current = [];
  }, [abs]);

  useEffect(() => {
    let alive = true;
    setLost(false);
    void readText(abs).then(
      (read) => {
        if (!alive || read === savedRef.current || read === textRef.current) return;
        // ほかで書き換えられた。手元の戻し先はその前の中身なので捨てる。
        if (textRef.current !== null) undo.current = [];
        savedRef.current = read;
        setText(read);
      },
      () => alive && setLost(true),
    );
    return () => {
      alive = false;
    };
  }, [abs, version]);

  const write = (next: string) => {
    setText(next);
    setFailed(false);
    savedRef.current = next;
    store.set(savingCountAtom, (n) => n + 1);
    void writeFile(abs, next)
      .catch(() => {
        savedRef.current = null;
        setFailed(true);
      })
      .finally(() => store.set(savingCountAtom, (n) => n - 1));
  };
  const edit = (row: number, col: number, value: string) => {
    if (text === null) return;
    const next = setCell(text, delim, row, col, value);
    if (next === text) return;
    undo.current.push({ text });
    write(next);
  };
  const undoLast = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    write(prev.text);
    prev.restore?.();
  };

  // 列を動かしたら、列に付いているもの（幅・絞り込み・選んでいる升目）も付け替える。
  const remap = (where: (col: number) => number) => {
    store.set(csvWidthsAtom, (was) => {
      const mine = was[abs];
      if (!mine) return was;
      const next: Record<number, number> = {};
      for (const [c, w] of Object.entries(mine)) next[where(Number(c))] = w;
      return { ...was, [abs]: next };
    });
    store.set(csvFiltersAtom, (was) => (was[abs] ? { ...was, [abs]: moveStoredView(was[abs], where) } : was));
    setSel((was) => was && { row: was.row, col: where(was.col) });
  };
  const move = (from: number, to: number) => {
    if (text === null) return;
    const next = moveColumn(text, delim, from, to);
    if (next === text) return;
    undo.current.push({ text, restore: () => remap((i) => movedIndex(i, to, from)) });
    write(next);
    remap((i) => movedIndex(i, from, to));
  };

  const rows = useMemo(() => (text === null ? null : csvRows(text, delim)), [text, delim]);
  const lines = useMemo(
    () => (text === null || view !== "rainbow" ? null : csvLines(text, delim)),
    [text, delim, view],
  );
  const table = view === "table";
  const width = rows?.[0]?.length ?? 0;
  // ほかで書き換えられて行や列が減ったら、選択を外したことにする。
  const cell = sel && rows && sel.row < rows.length && sel.col < width ? sel : null;

  // 列ごとの絞り込みと並べ替え。ファイルごとに覚え、別のファイルへ移って
  // 戻っても、起動し直しても同じ絞り込みで出す。
  const [savedViews, setSavedViews] = useAtom(csvFiltersAtom);
  const header = rows?.[0];
  const { filters, sort } = useMemo(
    () => loadView(header ? savedViews[abs] : undefined, header ?? []),
    [savedViews, abs, header],
  );
  const save = (nextFilters: Filters, nextSort: ColSort | null) => {
    if (!header) return;
    const next = storeView(nextFilters, nextSort, header);
    setSavedViews(({ [abs]: _, ...rest }) => (next ? { ...rest, [abs]: next } : rest));
  };
  const order = useMemo(
    () => (rows ? shownRows(rows, filters, sort) : []),
    [rows, filters, sort],
  );
  const narrowed = table && Object.values(filters).some(isActive);
  const all = Math.max(0, (rows?.length ?? 0) - 1);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 端で勢いよく送っても弾ませない。弾むと固定した見出しごと枠がずれ、
          枠の外の下地が見える。 */}
      {table && rows && !lost && (
        <CsvCellBar
          cell={cell}
          value={cell ? (rows[cell.row]?.[cell.col] ?? "") : ""}
          inputRef={barRef}
          onCommit={(value) => cell && edit(cell.row, cell.col, value)}
          onDone={() => tableRef.current?.focus({ preventScroll: true })}
        />
      )}
      <div className="relative min-h-0 flex-1 overflow-auto overscroll-none">
        {lost ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            このファイルは字として読めませんでした
          </div>
        ) : table ? (
          rows && (
            <CsvTable
              rows={rows}
              abs={abs}
              box={tableRef}
              sel={cell}
              onSelect={setSel}
              onUndo={undoLast}
              onMove={move}
              onEditCell={() => barRef.current?.focus()}
              order={order}
              filters={filters}
              sort={sort}
              onFilter={(col, next) => {
                const { [col]: _, ...rest } = filters;
                save(next ? { ...rest, [col]: next } : rest, sort);
              }}
              onSort={(next) => save(filters, next)}
            />
          )
        ) : (
          text !== null && lines && <SourceView code={text} lang={null} painted={lines} />
        )}
      </div>
      <div className="mg-imgdoc-bar">
        {failed && <span className="mg-csv-failed">保存できませんでした</span>}
        <span className="mg-imgdoc-size">
          {lost || !rows
            ? ""
            : `${delim === "\t" ? "TSV" : "CSV"} · ${rows.length.toLocaleString()} 行 × ${width.toLocaleString()} 列`}
        </span>
        {narrowed && (
          <>
            <span className="mg-imgdoc-scale">
              {order.length.toLocaleString()} / {all.toLocaleString()} 行
            </span>
            <button type="button" className="mg-small" onClick={() => save({}, sort)}>
              絞り込みを解除
            </button>
          </>
        )}
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
// 選んだ升目を広げるとき、表の見えている右端から空ける幅（px）。
const GROW_GAP = 8;

// 表。上に列の名前（A・B・…）、その下に 1 行目（ヘッダー行）を固定し、
// 左に行番号を固定する。番号と列の名前は字ではなく data-n から描く
// （⌘F の探し先や、選んで写した中身に混ざらない）。
function CsvTable({
  rows,
  abs,
  box,
  sel,
  onSelect: setSel,
  onUndo,
  onEditCell,
  onMove,
  order,
  filters,
  sort,
  onFilter,
  onSort,
}: {
  rows: string[][];
  abs: string;
  box: RefObject<HTMLTableElement>;
  // 選んでいる升目。row は rows の中の位置（0 がヘッダー行）。
  sel: Cell | null;
  onSelect: (next: Cell | null) => void;
  onUndo: () => void;
  // F2。上の欄へ移って値を直す。
  onEditCell: () => void;
  // 列 from を位置 to へ動かす（見出しを掴んで落とす）。
  onMove: (from: number, to: number) => void;
  // 出す行の並び（rows の中の位置）。絞り込みと並べ替えを当てた後のもの。
  order: number[];
  filters: Filters;
  sort: ColSort | null;
  onFilter: (col: number, next: ColFilter | null) => void;
  onSort: (next: ColSort | null) => void;
}) {
  const head = rows[0] ?? [];
  const body = order.length;
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

  // 升目は押すか矢印で選ぶ。Enter で升目の全文を小窓に出す（… で切れた値を
  // 読む。WKWebView は title の吹き出しを出さない）。出したまま矢印で動かすと、
  // 小窓も付いてくる。
  const [peekOn, setPeekOn] = useState(false);
  const peekBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sel) setPeekOn(false);
  }, [sel]);

  // 選んだ升目が見える位置まで送る。見えている行だけを組むので、行の位置は
  // 要素からではなく行の番号から出す。上の 2 行と左の行番号は固定なので、
  // その下・右に来るように送る。
  const reveal = (c: Cell) => {
    const sc = box.current?.parentElement;
    if (!sc) return;
    const fixedTop = TABLE_ROW * 2;
    const at = order.indexOf(c.row);
    if (c.row > 0 && at >= 0) {
      const top = fixedTop + at * TABLE_ROW;
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
    if (e.metaKey && !e.shiftKey && !e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      onUndo();
      return;
    }
    if (!sel || e.metaKey || e.ctrlKey || e.altKey) return;
    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      // 上下は出している並びの中で動く（0 は見出し行）。
      const at = sel.row === 0 ? -1 : order.indexOf(sel.row);
      const to = Math.min(order.length - 1, Math.max(-1, at + move[0]));
      const next = {
        row: to < 0 ? 0 : order[to],
        col: Math.min(head.length - 1, Math.max(0, sel.col + move[1])),
      };
      setSel(next);
      reveal(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPeekOn((on) => !on);
    } else if (e.key === "F2") {
      e.preventDefault();
      setPeekOn(false);
      onEditCell();
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
      // 上の欄で値を直している間も、選んだままにする。
      if ((t instanceof Element ? t : t.parentElement)?.closest(".mg-csv-bar")) return;
      setSel(null);
      setPeekOn(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [sel, box, setSel]);

  // 列の名前か見出しを掴んで、左右へ動かす。落とす先は、指している列の
  // 真ん中より左ならその手前、右ならその後ろ。
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ col: number; side: "before" | "after" } | null>(null);
  const sideOf = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "before" : "after";
  };
  const dragProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(COL_DRAG, String(i));
      e.dataTransfer.effectAllowed = "move";
      setDragCol(i);
    },
    onDragEnd: () => {
      setDragCol(null);
      setDrop(null);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(COL_DRAG)) return;
      e.preventDefault();
      const side = sideOf(e);
      setDrop((was) => (was?.col === i && was.side === side ? was : { col: i, side }));
    },
    onDrop: (e: React.DragEvent) => {
      const from = Number(e.dataTransfer.getData(COL_DRAG));
      setDragCol(null);
      setDrop(null);
      if (Number.isNaN(from)) return;
      e.preventDefault();
      const gap = sideOf(e) === "before" ? i : i + 1;
      onMove(from, gap > from ? gap - 1 : gap);
    },
  });
  const dragClass = (i: number) =>
    [drop?.col === i ? `is-drop-${drop.side}` : "", dragCol === i ? "is-dragging" : ""]
      .filter(Boolean)
      .join(" ");

  // 選んでいる本文の升目が … で切れていたら、その升目から右へ広げた箱を重ねて
  // 全文を出す（列の幅は変えない）。広げるのは表の見えている右端までで、超える
  // 分と改行は折り返して下へ伸ばす。見出しの行は上に固定されていて送るとずれる
  // ので出さない（全文は上の欄で読める）。
  const [grow, setGrow] = useState<{ top: number; left: number; width: number } | null>(null);
  const growValue = sel && sel.row > 0 && !peekOn ? (rows[sel.row]?.[sel.col] ?? "") : null;
  const widthKey = widths.join(",");
  useLayoutEffect(() => {
    const sc = box.current?.parentElement;
    if (!sel || growValue === null || !sc) {
      setGrow(null);
      return;
    }
    const measure = () => {
      const cell = box.current?.querySelector(`td[data-r="${sel.row}"][data-c="${sel.col}"]`);
      const own = widths[sel.col];
      const natural = Math.ceil(measureText(growValue, font)) + CELL_PAD;
      if (!cell || (natural <= own && !growValue.includes("\n"))) {
        setGrow(null);
        return;
      }
      const cr = cell.getBoundingClientRect();
      const fr = sc.getBoundingClientRect();
      const next = {
        top: cr.top - fr.top + sc.scrollTop,
        left: cr.left - fr.left + sc.scrollLeft,
        width: Math.max(own, Math.min(natural, fr.right - cr.left - GROW_GAP)),
      };
      setGrow((was) =>
        was && was.top === next.top && was.left === next.left && was.width === next.width ? was : next,
      );
    };
    measure();
    sc.addEventListener("scroll", measure, { passive: true });
    return () => sc.removeEventListener("scroll", measure);
    // widths は描くたびに作り直すので、中身（widthKey）で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, growValue, widthKey, font, start, end, box]);

  // 開いている絞り込みの小窓。押した ▽ の位置に出す。
  const [asking, setAsking] = useState<{ col: number; at: DOMRect } | null>(null);
  const closeAsk = useCallback(() => setAsking(null), []);

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
              <th
                key={i}
                className={`mg-csv-c${i % CSV_TONES} ${dragClass(i)}`.trim()}
                data-n={colName(i)}
                {...dragProps(i)}
              >
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
            {head.map((v, i) => {
              const filtered = isActive(filters[i]);
              const sorted = sort?.col === i ? sort.dir : null;
              const narrowing = filtered || sorted !== null;
              // 入口は漏斗で示す（∨ は開け閉めの印に見える）。並べ替えだけの
              // 列は向きの矢印にして、どちら向きかも読めるようにする。
              const mark =
                sorted && !filtered
                  ? sorted === "asc"
                    ? "arrow_upward"
                    : "arrow_downward"
                  : "filter_list";
              return (
                <th
                  key={i}
                  data-r={0}
                  data-c={i}
                  className={[on(0, i), dragClass(i)].filter(Boolean).join(" ") || undefined}
                  {...dragProps(i)}
                >
                  <span className="mg-csv-hcell">
                    <span className="mg-csv-hname">{v}</span>
                    <button
                      type="button"
                      className={`mg-csv-funnel${narrowing ? " is-on" : ""}`}
                      title={`${v || colName(i)} の絞り込み・並べ替え`}
                      aria-pressed={narrowing}
                      onClick={(e) => {
                        e.stopPropagation();
                        const at = e.currentTarget.getBoundingClientRect();
                        setAsking((was) => (was?.col === i ? null : { col: i, at }));
                      }}
                    >
                      <Icon name={mark} size={12} />
                    </button>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr className="mg-csv-gap" style={{ height: start * TABLE_ROW }}>
              <td colSpan={head.length + 1} />
            </tr>
          )}
          {order.slice(start, end).map((r, n) => (
            // 1 行おきに地を変える。見えている行だけを組むので、何行目かは
            // 組んだ並びの中の位置ではなく、出している並びの中の位置で決める。
            // 行番号は元の行のまま出す（絞り込んだとき、どの行が残ったか分かる）。
            <tr key={r} className={(start + n) % 2 === 1 ? "is-even" : undefined}>
              <th className="mg-csv-no" data-n={r + 1} />
              {rows[r].map((v, i) => (
                <td key={i} data-r={r} data-c={i} className={on(r, i)}>
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
      {grow && growValue !== null && (
        <div className="mg-csv-grow" style={grow} aria-hidden>
          {growValue}
        </div>
      )}
      {asking && (
        <CsvFilterPop
          rows={rows}
          col={asking.col}
          name={head[asking.col] || colName(asking.col)}
          anchor={asking.at}
          filter={filters[asking.col]}
          sort={sort}
          onFilter={(next) => onFilter(asking.col, next)}
          onSort={onSort}
          onClose={closeAsk}
        />
      )}
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
