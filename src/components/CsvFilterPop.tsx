import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  columnValues,
  inRange,
  numberOf,
  numericColumn,
  type ColFilter,
  type ColSort,
} from "../lib/csvFilter";
import { Icon } from "./Icon";

// 見出しの ▽ から出す、その列の絞り込みと並べ替え（Excel のオートフィルタ）。
// 押した瞬間に表へ当てる。閉じるのは外を押すか Esc。

// 値の一覧に並べる上限。多い列は「含む字」で絞って探す。
const LIST_MAX = 1000;
const EDGE = 8;

const EMPTY: ColFilter = { text: "", picked: null, min: null, max: null };

export function CsvFilterPop({
  rows,
  col,
  name,
  anchor,
  filter,
  sort,
  onFilter,
  onSort,
  onClose,
}: {
  rows: string[][];
  col: number;
  name: string;
  anchor: DOMRect;
  filter: ColFilter | undefined;
  sort: ColSort | null;
  onFilter: (next: ColFilter | null) => void;
  onSort: (next: ColSort | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const values = useMemo(() => columnValues(rows, col), [rows, col]);
  const numeric = useMemo(() => numericColumn(rows, col), [rows, col]);
  const now = filter ?? EMPTY;
  const { text, picked } = now;
  // 範囲の欄は打ったままの字で持つ（「-」や「1.」のような打ちかけも消さない）。
  const [range, setRange] = useState({
    min: now.min === null ? "" : String(now.min),
    max: now.max === null ? "" : String(now.max),
  });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(anchor.left, window.innerWidth - EDGE - width)),
      top: Math.max(EDGE, Math.min(anchor.bottom + 4, window.innerHeight - EDGE - height)),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      // ▽ は押した側が開け閉めを決める（ここで閉じると、同じ ▽ でまた開く）。
      if (e.target instanceof Element && e.target.closest(".mg-csv-funnel")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const set = (patch: Partial<ColFilter>) => {
    const next = { ...now, ...patch };
    const empty =
      next.text.trim() === "" && next.picked === null && next.min === null && next.max === null;
    onFilter(empty ? null : next);
  };
  // 読めない字は条件にしない。
  const setEdge = (edge: "min" | "max", raw: string) => {
    setRange((was) => ({ ...was, [edge]: raw }));
    set({ [edge]: raw.trim() === "" ? null : numberOf(raw) });
  };

  const needle = text.trim().toLowerCase();
  const listed = values.filter(
    (v) => (needle === "" || v.value.toLowerCase().includes(needle)) && inRange(v.value, now),
  );
  const all = picked === null;
  const toggle = (value: string) => {
    const base = picked ?? new Set(values.map((v) => v.value));
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set({ picked: next.size === values.length ? null : next });
  };
  const dirOn = (dir: ColSort["dir"]) => sort?.col === col && sort.dir === dir;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${name} の絞り込み`}
      className="mg-pop mg-csv-filter-pop"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mg-csv-filter-sort" role="group" aria-label="並べ替え">
        {(["asc", "desc"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            className="mg-tbtn"
            aria-pressed={dirOn(dir)}
            onClick={() => onSort(dirOn(dir) ? null : { col, dir })}
          >
            <Icon name={dir === "asc" ? "arrow_upward" : "arrow_downward"} size={13} />
            {dir === "asc" ? "昇順" : "降順"}
          </button>
        ))}
      </div>
      <label className="mg-csv-filter-text">
        <Icon name="search" size={13} />
        <input
          autoFocus
          value={text}
          placeholder="含む文字で絞り込み"
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      {numeric && (
        <div className="mg-csv-filter-range" role="group" aria-label="数の範囲">
          <input
            inputMode="decimal"
            value={range.min}
            placeholder="以上"
            aria-label="以上"
            onChange={(e) => setEdge("min", e.target.value)}
          />
          <span aria-hidden>〜</span>
          <input
            inputMode="decimal"
            value={range.max}
            placeholder="以下"
            aria-label="以下"
            onChange={(e) => setEdge("max", e.target.value)}
          />
        </div>
      )}
      <div className="mg-csv-filter-list">
        {/* 値が 1 つなら「すべて」はその値と同じことを指すので出さない。 */}
        {values.length > 1 && (
          <button
            type="button"
            className="mg-csv-filter-row is-all"
            onClick={() => set({ picked: all ? new Set() : null })}
          >
            <span className={`mg-check${all ? " is-on" : ""}`} aria-hidden>
              {all && <Icon name="check" size={10} stroke={3} />}
            </span>
            すべて
          </button>
        )}
        {listed.slice(0, LIST_MAX).map((v) => {
          const on = picked === null || picked.has(v.value);
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={on}
              className="mg-csv-filter-row"
              onClick={() => toggle(v.value)}
            >
              <span className={`mg-check${on ? " is-on" : ""}`} aria-hidden>
                {on && <Icon name="check" size={10} stroke={3} />}
              </span>
              <span className={`mg-csv-filter-value${v.value === "" ? " is-blank" : ""}`}>
                {v.value === "" ? "（空白）" : v.value}
              </span>
              <span className="mg-csv-filter-count">{v.count.toLocaleString()}</span>
            </button>
          );
        })}
        {listed.length > LIST_MAX && (
          <div className="mg-csv-filter-more">
            ほか {(listed.length - LIST_MAX).toLocaleString()} 件。含む文字で絞り込んでください
          </div>
        )}
      </div>
      <div className="mg-csv-filter-foot">
        <button
          type="button"
          className="mg-tbtn"
          disabled={!filter && sort?.col !== col}
          onClick={() => {
            setRange({ min: "", max: "" });
            onFilter(null);
            if (sort?.col === col) onSort(null);
          }}
        >
          この列の条件を消す
        </button>
      </div>
    </div>
  );
}
