import { appDataDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { createDir, MD_EXTENSIONS, readLevel, removePath, writeFile } from "./fsAccess";

// 保存先の決まっていないメモ。
//
// アプリの持ち物の中に**ただの Markdown として**置き、自動保存する。独自の形式は
// 作らない。保存先を決めた時点でそこへ移り、以降は 1 枚だけ開いたファイルと
// まったく同じ扱いになる（レビューも版もそのまま付いていく）。
//
// 一覧は作らない。閉じるときに保存先を決めるか捨てるかを選ばせるので、行き場の
// 無い下書きが溜まらない。塞いでいない経路（別のものを開く・アプリの終了）で
// 残ったものだけが「前回の残り」として起動画面に出る。

const DIR = "drafts";

let root: string | null = null;

// 置き場。無ければ作る。
export async function draftsDir(): Promise<string> {
  if (root) return root;
  const dir = `${(await appDataDir()).replace(/\/$/, "")}/${DIR}`;
  await createDir(dir);
  root = dir;
  return dir;
}

// 下書きの置き場の中か。置き場が分かる前は判定できないので false を返す。
export function inDrafts(abs: string | null, dir: string | null): boolean {
  if (!abs || !dir) return false;
  return abs.startsWith(`${dir.replace(/\/$/, "")}/`);
}

// 新しいメモを作り、その絶対パスを返す。
export async function newDraft(now: number): Promise<string> {
  const dir = await draftsDir();
  const abs = `${dir}/${stamp(now)}.md`;
  await writeFile(abs, "");
  return abs;
}

export async function dropDraft(abs: string): Promise<void> {
  await removePath(abs, false);
}

// 置き場に残っているもの。新しい順。
export async function leftoverDrafts(): Promise<string[]> {
  const dir = await draftsDir();
  const nodes = await readLevel(dir);
  return nodes
    .filter((n) => n.kind === "file" && n.name.toLowerCase().endsWith(".md"))
    .map((n) => n.abs)
    .sort()
    .reverse();
}

// 保存先を尋ねる。決めなければ null。
export async function askWhereToSave(title: string): Promise<string | null> {
  const at = await save({
    title: "名前を付けて保存",
    defaultPath: `${title}.md`,
    filters: [
      { name: "Markdown", extensions: MD_EXTENSIONS.map((e) => e.slice(1)) },
    ],
  });
  if (!at) return null;
  // 拡張子を省いて決められたときは補う。1 枚だけ開く経路は Markdown しか通さない。
  return /\.[a-z0-9]+$/i.test(at) ? at : `${at}.md`;
}

// 本文から採った名前。見出し → 素の字のある行 → 無題 の順に落ちる。
// 保存するときの既定の名前になるので、ファイル名に使えない字は落とす。
export function draftTitle(text: string): string {
  for (const line of text.split("\n")) {
    const one = line.trim();
    if (!one) continue;
    const head = one.replace(/^#{1,6}\s+/, "").trim();
    const name = clean(head);
    if (name) return name.slice(0, 40);
  }
  return "無題";
}

// 画面に出す呼び名。置き場で付けた機械的な名前を人に見せない。
export const DRAFT = "下書き";

// ファイル名に使えない字を落とす。記号だけになったら空を返す。
function clean(text: string): string {
  const out = text
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}

// 置き場の中での名前。並べ替えたときに新しいものが後ろへ来るようにする。
function stamp(now: number): string {
  const at = new Date(now);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${day}-${time}-${pad(at.getMilliseconds(), 3)}`;
}
