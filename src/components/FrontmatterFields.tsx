import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addField,
  addItem,
  dropField,
  dropItem,
  fieldsOf,
  freeKey,
  newFrontmatter,
  swapFields,
  swapItems,
  withKey,
  withValue,
  type Cell,
  type Field,
} from "../lib/frontmatterFields";
import { throttled, type Throttled } from "../lib/later";
import { Icon } from "./Icon";
import { iconFor, isLede, norm } from "./Frontmatter";

// 書くときのフロントマター。見た目は読むときの札（Frontmatter.tsx）に揃えつつ、
// 鍵も値も打てて、行を足す・消す・動かせる。
//
// 欄の字は React では持たない。制御すると打つたびに塗り直しが入ってカーソルが
// 飛ぶので、素の contenteditable に置いて中身は DOM から読む。おかげで欄の中の
// ⌘Z は browser の undo がそのまま効く。
//
// 読むときは鍵に印があると鍵の字を出さないが、書くときは必ず出す。
// 出ていないものは打てないため。

// 保存の間合い。本文の自動保存と揃える。
const WAIT = 500;
const CAP = 3000;

// 足すときの既定の鍵。
const NEW_KEY = "項目";

type Kind = "key" | "value";

interface Spot {
  field: Field;
  // 鍵の欄では null。
  cell: Cell | null;
  kind: Kind;
}

interface Plan {
  title: Field | null;
  lede: Field | null;
  meta: Field[];
  tags: Field | null;
  // 焦点を移す順。画面に出ている順と同じ。
  order: Spot[];
}

function plan(rows: Field[]): Plan {
  const title = rows.find((f) => norm(f.key) === "title") ?? null;
  const tags = rows.find((f) => ["tags", "tag"].includes(norm(f.key))) ?? null;
  const lede = rows.find((f) => isLede(f.key)) ?? null;
  const meta = rows.filter((f) => f !== title && f !== tags && f !== lede);
  const order: Spot[] = [];
  const vals = (f: Field) => {
    for (const cell of f.cells) order.push({ field: f, cell, kind: "value" });
  };
  if (title) vals(title);
  if (lede) vals(lede);
  for (const f of meta) {
    order.push({ field: f, cell: null, kind: "key" });
    vals(f);
  }
  if (tags) vals(tags);
  return { title, lede, meta, tags, order };
}

// 組み替えたあとに焦点を戻す先。鍵は nth を見ない。
function spotAt(p: Plan, field: Field | undefined, kind: Kind, nth: number): number {
  if (!field) return 0;
  let seen = 0;
  for (let i = 0; i < p.order.length; i++) {
    const s = p.order[i];
    if (s.field !== field || s.kind !== kind) continue;
    if (kind === "key" || seen === nth) return i;
    seen++;
  }
  return 0;
}

const nthOf = (spot: Spot) =>
  spot.cell ? spot.field.cells.indexOf(spot.cell) : 0;

const textOf = (spot: Spot) =>
  spot.kind === "key" ? spot.field.key : (spot.cell?.text ?? "");

// カーソルを欄に置く。"all" はその欄の字を選んだ状態にする。
function place(el: HTMLElement, where: "start" | "end" | "all") {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  if (where !== "all") range.collapse(where === "start");
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
  name,
  onChange,
  onOut,
  enterRef,
}: {
  fm: string;
  // 何も無いところに付けるときの既定の題。ふつうはファイル名。
  name: string;
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

  // 行を組み替えたあと、どの欄へ焦点を戻すか。
  const want = useRef<{ at: number; where: "start" | "end" | "all" } | null>(null);

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

  // 欄の字は React に持たせず、ここで入れる。
  //
  // 外からの変更（want が無い）では焦点のある欄を触らない。打ちかけの字を
  // 消さないため。自分で行を組み替えたとき（want がある）は、焦点のある欄も
  // 入れ直す。組み替えで中身が別の欄へ移っているので、残すと食い違う。
  useLayoutEffect(() => {
    const go = want.current;
    want.current = null;
    laid.current.order.forEach((spot, n) => {
      const el = spots.current[n];
      if (!el) return;
      if (!go && el === document.activeElement) return;
      const now = textOf(spot);
      if (el.textContent !== now) el.textContent = now;
    });
    if (go) {
      const el = spots.current[go.at];
      if (el) place(el, go.where);
    }
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

  // 行を組み替える。打鍵と違って待たずに書き、焦点の戻り先を決めておく。
  const apply = (
    next: string,
    pick: (p: Plan, rows: Field[]) => { at: number; where: "start" | "end" | "all" },
  ) => {
    const grid = fieldsOf(next);
    const p = plan(grid);
    text.current = next;
    send.current?.cancel();
    sent.current(next);
    want.current = pick(p, grid);
    seen.current = grid;
    laid.current = p;
    setRows(grid);
  };

  // 打鍵。字は DOM から読み、その範囲だけを差し込む。
  const type = (n: number) => {
    const spot = laid.current.order[n];
    const el = spots.current[n];
    if (!spot || !el) return;
    const typed = (el.textContent ?? "").replace(/\r?\n/g, " ");
    const next =
      spot.kind === "key"
        ? withKey(text.current, spot.field, typed)
        : withValue(text.current, spot.cell!, typed);
    text.current = next;
    const grid = plan(fieldsOf(next));
    laid.current = grid;
    // 打つだけで欄の数は変わらないはずだが、変わったなら組み直す。
    if (grid.order.length !== view.order.length) setRows(fieldsOf(next));
    send.current?.();
  };

  // 何も無いところに付ける。
  const start = () => {
    apply(newFrontmatter(name), () => ({ at: 0, where: "all" }));
  };

  // 末尾に鍵を足す。鍵の字を選んだ状態にして、そのまま打ち替えられるようにする。
  const addRow = () => {
    const key = freeKey(text.current, NEW_KEY);
    apply(addField(text.current, key), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "key", 0),
      where: "all",
    }));
  };

  // 欄ごと消す。最後の 1 つを消したらフロントマターそのものを畳む。
  const remove = (field: Field) => {
    const before = laid.current.order.findIndex((s) => s.field === field);
    const cut = dropField(text.current, field);
    const next = fieldsOf(cut).length === 0 ? "" : cut;
    apply(next, (p) => ({
      at: Math.max(0, Math.min(before - 1, p.order.length - 1)),
      where: "end",
    }));
  };

  // ⌥↑ / ⌥↓。並びの項目にいるならその項目が、そうでなければ欄ごと動く。
  const move = (n: number, dir: -1 | 1) => {
    const spot = laid.current.order[n];
    if (!spot) return;

    if (spot.cell && spot.field.list) {
      const i = spot.field.cells.indexOf(spot.cell);
      const to = i + dir;
      if (to < 0 || to >= spot.field.cells.length) return;
      const key = spot.field.key;
      apply(swapItems(text.current, spot.cell, spot.field.cells[to]), (p, grid) => ({
        at: spotAt(p, grid.find((f) => f.key === key), "value", to),
        where: "end",
      }));
      return;
    }

    // 題・導入・印は出る場所が決まっているので動かさない。
    const i = laid.current.meta.indexOf(spot.field);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= laid.current.meta.length) return;
    const nth = nthOf(spot);
    apply(swapFields(text.current, spot.field, laid.current.meta[to]), (p) => ({
      at: spotAt(p, p.meta[to], spot.kind, nth),
      where: "end",
    }));
  };

  // 並びの項目を足す・消す。
  const addOne = (n: number) => {
    const spot = laid.current.order[n];
    if (!spot?.cell) return;
    const i = spot.field.cells.indexOf(spot.cell);
    const key = spot.field.key;
    apply(addItem(text.current, spot.cell), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "value", i + 1),
      where: "end",
    }));
  };

  const dropOne = (n: number) => {
    const spot = laid.current.order[n];
    if (!spot?.cell) return;
    const i = spot.field.cells.indexOf(spot.cell);
    const key = spot.field.key;
    apply(dropItem(text.current, spot.cell), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "value", Math.max(0, i - 1)),
      where: "end",
    }));
  };

  const onKey = (n: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    const spot = laid.current.order[n];
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

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(n, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.key === "Enter") {
      // 並びの項目では下に項目が増える。それ以外は次の欄へ。
      if (spot?.cell && spot.field.list) {
        e.preventDefault();
        addOne(n);
        return;
      }
      return forward();
    }
    if (e.key === "Backspace" && (el.textContent ?? "") === "") {
      if (spot?.kind === "key") {
        e.preventDefault();
        remove(spot.field);
        return;
      }
      if (spot?.cell && spot.field.list && spot.field.cells.length > 1) {
        e.preventDefault();
        dropOne(n);
        return;
      }
    }
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

  // ---- 見た目 ----

  if (fm === "") {
    return (
      <header className="mg-frontmatter mb-8">
        <button type="button" title="情報を足す" className="mg-fm-add" onClick={start}>
          <Icon name="add" size={15} />
        </button>
      </header>
    );
  }

  spots.current.length = view.order.length;

  const hole = (field: Field, kind: Kind, cell: Cell | null) => {
    const n = spotAt(view, field, kind, cell ? field.cells.indexOf(cell) : 0);
    return (
      <span
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
            {hole(f, "value", cell)}
          </span>
        ))}
      </>
    );
  };

  // 消す釦は行を指したときだけ出す。場所は空けたままにして、出入りで
  // 行が詰まらないようにする。
  const gone = (f: Field) => (
    <button
      type="button"
      title={`「${f.key}」を消す`}
      className="mg-fm-gone"
      onClick={() => remove(f)}
    >
      <Icon name="close" size={11} />
    </button>
  );

  return (
    <header
      ref={box}
      className="mg-frontmatter mb-8 border-b border-[var(--mg-border)] pb-5"
    >
      {view.title && (
        <h1 className="mg-fm-row !mb-0 !mt-0 flex items-center gap-1 !text-[2.1rem] !font-bold !leading-[1.15] tracking-[-0.02em]">
          <span className="min-w-0">{value(view.title)}</span>
          {gone(view.title)}
        </h1>
      )}

      {view.lede && (
        <p className="mg-fm-row !mb-0 mt-2 flex items-center gap-1 text-[14.5px] leading-relaxed text-[var(--mg-muted)]">
          <span className="min-w-0">{value(view.lede)}</span>
          {gone(view.lede)}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--mg-muted)]">
        {view.meta.map((f, i) => (
          <span key={i} className="mg-fm-row inline-flex max-w-full items-center gap-1.5">
            <Icon
              name={iconFor(f.key) ?? "chevron_right"}
              size={14}
              className="shrink-0 text-[var(--mg-accent)]/70"
            />
            <span className="shrink-0 text-[var(--mg-muted)]">
              {hole(f, "key", null)}:
            </span>
            <span className="min-w-0 break-all text-[var(--mg-fg-dim)]">{value(f)}</span>
            {gone(f)}
          </span>
        ))}
        <button type="button" title="欄を足す" className="mg-fm-plus" onClick={addRow}>
          <Icon name="add" size={15} />
        </button>
      </div>

      {view.tags && (
        <div className="mg-fm-row mt-3 flex flex-wrap items-center gap-1.5">
          {view.tags.cells.map((cell, i) => (
            <span
              key={i}
              className="rounded-full bg-[var(--mg-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--mg-accent)]"
            >
              #{hole(view.tags!, "value", cell)}
            </span>
          ))}
          {gone(view.tags)}
        </div>
      )}
    </header>
  );
}
