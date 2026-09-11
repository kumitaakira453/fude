import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
} from "../../lib/frontmatterFields";
import { throttled, type Throttled } from "../../lib/later";
import { BlockSourceEditor } from "../BlockSourceEditor";
import { Icon } from "../Icon";
import { kindOf, LIST, type Kind } from "./kinds";

// ファイルの先頭に置くメタ情報（フロントマター）を読み書きする小窓。
//
// 本文には出さない。読むときの邪魔になるうえ、鍵を足す口が本文の中にあると
// 落ち着かないので、ここだけで完結させる。
//
// 欄の字は React では持たない。制御すると打つたびに塗り直しが入ってカーソルが
// 飛ぶので、素の contenteditable に置いて中身は DOM から読む。おかげで欄の中の
// ⌘Z は browser の undo がそのまま効く。

// 保存の間合い。本文の自動保存と揃える。
const WAIT = 500;
const CAP = 3000;

// 足すときの既定の鍵。
const NEW_KEY = "項目";

type Part = "key" | "value";

interface Spot {
  field: Field;
  // 鍵の欄では null。
  cell: Cell | null;
  part: Part;
}

// 焦点を移す順。画面に出ている順（鍵 → 値…）と同じ。
function plan(rows: Field[]): Spot[] {
  const out: Spot[] = [];
  for (const field of rows) {
    out.push({ field, cell: null, part: "key" });
    for (const cell of field.cells) out.push({ field, cell, part: "value" });
  }
  return out;
}

function spotAt(order: Spot[], field: Field | undefined, part: Part, nth: number) {
  if (!field) return 0;
  let seen = 0;
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    if (s.field !== field || s.part !== part) continue;
    if (part === "key" || seen === nth) return i;
    seen++;
  }
  return 0;
}

const nthOf = (spot: Spot) => (spot.cell ? spot.field.cells.indexOf(spot.cell) : 0);

const textOf = (spot: Spot) =>
  spot.part === "key" ? spot.field.key : (spot.cell?.text ?? "");

// その行の見出しに出す種類。並びは字から見分けられないので行の形で決める。
function kindFor(field: Field): Kind {
  if (field.list) return LIST;
  return kindOf(field.cells[0]?.text ?? field.shown);
}

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

export function MetaModal({
  name,
  fm,
  broken,
  onChange,
  onClose,
}: {
  // 見出しに添えるファイル名。
  name: string;
  fm: string;
  // 対応表として読めない。生の字で直させる。
  broken: boolean;
  onChange: (fm: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const spots = useRef<(HTMLElement | null)[]>([]);
  const text = useRef(fm);
  const [rows, setRows] = useState(() => fieldsOf(fm));

  // 範囲は打つたびに動く。React の描画を挟まずに持ち回る。
  const laid = useRef<Spot[]>(plan(rows));
  const seen = useRef(rows);
  if (seen.current !== rows) {
    seen.current = rows;
    laid.current = plan(rows);
  }
  const order = laid.current;

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    laid.current.forEach((spot, n) => {
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

  // 行を組み替える。打鍵と違って待たずに書き、焦点の戻り先を決めておく。
  const apply = (
    next: string,
    pick: (order: Spot[], rows: Field[]) => {
      at: number;
      where: "start" | "end" | "all";
    },
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
    const spot = laid.current[n];
    const el = spots.current[n];
    if (!spot || !el) return;
    const typed = (el.textContent ?? "").replace(/\r?\n/g, " ");
    const next =
      spot.part === "key"
        ? withKey(text.current, spot.field, typed)
        : withValue(text.current, spot.cell!, typed);
    text.current = next;
    laid.current = plan(fieldsOf(next));
    send.current?.();
  };

  // 鍵を 1 つ足す。鍵の字を選んだ状態にして、そのまま打ち替えられるようにする。
  const addRow = (base: string) => {
    const key = freeKey(base, NEW_KEY);
    apply(addField(base, key), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "key", 0),
      where: "all",
    }));
  };

  // 欄ごと消す。最後の 1 つを消したらフロントマターそのものを畳む。
  const remove = (field: Field) => {
    const before = laid.current.findIndex((s) => s.field === field);
    const cut = dropField(text.current, field);
    const next = fieldsOf(cut).length === 0 ? "" : cut;
    apply(next, (p) => ({
      at: Math.max(0, Math.min(before - 1, p.length - 1)),
      where: "end",
    }));
  };

  // ⌥↑ / ⌥↓。並びの項目にいるならその項目が、そうでなければ行ごと動く。
  const move = (n: number, dir: -1 | 1) => {
    const spot = laid.current[n];
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

    const i = rows.indexOf(spot.field);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= rows.length) return;
    const nth = nthOf(spot);
    apply(swapFields(text.current, spot.field, rows[to]), (p, grid) => ({
      at: spotAt(p, grid[to], spot.part, nth),
      where: "end",
    }));
  };

  // 並びの項目を足す・消す。
  const addOne = (n: number) => {
    const spot = laid.current[n];
    if (!spot?.cell) return;
    const i = spot.field.cells.indexOf(spot.cell);
    const key = spot.field.key;
    apply(addItem(text.current, spot.cell), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "value", i + 1),
      where: "end",
    }));
  };

  const dropOne = (n: number) => {
    const spot = laid.current[n];
    if (!spot?.cell) return;
    const i = spot.field.cells.indexOf(spot.cell);
    const key = spot.field.key;
    apply(dropItem(text.current, spot.cell), (p, grid) => ({
      at: spotAt(p, grid.find((f) => f.key === key), "value", Math.max(0, i - 1)),
      where: "end",
    }));
  };

  const onKey = (n: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    const spot = laid.current[n];
    const el = e.currentTarget;
    const last = laid.current.length - 1;
    const forward = () => {
      e.preventDefault();
      if (n < last) focusAt(n + 1, "start");
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
      if (spot?.part === "key") {
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

  spots.current.length = order.length;

  const hole = (field: Field, part: Part, cell: Cell | null, cls: string) => {
    const n = spotAt(order, field, part, cell ? field.cells.indexOf(cell) : 0);
    return (
      <span
        ref={(el) => {
          spots.current[n] = el;
        }}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        className={cls}
        onInput={() => type(n)}
        onKeyDown={onKey(n)}
        onPaste={onPaste}
        onBlur={() => send.current?.flush()}
      />
    );
  };

  const body = () => {
    if (broken)
      return (
        <div className="mg-meta-broken">
          <p className="mg-meta-say">
            <Icon name="error" size={14} />
            この情報は形が崩れていて読めません。直すと欄になります。
          </p>
          <BlockSourceEditor src={fm} onCommit={onChange} onCancel={() => {}} />
        </div>
      );

    if (rows.length === 0)
      return (
        <div className="mg-meta-empty">
          <Icon name="label" size={30} className="text-[var(--mg-muted)]/50" />
          <p>まだ何もありません</p>
          <button
            type="button"
            className="mg-meta-add"
            onClick={() => addRow(fm === "" ? newFrontmatter() : fm)}
          >
            <Icon name="add" size={16} />
            最初の項目を追加
          </button>
        </div>
      );

    return (
      <>
        <div className="mg-meta-rows">
          {rows.map((field, i) => {
            const kind = kindFor(field);
            const one = field.cells.length === 1 ? field.cells[0] : null;
            return (
              <div key={i} className="mg-meta-row">
                <span className="mg-meta-kind" title={kind.id}>
                  <Icon name={kind.icon} size={15} />
                </span>
                {hole(field, "key", null, "mg-meta-key")}
                <span className="mg-meta-val">
                  {field.cells.length === 0 ? (
                    <span className="text-[var(--mg-muted)]">{field.shown}</span>
                  ) : (
                    field.cells.map((cell, c) => (
                      <span key={c}>
                        {c > 0 && <span className="mg-meta-sep">/</span>}
                        {hole(field, "value", cell, "mg-meta-cell")}
                      </span>
                    ))
                  )}
                </span>
                <span className="mg-meta-acts">
                  {one && kind.act && (
                    <button
                      type="button"
                      title={kind.act.title}
                      onClick={() => kind.act!.run(one.text)}
                    >
                      <Icon name={kind.act.icon} size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    title={`「${field.key}」を消す`}
                    onClick={() => remove(field)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mg-meta-foot">
          <button type="button" className="mg-meta-add" onClick={() => addRow(text.current)}>
            <Icon name="add" size={16} />
            項目を追加
          </button>
          <span className="mg-meta-hint">⌥↑ ⌥↓ で並べ替え</span>
        </div>
      </>
    );
  };

  return createPortal(
    <div className="mg-meta-back" onMouseDown={onClose}>
      <div
        ref={box}
        className="mg-meta"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mg-meta-head">
          <Icon name="label" size={17} className="text-[var(--mg-accent)]" />
          <span className="mg-meta-title">メタ情報</span>
          <span className="mg-meta-file" title={name}>
            {name}
          </span>
          <button type="button" title="閉じる（Esc）" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="mg-meta-body">{body()}</div>
      </div>
    </div>,
    document.body,
  );
}
