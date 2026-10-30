import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { colsMoved, csvLines, csvRows, delimOf, moveColumn, setCell, setCells, type ColMap } from "../lib/csv";
import { isActive, loadView, moveStoredView, shownRows, storeView, type ColSort, type Filters } from "../lib/csvFilter";
import { readText, writeFile } from "../lib/fsAccess";
import {
  assetVersionAtom,
  csvFiltersAtom,
  csvHiddenAtom,
  csvViewAtom,
  csvWidthsAtom,
  savingCountAtom,
} from "../state/atoms";
import { CsvCellBar } from "./CsvCellBar";
import { CsvTable, type Cell } from "./CsvTable";
import { SourceView } from "./SourceView";

// CSV・TSV を読む。開いたときは原文を列ごとの色で出し、釦か ⌘⇧V で
// 表（Excel の見た目）に替える。どちらで見るかは全体で 1 つ覚える。
//
// 表では、上の欄で選んだ升目の値を直せる。書き戻すのはその値の原文だけで、
// ほかの値の囲みや改行の字は変えない（setCell）。
//
// どちらの見た目も、組むのは見えている行とその前後だけ（useVisibleRows）。

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
  // このファイルを開いている間の書き換え。⌘Z で 1 つずつ戻し、⌘⇧Z でやり直す。
  // 列を動かす・足す・消したときは、列に付いているもの（幅・絞り込みなど）を
  // 付け替える向きも一緒に持つ。
  const undo = useRef<Change[]>([]);
  const redo = useRef<Change[]>([]);
  const [sel, setSel] = useState<Cell | null>(null);
  // 直している値（上の欄と升目の中の欄で分け合う）。null なら直していない。
  const [draft, setDraft] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(null);
    setSel(null);
    setDraft(null);
    setFailed(false);
    savedRef.current = null;
    undo.current = [];
    redo.current = [];
  }, [abs]);

  useEffect(() => {
    let alive = true;
    setLost(false);
    void readText(abs).then(
      (read) => {
        if (!alive || read === savedRef.current || read === textRef.current) return;
        // ほかで書き換えられた。手元の戻し先はその前の中身なので捨てる。
        if (textRef.current !== null) {
          undo.current = [];
          redo.current = [];
        }
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
  // 原文を next にする。map は列の付け替え、back はその逆向き（戻すとき）。
  const change = (next: string, map?: ColMap, back?: ColMap) => {
    if (text === null || next === text) return;
    undo.current.push({ before: text, after: next, map, back });
    redo.current = [];
    write(next);
    if (map) remap(map);
  };
  const undoLast = () => {
    const c = undo.current.pop();
    if (!c) return;
    redo.current.push(c);
    write(c.before);
    if (c.back) remap(c.back);
  };
  const redoLast = () => {
    const c = redo.current.pop();
    if (!c) return;
    undo.current.push(c);
    write(c.after);
    if (c.map) remap(c.map);
  };
  const edit = (row: number, col: number, value: string) => {
    if (text !== null) change(setCell(text, delim, row, col, value));
  };

  // 列に付いているもの（幅・絞り込み・選んでいる升目）を付け替える。
  const remap = (where: ColMap) => {
    store.set(csvWidthsAtom, (was) => {
      const mine = was[abs];
      if (!mine) return was;
      const next: Record<number, number> = {};
      for (const [c, w] of Object.entries(mine)) {
        const to = where(Number(c));
        if (to !== null) next[to] = w;
      }
      return { ...was, [abs]: next };
    });
    store.set(csvFiltersAtom, (was) => (was[abs] ? { ...was, [abs]: moveStoredView(was[abs], where) } : was));
    store.set(csvHiddenAtom, (was) => {
      const mine = was[abs];
      if (!mine) return was;
      const next = mine.map(where).filter((c): c is number => c !== null);
      const { [abs]: _, ...rest } = was;
      return next.length ? { ...rest, [abs]: next } : rest;
    });
    setSel((was) => {
      const col = was && where(was.col);
      return was && col !== null ? { row: was.row, col } : null;
    });
  };
  const move = (from: number, to: number) => {
    if (text !== null) change(moveColumn(text, delim, from, to), colsMoved(from, to), colsMoved(to, from));
  };

  const rows = useMemo(() => (text === null ? null : csvRows(text, delim)), [text, delim]);
  const lines = useMemo(
    () => (text === null || view !== "rainbow" ? null : csvLines(text, delim)),
    [text, delim, view],
  );
  const table = view === "table";
  const width = rows?.[0]?.length ?? 0;
  // ほかで書き換えられて行や列が減り、選んでいた升目が無くなったときも A1 に戻す。
  // まだ何も選んでいなければ A1（隠していれば、見えている最初の列の見出し）を選んで
  // おき、開いた直後から上の欄に位置と値を出す。
  const [hiddenAll] = useAtom(csvHiddenAtom);
  const firstCol = useMemo(() => {
    const hid = new Set(hiddenAll[abs] ?? []);
    for (let c = 0; c < width; c++) if (!hid.has(c)) return c;
    return 0;
  }, [hiddenAll, abs, width]);
  const cell =
    sel && rows && sel.row < rows.length && sel.col < width
      ? sel
      : rows && width > 0
        ? { row: 0, col: firstCol }
        : null;
  const cellValue = cell && rows ? (rows[cell.row]?.[cell.col] ?? "") : "";
  const commit = (value: string) => {
    if (cell && value !== cellValue) edit(cell.row, cell.col, value);
    setDraft(null);
  };
  const cancel = () => {
    setDraft(null);
    editorRef.current?.focus({ preventScroll: true });
  };

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
          value={cellValue}
          draft={draft}
          inputRef={barRef}
          onDraft={setDraft}
          onCommit={(value, tab) => {
            commit(value);
            if (tab && cell) setSel({ row: cell.row, col: Math.min(width - 1, Math.max(0, cell.col + tab)) });
            editorRef.current?.focus({ preventScroll: true });
          }}
          onCancel={cancel}
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
              sel={cell}
              onSelect={setSel}
              draft={draft}
              onDraft={setDraft}
              onCommit={commit}
              onCancel={cancel}
              onSetCell={(at, value) => edit(at.row, at.col, value)}
              onSetCells={(edits) => text !== null && change(setCells(text, delim, edits))}
              editorRef={editorRef}
              onUndo={undoLast}
              onRedo={redoLast}
              onMove={move}
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


interface Change {
  before: string;
  after: string;
  map?: ColMap;
  back?: ColMap;
}
