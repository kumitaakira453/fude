import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fieldsOf,
  withValue,
  type Cell,
  type Field,
} from "../lib/frontmatterFields";
import { throttled, type Throttled } from "../lib/later";
import { Icon } from "./Icon";
import { iconFor, isLede, norm } from "./Frontmatter";

// 書くときのフロントマター。見た目は読むときの札（Frontmatter.tsx）と同じで、
// 違いは値が打てることだけ。モードを切り替えても画面が動かない。
//
// 欄の字は React では持たない。制御すると打つたびに塗り直しが入ってカーソルが
// 飛ぶので、素の contenteditable に置いて中身は DOM から読む。おかげで欄の中の
// ⌘Z は browser の undo がそのまま効く。

// 保存の間合い。本文の自動保存と揃える。
const WAIT = 500;
const CAP = 3000;

interface Spot {
  field: Field;
  cell: Cell;
}

interface Plan {
  title: Field | null;
  lede: Field | null;
  meta: Field[];
  tags: Field | null;
  // 焦点を移す順。並びは題 → 導入 → 行並び → 印、で画面の並びと同じ。
  order: Spot[];
}

function plan(rows: Field[]): Plan {
  const title = rows.find((f) => norm(f.key) === "title") ?? null;
  const tags = rows.find((f) => ["tags", "tag"].includes(norm(f.key))) ?? null;
  const lede = rows.find((f) => isLede(f.key)) ?? null;
  const meta = rows.filter((f) => f !== title && f !== tags && f !== lede);
  const order: Spot[] = [];
  for (const f of [title, lede, ...meta, tags]) {
    if (f) for (const cell of f.cells) order.push({ field: f, cell });
  }
  return { title, lede, meta, tags, order };
}

// カーソルを欄の端に置く。
function place(el: HTMLElement, where: "start" | "end") {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(where === "start");
  sel.removeAllRanges();
  sel.addRange(range);
}

// カーソルが欄の端にいるか。端でないときは矢印を欄の中の移動に譲る。
function edge(el: HTMLElement, where: "start" | "end"): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return true;
  if (!el.contains(sel.anchorNode)) return true;
  const range = document.createRange();
  range.selectNodeContents(el);
  if (where === "start") range.setEnd(sel.anchorNode, sel.anchorOffset);
  else range.setStart(sel.anchorNode, sel.anchorOffset);
  return range.toString().length === 0;
}

export function FrontmatterFields({
  fm,
  onChange,
  onOut,
  enterRef,
}: {
  fm: string;
  // 生のフロントマターが書き換わった。親が本文と繋いで保存する。
  onChange: (fm: string) => void;
  // 本文の先頭へ抜ける。
  onOut: () => void;
  // 本文の先頭から戻ってくる口。親が本文の割り当てから呼ぶ。
  enterRef?: { current: (() => void) | null };
}) {
  const box = useRef<HTMLElement | null>(null);
  const spots = useRef<(HTMLElement | null)[]>([]);
  const text = useRef(fm);
  const [rows, setRows] = useState(() => fieldsOf(fm));

  // 範囲は打つたびに動く。React の描画を挟まずに持ち回る。
  const laid = useRef<Plan>(plan(rows));
  const seen = useRef(rows);
  if (seen.current !== rows) {
    seen.current = rows;
    laid.current = plan(rows);
  }
  const view = laid.current;

  const sent = useRef(onChange);
  sent.current = onChange;
  const send = useRef<Throttled | null>(null);
  useEffect(() => {
    const t = throttled(() => sent.current(text.current), WAIT, CAP);
    send.current = t;
    return () => {
      t.flush();
      t.cancel();
      send.current = null;
    };
  }, []);

  // 外で書き換わったら組み直す。ただし打っている最中は触らない。
  useEffect(() => {
    if (fm === text.current) return;
    if (box.current?.contains(document.activeElement)) return;
    text.current = fm;
    setRows(fieldsOf(fm));
  }, [fm]);

  // 欄の字は React に持たせず、ここで入れる。焦点のある欄は触らない。
  useLayoutEffect(() => {
    laid.current.order.forEach((spot, n) => {
      const el = spots.current[n];
      if (!el || el === document.activeElement) return;
      if (el.textContent !== spot.cell.text) el.textContent = spot.cell.text;
    });
  }, [rows]);

  const focusAt = (n: number, where: "start" | "end") => {
    const el = spots.current[n];
    if (el) place(el, where);
  };

  useEffect(() => {
    if (!enterRef) return;
    enterRef.current = () => {
      const last = laid.current.order.length - 1;
      if (last >= 0) focusAt(last, "end");
    };
    return () => {
      enterRef.current = null;
    };
    // focusAt は spots を見るだけで、描画ごとに作り直しても指す先は変わらない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterRef]);

  const type = (n: number) => {
    const spot = laid.current.order[n];
    const el = spots.current[n];
    if (!spot || !el) return;
    const typed = (el.textContent ?? "").replace(/\r?\n/g, " ");
    const next = withValue(text.current, spot.cell, typed);
    text.current = next;
    const grid = plan(fieldsOf(next));
    laid.current = grid;
    // 打つだけで欄の数は変わらないはずだが、変わったなら組み直す。
    if (grid.order.length !== view.order.length) setRows(fieldsOf(next));
    send.current?.();
  };

  const onKey = (n: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const last = laid.current.order.length - 1;
    const forward = () => {
      e.preventDefault();
      if (n < last) focusAt(n + 1, "start");
      else onOut();
    };
    const back = () => {
      if (n === 0) return;
      e.preventDefault();
      focusAt(n - 1, "end");
    };

    if (e.key === "Enter") return forward();
    if (e.key === "Escape") {
      e.preventDefault();
      return onOut();
    }
    if (e.key === "Tab") {
      if (e.shiftKey) return back();
      return forward();
    }
    if (e.key === "ArrowDown") return forward();
    if (e.key === "ArrowUp") return back();
    if (e.key === "ArrowRight" && edge(el, "end")) return forward();
    if (e.key === "ArrowLeft" && edge(el, "start")) return back();
  };

  // 貼り付けは字だけ受ける。改行は値に入れられないので空白にする。
  const onPaste = (e: React.ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const flat = e.clipboardData.getData("text/plain").replace(/\s*\r?\n\s*/g, " ");
    document.execCommand("insertText", false, flat);
  };

  if (rows.length === 0) return null;
  spots.current.length = view.order.length;

  const hole = (cell: Cell) => {
    const n = view.order.findIndex((s) => s.cell === cell);
    return (
      <span
        key={n}
        ref={(el) => {
          spots.current[n] = el;
        }}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        className="mg-fm-cell"
        onInput={() => type(n)}
        onKeyDown={onKey(n)}
        onPaste={onPaste}
        onBlur={() => send.current?.flush()}
      />
    );
  };

  const value = (f: Field) => {
    if (f.cells.length === 0)
      return <span className="text-[var(--mg-muted)]">{f.shown}</span>;
    return (
      <>
        {f.cells.map((cell, i) => (
          <span key={i}>
            {i > 0 && <span className="text-[var(--mg-muted)]"> / </span>}
            {hole(cell)}
          </span>
        ))}
      </>
    );
  };

  return (
    <header
      ref={box}
      className="mg-frontmatter mb-8 border-b border-[var(--mg-border)] pb-5"
    >
      {view.title && (
        <h1 className="!mb-0 !mt-0 !text-[2.1rem] !font-bold !leading-[1.15] tracking-[-0.02em]">
          {value(view.title)}
        </h1>
      )}

      {view.lede && (
        <p className="!mb-0 mt-2 text-[14.5px] leading-relaxed text-[var(--mg-muted)]">
          {value(view.lede)}
        </p>
      )}

      {view.meta.length > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--mg-muted)]">
          {view.meta.map((f) => {
            const ic = iconFor(f.key);
            return (
              <span key={f.key} className="inline-flex max-w-full items-center gap-1.5">
                <Icon
                  name={ic ?? "chevron_right"}
                  size={14}
                  className="shrink-0 text-[var(--mg-accent)]/70"
                />
                {!ic && <span className="shrink-0 text-[var(--mg-muted)]">{f.key}:</span>}
                <span className="min-w-0 break-all text-[var(--mg-fg-dim)]">
                  {value(f)}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {view.tags && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {view.tags.cells.map((cell, i) => (
            <span
              key={i}
              className="rounded-full bg-[var(--mg-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--mg-accent)]"
            >
              #{hole(cell)}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
