// JSON を木として読むための読み分け。開いている項目を、上から順に平らな行の
// 並びに直す（見えている行だけを組むため、行の高さを揃えて並べる）。
//
// 項目は道筋で見分ける：根が `$`、オブジェクトの子は `$.name`（名前が識別子の
// 形でなければ `$["a b"]`）、配列の子は `$[3]`。

export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonRow {
  path: string;
  depth: number;
  // オブジェクトの名前か配列の番号。根は null。
  key: string | number | null;
  kind: JsonKind;
  // この行の値。オブジェクトと配列では、中身ごとの値（子を開くときに使う）。
  value: unknown;
  // オブジェクトと配列の中身の数。
  count: number;
  open: boolean;
}

export const isJsonPath = (nameOrPath: string): boolean => /\.json$/i.test(nameOrPath);

export function kindOf(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "null";
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return IDENT.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

// 子の並び。オブジェクトは書かれた順、配列は番号の順。
function children(value: unknown): [string | number, unknown][] {
  if (Array.isArray(value)) return value.map((v, i) => [i, v]);
  if (value !== null && typeof value === "object") return Object.entries(value);
  return [];
}

const isBox = (kind: JsonKind) => kind === "object" || kind === "array";

// 開いている項目（道筋の集まり）から、描く行の並びを作る。閉じた項目の中は
// 歩かない（開いている分だけの手間で済む）。
export function flatten(root: unknown, open: ReadonlySet<string>): JsonRow[] {
  const rows: JsonRow[] = [];
  const walk = (value: unknown, path: string, depth: number, key: string | number | null) => {
    const kind = kindOf(value);
    const kids = isBox(kind) ? children(value) : [];
    const isOpen = isBox(kind) && open.has(path);
    rows.push({ path, depth, key, kind, value, count: kids.length, open: isOpen });
    if (isOpen) for (const [k, v] of kids) walk(v, childPath(path, k), depth + 1, k);
  };
  walk(root, "$", 0, null);
  return rows;
}

// 深さ depth より浅いオブジェクトと配列の道筋（depth 段目まで開く）。
export function openTo(root: unknown, depth: number): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, path: string, d: number) => {
    if (d >= depth || !isBox(kindOf(value))) return;
    out.add(path);
    for (const [k, v] of children(value)) walk(v, childPath(path, k), d + 1);
  };
  walk(root, "$", 0);
  return out;
}

// その項目と、下にあるオブジェクト・配列の道筋（まとめて開け閉めするとき）。
export function withChildren(value: unknown, path: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (!isBox(kindOf(v))) return;
    out.push(p);
    for (const [k, c] of children(v)) walk(c, childPath(p, k));
  };
  walk(value, path);
  return out;
}

// 値の数（根を含むすべての項目）。
export function countNodes(root: unknown): number {
  let n = 0;
  const walk = (v: unknown) => {
    n++;
    for (const [, c] of children(v)) walk(c);
  };
  walk(root);
  return n;
}
