import { throttled } from "./later";
import { windowScopedKey } from "./windows";

// ファイルごとに「見ていた場所」を覚える。位置は本文の先頭からの文字数で持つ
// （割合は組まれた高さが変わると別の場所を指す）。
//
// 文字数だけだとブロックの頭にしか戻れない。長い表の途中を見ていたのに
// 表の先頭が上端に来てしまうので、そのブロックへどれだけ入り込んでいたかも
// 画素で控える。
//
// ペインの外に置くのは、レビュー画面が本文の木ごと差し替えるため。
// コンポーネントの ref に持つと、戻ってきた時点で控えが消えていて先頭に戻る。
//
// 働く場所は Map。スクロールのたびに読むので、そのつど JSON を解かない。
// localStorage へは間を置いて書き戻す。窓ごとに分けるのは、同じフォルダを
// 2 つの窓で開いたときに互いの位置を上書きし合わないため（レイアウトの控えと
// 同じ理由）。
export interface Viewpoint {
  // 本文の先頭からの文字数。上端に見えているブロックの頭を指す。
  at: number;
  // そのブロックの頭から、上端までの画素。0 ならブロックの頭が上端。
  into: number;
}

// 覚えておく数。開いたファイルの数だけ増えるので、古いものから捨てる。
const KEEP = 64;

// 書き戻すまでの待ちと、打ち続けていても書く上限。
const SETTLE = 600;
const CAP = 4000;

const STORE_KEY = windowScopedKey("mdglow:seen");

const seen = new Map<string, Viewpoint>(load());

export function viewKey(paneId: string, path: string | null): string | null {
  return path ? `${paneId} ${path}` : null;
}

export function rememberViewpoint(
  key: string | null,
  at: number,
  into = 0,
): void {
  if (!key) return;
  // 入れ直して最近見た順に並べ替える。
  seen.delete(key);
  seen.set(key, { at, into });
  trim();
  save();
}

export function recallViewpoint(key: string | null): Viewpoint {
  return (key && seen.get(key)) || { at: 0, into: 0 };
}

// ---- 控え ----

function trim(): void {
  while (seen.size > KEEP) {
    const oldest = seen.keys().next();
    if (oldest.done) return;
    seen.delete(oldest.value);
  }
}

// 読めない控えは黙って捨てる。位置が分からないだけのことで、本文が
// 出なくなるほうがずっと困る。
function load(): [string, Viewpoint][] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return [];
    const out: [string, Viewpoint][] = [];
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const { at, into } = value as Record<string, unknown>;
      if (typeof at !== "number" || typeof into !== "number") continue;
      out.push([key, { at, into }]);
    }
    // 最近見た順は入れた順。多すぎれば古いほうから落とす。
    return out.slice(-KEEP);
  } catch {
    return [];
  }
}

const save = throttled(() => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(seen)));
  } catch {
    // 置き場所が埋まっていても、読み書きそのものは続けられる。
  }
}, SETTLE, CAP);

// 待っている分をその場で書く。
export const flushViewpoints = () => save.flush();

// 閉じる番で取りこぼさない。間を置く書き戻しは 0.6 秒で落ち着くので、
// 送った直後に閉じたときだけの取りこぼしを拾う網。
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushViewpoints);
}
