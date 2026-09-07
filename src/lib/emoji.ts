// 絵文字の一覧と探し方。
//
// データは emojibase（CLDR）から借りる。日本語の名前と別名が付いているので、
// 「電球」でも `bulb` でも探せる。字形は OS のものをそのまま使う（画像は
// 持たない）。
//
// データは 700KB ほどあるので、**要るまで読まない**。盤を開いたときと、
// 本文で `:` を打ったときに初めて読み、以降は控えから返す。

// 盤の格子で 1 行に並べる数。上下の矢印がこの分だけ動くので、盤と打鍵の
// 両方から引く。
export const COLS = 10;

export interface Emoji {
  char: string;
  // 日本語の名前。
  label: string;
  // 日本語の別名。
  tags: string[];
  // 英語の短名（`bulb` `light_bulb` など）。
  codes: string[];
  group: number;
  order: number;
}

// 分類。emojibase の group 番号と、盤に出す名前・タブのアイコン。
//
// 名前は自分で付ける（CLDR の日本語訳は "activities" が「有効化」になるなど
// 分類名としては読めない）。2（肌の色などの部品）は本文に置くものではない
// ので出さない。
export const GROUPS: { group: number; label: string; icon: string }[] = [
  { group: 0, label: "顔と気持ち", icon: "mood" },
  { group: 1, label: "人", icon: "person" },
  { group: 3, label: "動物と自然", icon: "pets" },
  { group: 4, label: "食べ物", icon: "restaurant" },
  { group: 5, label: "場所と乗り物", icon: "flight" },
  { group: 6, label: "活動", icon: "sports_soccer" },
  { group: 7, label: "もの", icon: "lightbulb" },
  { group: 8, label: "記号", icon: "check_circle" },
  { group: 9, label: "旗", icon: "flag" },
];

const SHOWN = new Set(GROUPS.map((g) => g.group));

interface Compact {
  hexcode: string;
  label: string;
  unicode: string;
  tags?: string[];
  group?: number;
  order?: number;
}

let kept: Emoji[] | null = null;
let loading: Promise<Emoji[]> | null = null;

export async function loadEmoji(): Promise<Emoji[]> {
  if (kept) return kept;
  if (!loading) loading = build();
  return loading;
}

// 読み込みが済んでいるか。骨組みを出すかどうかの判断に使う。
export function emojiReady(): Emoji[] | null {
  return kept;
}

async function build(): Promise<Emoji[]> {
  const [ja, codes] = await Promise.all([
    import("emojibase-data/ja/compact.json"),
    import("emojibase-data/en/shortcodes/emojibase.json"),
  ]);
  const list = (ja.default ?? ja) as unknown as Compact[];
  const short = (codes.default ?? codes) as unknown as Record<
    string,
    string | string[]
  >;

  const out: Emoji[] = [];
  for (const one of list) {
    if (one.group === undefined || !SHOWN.has(one.group)) continue;
    const raw = short[one.hexcode];
    out.push({
      char: one.unicode,
      label: one.label,
      tags: one.tags ?? [],
      codes: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
      group: one.group,
      order: one.order ?? 0,
    });
  }
  out.sort((a, b) => a.order - b.order);
  kept = out;
  return out;
}

// 探し方の強さ。短名の丸ごと一致 → 短名の頭一致 → 名前の頭一致 →
// 名前か別名のどこかに含む。当たらなければ -1。
//
// 短名を先に見るのは、打つのが英字のときは狙いが決まっているため
// （`:bulb` と打った人は電球を出したい）。
const RANKS = 4;

function rank(one: Emoji, want: string): number {
  if (one.codes.includes(want)) return 0;
  if (one.codes.some((code) => code.startsWith(want))) return 1;
  if (one.label.startsWith(want)) return 2;
  if (
    one.label.includes(want) ||
    one.tags.some((tag) => tag.includes(want)) ||
    one.codes.some((code) => code.includes(want))
  ) {
    return 3;
  }
  return -1;
}

// 打った文字を、短名と同じ形に均す。区切りは `_` でも `-` でも当たる。
function flatten(query: string): string {
  return query.toLowerCase().replace(/-/g, "_").trim();
}

export function searchEmoji(all: Emoji[], query: string, limit = 60): Emoji[] {
  const want = flatten(query);
  if (!want) return all.slice(0, limit);
  const buckets: Emoji[][] = Array.from({ length: RANKS }, () => []);
  for (const one of all) {
    const at = rank(one, want);
    if (at >= 0) buckets[at].push(one);
  }
  return buckets.flat().slice(0, limit);
}

// 最近使ったもの。囲みのアイコンと本文の絵文字で控えを共有する
// （同じ「選ぶ」仕事なので、片方で選んだものがもう片方にも出る）。
const RECENT_KEY = "mdglow:callout-icons";
const RECENT_MAX = 16;

export function recentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(char: string): void {
  if (!char) return;
  const next = [char, ...recentEmoji().filter((x) => x !== char)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても選ぶことはできる */
  }
}
