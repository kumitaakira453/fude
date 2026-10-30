import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { colName } from "../lib/csv";
import { isActive, numberOf, type ColFilter, type ColSort, type Filters } from "../lib/csvFilter";
import { measureText, widestText } from "../lib/textWidth";
import { csvWidthsAtom } from "../state/atoms";
import { CsvFilterPop } from "./CsvFilterPop";
import { Icon } from "./Icon";
import { ValuePeek } from "./ValuePeek";

// 表の行の高さと、列の名前の段の高さ（px）。index.css の .mg-csv-table と対にする。
export const TABLE_ROW = 26;
const LETTERS_ROW = 22;
// 本文の行の上に固定した 2 段（列の名前と見出しの行）の高さ。
const FIXED_TOP = LETTERS_ROW + TABLE_ROW;
// 見出しの右に置く絞り込みの印の分。中身から幅を決めるとき、見出しに足す。
const MARK_ROOM = 22;

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
//
// 値は Google スプレッドシートと同じ手で直す。選んだ升目の上に見えない入力欄
// （editor）を置いておき、表のキーはすべてそこで受ける。字が入るか日本語の変換が
// 始まったら書き換えを始め、欄を見せる。2 回押す・Enter・F2 は今の値を残して
// 始める。直している間は Enter で確定してその場に残り、Tab で確定して右へ、
// Esc で直す前に戻す。
export function CsvTable({
  rows,
  abs,
  sel,
  onSelect: setSel,
  draft,
  onDraft,
  onCommit,
  onCancel,
  onSetCell,
  editorRef,
  onUndo,
  onRedo,
  onMove,
  order,
  filters,
  sort,
  onFilter,
  onSort,
}: {
  rows: string[][];
  abs: string;
  // 選んでいる升目。row は rows の中の位置（0 がヘッダー行）。
  sel: Cell | null;
  onSelect: (next: Cell | null) => void;
  // 直している値。null なら直していない。
  draft: string | null;
  onDraft: (next: string | null) => void;
  // 直した値を確定する（選んでいる升目へ書く）。
  onCommit: (value: string) => void;
  onCancel: () => void;
  onSetCell: (cell: Cell, value: string) => void;
  editorRef: RefObject<HTMLTextAreaElement>;
  onUndo: () => void;
  onRedo: () => void;
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
  const box = useRef<HTMLTableElement>(null);
  const body = order.length;
  // 行の並びの上には、固定した 2 行（列の名前とヘッダー行）がある。
  const [start, end] = useVisibleRows(box, body, TABLE_ROW, FIXED_TOP);
  const editing = draft !== null;

  const family = useMemo(() => getComputedStyle(document.body).fontFamily || "sans-serif", []);
  const font = `12.5px ${family}`;
  const bold = `600 12.5px ${family}`;
  const auto = useMemo(
    () =>
      head.map((h, c) => {
        const cells = rows.slice(1, SAMPLE_ROWS + 1).map((r) => r[c]);
        const w = Math.max(measureText(h, bold) + MARK_ROOM, widestText(cells, font));
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

  // ⌘Enter で升目の全文を小窓に出す（改行の多い値・JSON を読む）。出したまま
  // 矢印で動かすと、小窓も付いてくる。
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
    const fixedTop = FIXED_TOP;
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

  const focusEditor = () => editorRef.current?.focus({ preventScroll: true });
  const cellOf = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest<HTMLElement>("td[data-c], th[data-c]");
  const onCell = (e: React.MouseEvent) => {
    if (movedRef.current) return;
    const cell = cellOf(e);
    if (!cell) return;
    const next = { row: Number(cell.dataset.r), col: Number(cell.dataset.c) };
    // 直している途中でほかの升目を押したら、確定してから移る。
    if (editing && draft !== null && (next.row !== sel?.row || next.col !== sel?.col)) onCommit(draft);
    setSel(next);
    focusEditor();
  };
  const onDouble = (e: React.MouseEvent) => {
    if (cellOf(e) && sel) begin(true);
  };
  // 直し始める。keep なら今の値を残し、そうでなければ空から。
  const begin = (keep: boolean) => {
    if (!sel) return;
    setPeekOn(false);
    onDraft(keep ? (rows[sel.row]?.[sel.col] ?? "") : "");
    focusEditor();
  };

  const MOVES: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  // 上下は出している並びの中で動く（0 は見出し行）。
  const step = (from: Cell, dr: number, dc: number): Cell => {
    const at = from.row === 0 ? -1 : order.indexOf(from.row);
    const to = Math.min(order.length - 1, Math.max(-1, at + dr));
    return {
      row: to < 0 ? 0 : order[to],
      col: Math.min(head.length - 1, Math.max(0, from.col + dc)),
    };
  };
  const go = (dr: number, dc: number) => {
    if (!sel) return;
    const next = step(sel, dr, dc);
    setSel(next);
    reveal(next);
  };
  const onKey = (e: React.KeyboardEvent) => {
    // 変換を確定する Enter・Esc は変換のもの。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (editing && draft !== null) {
      if (e.key === "Enter" && e.altKey) {
        // 値の中の改行。
        e.preventDefault();
        const ed = editorRef.current;
        if (!ed) return;
        ed.setRangeText("\n", ed.selectionStart, ed.selectionEnd, "end");
        onDraft(ed.value);
      } else if (e.key === "Enter" && !mod) {
        e.preventDefault();
        onCommit(draft);
      } else if (e.key === "Tab") {
        e.preventDefault();
        onCommit(draft);
        go(0, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      return;
    }
    if (e.metaKey && !e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (!sel) return;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      setPeekOn((on) => !on);
      return;
    }
    if (mod || e.altKey) return;
    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      go(move[0], move[1]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      go(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      begin(true);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if ((rows[sel.row]?.[sel.col] ?? "") !== "") onSetCell(sel, "");
    } else if (e.key === "Escape") {
      // 小窓が出ていれば小窓だけ、出ていなければ選択を外す。
      if (peekOn) setPeekOn(false);
      else setSel(null);
    }
  };

  // 表と小窓の外を押したら、直している値を確定して選択を外す。
  const grid = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (grid.current?.contains(t) || peekBox.current?.contains(t)) return;
      // 上の欄・列のメニューの中では、選んだままにする。
      if ((t instanceof Element ? t : t.parentElement)?.closest(".mg-csv-bar, .mg-csv-filter-pop")) return;
      if (draftRef.current !== null) onCommit(draftRef.current);
      setSel(null);
      setPeekOn(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [sel, setSel, onCommit]);

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
    if ((e.target as HTMLElement).closest(".mg-csv-funnel, .mg-csv-grip, .mg-csv-unhide, .mg-csv-colmenu")) return;
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

  // 選んでいる升目の位置（送る枠の中）と、見えている右端までの幅を測る。
  // 直している間の欄と、… で切れた値を広げて見せる箱は、この位置から右へ伸びる。
  const [place, setPlace] = useState<{ top: number; left: number; room: number } | null>(null);
  const widthKey = widths.join(",");
  useLayoutEffect(() => {
    const sc = box.current?.parentElement;
    if (!sel || !sc) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const cell = box.current?.querySelector(`[data-r="${sel.row}"][data-c="${sel.col}"]`);
      if (!cell) {
        setPlace(null);
        return;
      }
      const cr = cell.getBoundingClientRect();
      const fr = sc.getBoundingClientRect();
      const next = {
        top: cr.top - fr.top + sc.scrollTop,
        left: cr.left - fr.left + sc.scrollLeft,
        room: fr.right - cr.left - GROW_GAP,
      };
      setPlace((was) =>
        was && was.top === next.top && was.left === next.left && was.room === next.room ? was : next,
      );
    };
    measure();
    sc.addEventListener("scroll", measure, { passive: true });
    return () => sc.removeEventListener("scroll", measure);
    // widths は描くたびに作り直すので、中身（widthKey）で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, widthKey, start, end, box]);
  const own = sel ? (widths[sel.col] ?? 0) : 0;
  const reach = (value: string) =>
    Math.max(own, Math.min(Math.ceil(measureText(value, font)) + CELL_PAD + 4, place?.room ?? own));

  // 選んでいる本文の升目が … で切れていたら、その升目から右へ広げた箱を重ねて
  // 全文を出す（列の幅は変えない）。超える分と改行は折り返して下へ伸ばす。
  // 見出しの行は上に固定されていて送るとずれるので出さない。
  const growValue = sel && sel.row > 0 && !peekOn && !editing ? (rows[sel.row]?.[sel.col] ?? "") : null;
  const grows =
    growValue !== null &&
    place !== null &&
    (Math.ceil(measureText(growValue, font)) + CELL_PAD > own || growValue.includes("\n"));

  // 直している間の欄は、字の分だけ右へ、折り返した分だけ下へ伸ばす。
  useLayoutEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.style.height = "";
    if (editing) ed.style.height = `${Math.max(TABLE_ROW, ed.scrollHeight)}px`;
  }, [draft, editing, editorRef, place]);
  // 今の値を残して始めたときは、字の終わりに置く。
  const wasEditing = useRef(false);
  useLayoutEffect(() => {
    const ed = editorRef.current;
    if (editing && !wasEditing.current && ed && document.activeElement === ed) {
      ed.setSelectionRange(ed.value.length, ed.value.length);
    }
    wasEditing.current = editing;
  }, [editing, editorRef]);

  // 開いている絞り込みの小窓。押した ▽ の位置に出す。
  const [asking, setAsking] = useState<{ col: number; at: DOMRect } | null>(null);
  const closeAsk = useCallback(() => setAsking(null), []);

  const on = (r: number, c: number) => (sel && sel.row === r && sel.col === c ? "is-sel" : "");
  const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ") || undefined;
  const peek = peekOn ? sel : null;

  if (!rows[0]) return null;
  return (
    <div ref={grid} className={cls("mg-csv-grid", moving !== null && "is-moving")} onKeyDown={onKey}>
      <table
        ref={box}
        className="mg-csv-table"
        style={{ width: total }}
        onMouseDown={(e) => {
          // 升目を押しても字を選ばず、入力欄から外れないようにする。
          if (cellOf(e)) e.preventDefault();
        }}
        onClick={onCell}
        onDoubleClick={onDouble}
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
                className={cls(sel?.col === i && "is-on")}
                data-n={colName(i)}
                data-col={i}
                onMouseDown={(e) => grab(e, i)}
              >
                <button
                  type="button"
                  className={cls("mg-csv-colmenu", asking?.col === i && "is-open")}
                  aria-label={`${colName(i)} 列のメニュー`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const at = e.currentTarget.getBoundingClientRect();
                    setAsking((was) => (was?.col === i ? null : { col: i, at }));
                  }}
                >
                </button>
                <span
                  className="mg-csv-grip"
                  onMouseDown={(e) => resize(e, i)}
                  onDoubleClick={() => fit(i)}
                />
              </th>
            ))}
          </tr>
          <tr className="mg-csv-head">
            <th className={cls("mg-csv-no", sel?.row === 0 && "is-on")} data-n={1} />
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
                  className={cls(on(0, i))}
                  onMouseDown={(e) => grab(e, i)}
                >
                  <span className="mg-csv-hcell">
                    <span className="mg-csv-hname">{v}</span>
                    {/* 絞っているか並べ替えている列にだけ出す。入口は列の名前の ▾。 */}
                    {narrowing && (
                      <button
                        type="button"
                        className="mg-csv-funnel is-on"
                        title={`${v || colName(i)} の絞り込み・並べ替え`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const at = e.currentTarget.getBoundingClientRect();
                          setAsking((was) => (was?.col === i ? null : { col: i, at }));
                        }}
                      >
                        <Icon name={mark} size={12} />
                      </button>
                    )}
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
              <th className={cls("mg-csv-no", sel?.row === r && "is-on")} data-n={r + 1} />
              {rows[r].map((v, i) => (
                <td key={i} data-r={r} data-c={i} className={cls(on(r, i), numberOf(v) !== null && "is-num")}>
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
          {/* ほかの列を滑らせて落とす先を空け、元の列は薄い空きにする。升目ごとに
              書かず、列の番号で当てる規則を 1 つ置く（見えている行だけ組んでいる
              ので、動く升目は数十行分）。 */}
          <style>{slideRules(moving.from, moving.gap, widths)}</style>
          <div
            className="mg-csv-lift"
            style={{ left: moving.left, top: moving.top, height: moving.height, width: widths[moving.from] }}
            aria-hidden
          >
            <div className="mg-csv-lift-letter">{colName(moving.from)}</div>
            <div className="mg-csv-lift-head">{head[moving.from]}</div>
            <div
              className="mg-csv-lift-body"
              style={{ transform: `translateY(${-(moving.top % TABLE_ROW)}px)` }}
            >
              {order
                .slice(Math.floor(moving.top / TABLE_ROW), Math.floor(moving.top / TABLE_ROW) + Math.ceil(moving.height / TABLE_ROW) + 1)
                .map((r) => {
                  const v = rows[r]?.[moving.from] ?? "";
                  return (
                    <div key={r} className={numberOf(v) !== null ? "is-num" : undefined}>
                      {v}
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
      {grows && place && growValue !== null && (
        <div className="mg-csv-grow" style={{ top: place.top, left: place.left, width: reach(growValue) }} aria-hidden>
          {growValue}
        </div>
      )}
      <textarea
        ref={editorRef}
        className={cls("mg-csv-editor", editing && "is-on")}
        style={place ? { top: place.top, left: place.left, width: reach(draft ?? ""), minHeight: TABLE_ROW } : undefined}
        value={draft ?? ""}
        rows={1}
        spellCheck={false}
        aria-label="升目の値"
        onChange={(e) => onDraft(e.target.value)}
        onCompositionStart={() => {
          if (draft === null) onDraft("");
        }}
      />
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
            focusEditor();
          }}
        />
      )}
    </div>
  );
}

// 列 from を境目 gap へ動かしている間の、列ごとのずらし。落とす先までの列は
// from の幅だけ詰め、元の列は落とす先の位置へ送って薄い空きとして見せる。
function slideRules(from: number, gap: number, widths: number[]): string {
  const to = gap > from ? gap - 1 : gap;
  const lefts = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
  const out: string[] = [];
  for (let k = 0; k < widths.length; k++) {
    let dx = 0;
    if (k === from) dx = lefts[to] + (to > from ? widths[to] - widths[from] : 0) - lefts[from];
    else if (from < to && k > from && k <= to) dx = -widths[from];
    else if (from > to && k >= to && k < from) dx = widths[from];
    const sel = `.mg-csv-grid.is-moving :is([data-c="${k}"], [data-col="${k}"])`;
    if (dx !== 0) out.push(`${sel} { transform: translateX(${dx}px); }`);
    if (k === from) out.push(`${sel} { color: transparent; background: var(--mg-csv-hole); }`);
  }
  return out.join("\n");
}

export interface Cell {
  row: number;
  col: number;
}
