import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { colName, CSV_TONES } from "../lib/csv";
import { isActive, type ColFilter, type ColSort, type Filters } from "../lib/csvFilter";
import { measureText, widestText } from "../lib/textWidth";
import { csvWidthsAtom } from "../state/atoms";
import { CsvFilterPop } from "./CsvFilterPop";
import { Icon } from "./Icon";
import { ValuePeek } from "./ValuePeek";

// 表の行の高さ（px）。index.css の .mg-csv-table と対にする。
export const TABLE_ROW = 26;

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
export function CsvTable({
  rows,
  abs,
  box,
  sel,
  onSelect: setSel,
  onUndo,
  onRedo,
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
  onRedo: () => void;
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
    if (movedRef.current) return;
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
    if (e.metaKey && !e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
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

  // 列の名前か見出しを掴んで、左右へ動かす。HTML5 のドラッグは WebKit では表の
  // 升目から始まらないので、幅のつまみと同じくマウスの動きで組む。4px 動くまでは
  // 押しただけ（升目を選ぶ）として扱う。落とす先は、マウスの位置と列の境目
  // （幅の累計）から決める。Esc で取りやめる。
  const [moving, setMoving] = useState<{
    from: number;
    // 落とす先の境目（この番号の列の手前。末尾なら列の数）。
    gap: number;
    // 影の左端・表示の上端と高さ（送る枠の中の位置）。
    left: number;
    top: number;
    height: number;
  } | null>(null);
  const movedRef = useRef(false);
  const grab = (e: React.MouseEvent, i: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".mg-csv-funnel, .mg-csv-grip, .mg-csv-unhide")) return;
    const sc = box.current?.parentElement;
    const table = box.current;
    if (!sc || !table) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const ws = widths;
    const edges = ws.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [NO_WIDTH]);
    // 掴んだ位置と列の左端の差。影はこの差を保って動く。
    const offset = x0 - table.getBoundingClientRect().left - edges[i];
    let started = false;
    let gap = -1;
    const gapAt = (x: number) => {
      const at = x - table.getBoundingClientRect().left;
      for (let k = 0; k < ws.length; k++) if (at < edges[k] + ws[k] / 2) return k;
      return ws.length;
    };
    const onMoveMouse = (m: MouseEvent) => {
      if (!started) {
        if (Math.abs(m.clientX - x0) < 4 && Math.abs(m.clientY - y0) < 4) return;
        started = true;
        document.body.classList.add("mg-col-moving");
        window.getSelection()?.removeAllRanges();
      }
      const fr = sc.getBoundingClientRect();
      // 送る枠の左右の端に寄せたら、その向きへ送る。
      if (m.clientX > fr.right - 32) sc.scrollLeft += 24;
      else if (m.clientX < fr.left + NO_WIDTH + 32) sc.scrollLeft -= 24;
      gap = gapAt(m.clientX);
      setMoving({
        from: i,
        gap,
        left: m.clientX - table.getBoundingClientRect().left - offset,
        top: sc.scrollTop,
        height: sc.clientHeight,
      });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("mousemove", onMoveMouse);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onEsc, true);
      document.body.classList.remove("mg-col-moving");
      setMoving(null);
      if (!started) return;
      // 放したあとに来る click で、升目を選ばない。
      movedRef.current = true;
      window.setTimeout(() => (movedRef.current = false), 0);
      if (!commit || gap < 0) return;
      const to = gap > i ? gap - 1 : gap;
      if (to !== i) onMove(i, to);
    };
    const onUp = () => finish(true);
    const onEsc = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.preventDefault();
      k.stopPropagation();
      finish(false);
    };
    window.addEventListener("mousemove", onMoveMouse);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onEsc, true);
  };
  const dragClass = (i: number) => (moving?.from === i ? "is-dragging" : "");

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
                onMouseDown={(e) => grab(e, i)}
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
                  onMouseDown={(e) => grab(e, i)}
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
      {moving && (
        <>
          <div
            className="mg-csv-ghost"
            style={{ left: moving.left, top: moving.top, height: moving.height, width: widths[moving.from] }}
            aria-hidden
          >
            <span>{head[moving.from] || colName(moving.from)}</span>
          </div>
          <div
            className="mg-csv-dropline"
            style={{
              left: widths.slice(0, moving.gap).reduce((a, b) => a + b, NO_WIDTH) - 1,
              top: moving.top,
              height: moving.height,
            }}
            aria-hidden
          />
        </>
      )}
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

export interface Cell {
  row: number;
  col: number;
}
