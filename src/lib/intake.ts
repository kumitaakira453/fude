// 外から落とされたファイル・フォルダを、写せる形の一覧に均す。
//
// Tauri の OS ドラッグは切ってある（入れると webview の中の D&D が全部死ぬ）ので、
// 落とされたものの在り処は取れない。webview が渡す中身をそのまま読んで写す。
// 画像の持ち込み（images.ts）と同じ道で、そちらは既に動いている。
//
// ここは読むだけで、書き込みは持たない。

export interface Brought {
  // 落とした先からの相対。フォルダごと落とすと「資料/図/a.png」のようになる。
  rel: string;
  // 中身。フォルダそのもの（中に何も無いもの）は null で、場所だけを作る。
  file: File | null;
}

// 一度に取り込む数の上限。うっかり node_modules を落としたときに、
// 数千の書き込みが走らないようにする。
export const INTAKE_LIMIT = 500;

// WebKit の入れ子読み出し。型の定義が lib.dom に無いので、使う分だけ書く。
interface Reader {
  readEntries(ok: (list: Entry[]) => void, ng: (e: unknown) => void): void;
}
interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, ng: (e: unknown) => void): void;
  createReader?(): Reader;
}
interface Item {
  webkitGetAsEntry?: () => Entry | null;
}

// 「.」で始まるものは取り込まない。既定の除外（.DS_Store・.git など）と揃える。
// 一覧に出ないものが黙って増えるのが、いちばん困る。
const hidden = (name: string): boolean => name.startsWith(".");

export async function bringIn(
  data: DataTransfer,
): Promise<Brought[] | "too-many"> {
  // DataTransfer は待ちを挟むと読めなくなる。入口の分だけ先に掴んでおく。
  const roots = rootsOf(data);
  const flat = Array.from(data.files ?? []);
  if (roots.length === 0) {
    const files = flat.filter((f) => !hidden(f.name));
    if (files.length > INTAKE_LIMIT) return "too-many";
    return files.map((file) => ({ rel: file.name, file }));
  }
  const out: Brought[] = [];
  for (const entry of roots) {
    if (!(await walk(entry, "", out))) return "too-many";
  }
  return out;
}

function rootsOf(data: DataTransfer): Entry[] {
  const items = Array.from(data.items ?? []) as unknown as Item[];
  const out: Entry[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

// 1 つ辿る。上限を超えたら false を返し、呼び出し側でまるごと取りやめる。
// 半分だけ入った状態がいちばん始末に困る。
async function walk(
  entry: Entry,
  at: string,
  out: Brought[],
): Promise<boolean> {
  if (hidden(entry.name)) return true;
  const rel = at ? `${at}/${entry.name}` : entry.name;

  if (entry.isFile) {
    if (out.length >= INTAKE_LIMIT) return false;
    const file = await fileOf(entry);
    if (file) out.push({ rel, file });
    return true;
  }

  if (!entry.isDirectory || !entry.createReader) return true;
  const kids = await readAll(entry.createReader());
  const seen = kids.filter((kid) => !hidden(kid.name));
  // 空のフォルダも形として残す。落としたものが何も現れないと、弾かれたのか
  // 入ったのか分からない。
  if (seen.length === 0) {
    if (out.length >= INTAKE_LIMIT) return false;
    out.push({ rel, file: null });
    return true;
  }
  for (const kid of seen) {
    if (!(await walk(kid, rel, out))) return false;
  }
  return true;
}

function fileOf(entry: Entry): Promise<File | null> {
  if (!entry.file) return Promise.resolve(null);
  return new Promise((ok) => {
    entry.file!(
      (f) => ok(f),
      () => ok(null),
    );
  });
}

// readEntries は一度に返す数が決まっている（WebKit は 100 件）。
// 空が返るまで繰り返さないと、大きいフォルダの後ろが落ちる。
async function readAll(reader: Reader): Promise<Entry[]> {
  const out: Entry[] = [];
  for (;;) {
    const batch = await new Promise<Entry[]>((ok) => {
      reader.readEntries(
        (list) => ok(list),
        () => ok([]),
      );
    });
    if (batch.length === 0) return out;
    out.push(...batch);
    if (out.length > INTAKE_LIMIT) return out;
  }
}
