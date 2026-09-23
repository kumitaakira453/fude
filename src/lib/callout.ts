// 引用の先頭に置く [!NOTE] などの目印。GitHub の alert 記法。
//
// 読むときは Callout として描き、そうでない引用はエディトリアルの
// 「大きく見せる引用」にする。編集面でも同じ判定をするので、ここに置く。
export const CALLOUT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

// 囲みの背景色。Notion から取り込んだ文書が `<callout color="blue">` の形で
// 持っている。値そのものは CSS の変数（--mg-callout-*）に一本化してあり、
// 盤の札と囲みの飾りが同じものを引く。
export interface CalloutColor {
  id: string;
  name: string;
}

export const CALLOUT_COLORS: CalloutColor[] = [
  { id: "brown", name: "茶" },
  { id: "orange", name: "橙" },
  { id: "yellow", name: "黄" },
  { id: "green", name: "緑" },
  { id: "blue", name: "青" },
  { id: "purple", name: "紫" },
  { id: "pink", name: "桃" },
  { id: "red", name: "赤" },
];

// 書かれている値から色を見分ける。Notion は "blue_background" のようにも書く。
export function colorOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const hit = CALLOUT_COLORS.find((c) => value.startsWith(c.id));
  return hit ? hit.id : null;
}
