import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { readText } from "../lib/fsAccess";
import { countNodes, flatten, openTo, withChildren, type JsonRow } from "../lib/jsonTree";
import { assetVersionAtom, jsonViewAtom } from "../state/atoms";
import { SourceView } from "./SourceView";
import { ValuePeek } from "./ValuePeek";

// JSON を読む。開いたときはオブジェクトと配列を開け閉めできる木で出し、釦か
// ⌘⇧V で色付きの原文に替える。どちらで見るかは全体で 1 つ覚える。
//
// 書き換えはしない（ほかの字のファイルと同じく読む面だけ）。JSON として読めない
// 中身（コメント入りなど）は原文で出す。

// 開いた直後に開いておく段の数。
const FIRST_DEPTH = 2;
// 行の高さ（px）。index.css の .mg-json-row と対にする。
const ROW = 22;
const INDENT = 16;

type Parsed = { ok: true; value: unknown } | { ok: false };

export function JsonDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [view, setView] = useAtom(jsonViewAtom);
  const [text, setText] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

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

  const parsed = useMemo<Parsed | null>(() => {
    if (text === null) return null;
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  }, [text]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (parsed?.ok) setOpen(openTo(parsed.value, FIRST_DEPTH));
  }, [parsed]);

  const tree = view === "tree" && parsed?.ok === true;
  const count = useMemo(() => (parsed?.ok ? countNodes(parsed.value) : 0), [parsed]);

  const toggle = (row: JsonRow, deep: boolean) => {
    setOpen((was) => {
      const next = new Set(was);
      const paths = deep ? withChildren(row.value, row.path) : [row.path];
      for (const p of paths) {
        if (row.open) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 端で勢いよく送っても弾ませない（弾むと枠の外の下地が見える）。 */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        {lost ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            このファイルは字として読めませんでした
          </div>
        ) : tree && parsed?.ok ? (
          <JsonTree value={parsed.value} open={open} onToggle={toggle} />
        ) : (
          text !== null && <SourceView code={text} lang="json" />
        )}
      </div>
      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">
          {lost || !parsed
            ? ""
            : parsed.ok
              ? `JSON · ${count.toLocaleString()} 項目`
              : "JSON として読めませんでした"}
        </span>
        {tree && parsed?.ok && (
          <>
            <button
              type="button"
              className="mg-small"
              onClick={() => setOpen(openTo(parsed.value, Number.POSITIVE_INFINITY))}
            >
              すべて開く
            </button>
            <button type="button" className="mg-small" onClick={() => setOpen(new Set())}>
              すべて閉じる
            </button>
          </>
        )}
        {parsed?.ok && (
          <button
            type="button"
            className={`mg-small${tree ? "" : " is-on"}`}
            title="見た目を切り替える（⌘⇧V）"
            onClick={() => setView(tree ? "source" : "tree")}
          >
            {tree ? "原文で見る" : "木で見る"}
          </button>
        )}
      </div>
    </div>
  );
}

// 木。開いている項目だけを平らな行に直し、見えている行とその前後だけを組む。
//
// 行を押すと選び、オブジェクトと配列なら開け閉めもする（⌥ を押しながらなら
// 下の項目までまとめて）。選んだら矢印で上下へ動き、←→ で閉じる・開く。
// Enter で値の全文を小窓に出す（… で切れた長い文字列を読む）。
function JsonTree({
  value,
  open,
  onToggle,
}: {
  value: unknown;
  open: ReadonlySet<string>;
  onToggle: (row: JsonRow, deep: boolean) => void;
}) {
  const rows = useMemo(() => flatten(value, open), [value, open]);
  const box = useRef<HTMLDivElement>(null);
  const peekBox = useRef<HTMLDivElement>(null);
  const [start, end] = useVisibleRows(box, rows.length, ROW);
  const [sel, setSel] = useState<string | null>(null);
  const [peekOn, setPeekOn] = useState(false);
  const at = sel === null ? -1 : rows.findIndex((r) => r.path === sel);
  const current = at >= 0 ? rows[at] : null;

  // 選んだ行が見える位置まで送る。見えている行だけを組むので、位置は行の番号から出す。
  const reveal = (n: number) => {
    const sc = box.current?.parentElement;
    if (!sc) return;
    const top = n * ROW;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + ROW > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + ROW - sc.clientHeight;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!current || e.metaKey || e.ctrlKey) return;
    const nest = current.kind === "object" || current.kind === "array";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
      setSel(rows[n].path);
      reveal(n);
    } else if (e.key === "ArrowRight" && nest && !current.open) {
      e.preventDefault();
      onToggle(current, e.altKey);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (nest && current.open) onToggle(current, e.altKey);
      else {
        // 閉じた項目や値の上では、親の行へ上がる。
        let parent = at - 1;
        while (parent >= 0 && rows[parent].depth >= current.depth) parent--;
        if (parent >= 0) {
          setSel(rows[parent].path);
          reveal(parent);
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPeekOn((on) => !on);
    } else if (e.key === "Escape") {
      if (peekOn) setPeekOn(false);
      else setSel(null);
    }
  };

  // 木と小窓の外を押したら、選択を外す。
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

  return (
    <>
      <div
        ref={box}
        tabIndex={0}
        className="mg-json"
        style={{ height: rows.length * ROW }}
        onKeyDown={onKey}
      >
        {rows.slice(start, end).map((row, n) => {
          const nest = row.kind === "object" || row.kind === "array";
          return (
            <div
              key={row.path}
              data-path={row.path}
              className={`mg-json-row${nest ? " is-box" : ""}${row.path === sel ? " is-sel" : ""}`}
              style={{ top: (start + n) * ROW, paddingLeft: row.depth * INDENT + 8 }}
              onClick={(e) => {
                box.current?.focus({ preventScroll: true });
                setSel(row.path);
                if (nest) onToggle(row, e.altKey);
              }}
            >
              {/* 三角は CSS で描く（字形の名前を字として置くと、⌘F に引っかかる）。 */}
              <span className={`mg-json-caret${nest ? " is-box" : ""}${row.open ? " is-open" : ""}`} />
              {row.key !== null && (
                <>
                  <span className={typeof row.key === "number" ? "mg-json-index" : "mg-json-key"}>
                    {row.key}
                  </span>
                  <span className="mg-json-colon">:</span>
                </>
              )}
              <JsonValue row={row} />
            </div>
          );
        })}
      </div>
      {peekOn && current && (
        <ValuePeek
          boxRef={peekBox}
          anchor={() => box.current?.querySelector(`[data-path="${CSS.escape(current.path)}"]`) ?? null}
          frame={() => box.current?.parentElement?.getBoundingClientRect()}
          watch={current.path}
          label={current.path}
          value={peekText(current)}
          onClose={() => {
            setPeekOn(false);
            box.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

// 小窓に出す字。文字列はそのまま（中が JSON なら小窓の側で字下げする）、
// オブジェクトと配列は字下げした JSON、ほかは JSON の書き方のまま。
function peekText(row: JsonRow): string {
  if (row.kind === "string") return row.value as string;
  if (row.kind === "object" || row.kind === "array") return JSON.stringify(row.value, null, 2);
  return JSON.stringify(row.value);
}

function JsonValue({ row }: { row: JsonRow }) {
  switch (row.kind) {
    case "object":
    case "array": {
      const [l, r] = row.kind === "object" ? ["{", "}"] : ["[", "]"];
      const unit = row.kind === "object" ? "個" : "件";
      return (
        <span className="mg-json-box">
          {row.open ? l : `${l}…${r}`}
          <span className="mg-json-count">
            {row.count.toLocaleString()} {unit}
          </span>
        </span>
      );
    }
    case "string":
      return <span className="mg-json-str">{JSON.stringify(row.value)}</span>;
    case "number":
      return <span className="mg-json-num">{String(row.value)}</span>;
    case "boolean":
      return <span className="mg-json-bool">{String(row.value)}</span>;
    default:
      return <span className="mg-json-null">null</span>;
  }
}
