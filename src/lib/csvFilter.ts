// CSV の表の、列ごとの絞り込みと並べ替え（Excel のオートフィルタ）。
//
// rows の 0 行目は見出し行。返す並びは見出しを除いた行の、rows の中の位置。

export interface ColFilter {
  // この字を含む値だけを残す（大小は区別しない）。空なら絞らない。
  text: string;
  // 残す値。null なら全部。
  picked: Set<string> | null;
  // 数の範囲（以上・以下。両端を含む）。null は端なし。
  min: number | null;
  max: number | null;
}

export interface ColSort {
  col: number;
  dir: "asc" | "desc";
}

export type Filters = Record<number, ColFilter>;

export const isActive = (f: ColFilter | undefined): boolean =>
  !!f && (f.text.trim() !== "" || f.picked !== null || f.min !== null || f.max !== null);

// 数として読める値か。桁区切りのカンマは数のうち。
const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
export const numberOf = (value: string): number | null => {
  const v = value.trim();
  return NUMBER.test(v) ? Number(v.replace(/,/g, "")) : null;
};

// 範囲に入るか。範囲があるとき、数として読めない値は入らない。
export const inRange = (value: string, f: Pick<ColFilter, "min" | "max">): boolean => {
  if (f.min === null && f.max === null) return true;
  const n = numberOf(value);
  return n !== null && (f.min === null || n >= f.min) && (f.max === null || n <= f.max);
};

const passes = (value: string, f: ColFilter): boolean => {
  if (f.picked && !f.picked.has(value)) return false;
  if (!inRange(value, f)) return false;
  const text = f.text.trim().toLowerCase();
  return text === "" || value.toLowerCase().includes(text);
};

// 数の列か。空でない値がどれも数として読めるとき（空でない値が無ければ違う）。
export function numericColumn(rows: string[][], col: number): boolean {
  let any = false;
  for (let r = 1; r < rows.length; r++) {
    const v = rows[r][col] ?? "";
    if (v.trim() === "") continue;
    if (numberOf(v) === null) return false;
    any = true;
  }
  return any;
}

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

// 値どうしの順。数どうしは数で、それ以外は字の順（中の数字は数として並べる）。
// 空は向きに関わらず末尾。
function compare(a: string, b: string, dir: 1 | -1): number {
  const ea = a.trim() === "";
  const eb = b.trim() === "";
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na !== null && nb !== null) return (na - nb) * dir;
  return collator.compare(a, b) * dir;
}

export function shownRows(rows: string[][], filters: Filters, sort: ColSort | null): number[] {
  const active = Object.entries(filters).filter(([, f]) => isActive(f));
  const out: number[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (active.every(([c, f]) => passes(row[Number(c)] ?? "", f))) out.push(r);
  }
  if (sort) {
    const dir = sort.dir === "asc" ? 1 : -1;
    // Array.prototype.sort は安定。同じ値は元の順のまま。
    out.sort((a, b) => compare(rows[a][sort.col] ?? "", rows[b][sort.col] ?? "", dir));
  }
  return out;
}

export interface ColValue {
  value: string;
  count: number;
}

// その列に出る値と件数。値の順に並べ、空は末尾。
export function columnValues(rows: string[][], col: number): ColValue[] {
  const counts = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const v = rows[r][col] ?? "";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => compare(a.value, b.value, 1));
}
