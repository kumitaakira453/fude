import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS, isImage, isMarkdown, MD_EXTENSIONS } from "./fsAccess";

// ファイルの見せ方の別。開いたときに何で描くかを決める。
//
// 判じるのは拡張子だけ。中身を覗くと、木を並べるだけで全部のファイルを
// 読みに行くことになる。

export type Kind = "markdown" | "image" | "html" | "pdf" | "text" | "other";

export const HTML_EXTENSIONS = ["html", "htm", "xhtml"];
export const PDF_EXTENSIONS = ["pdf"];

// 開くダイアログの絞り込みに並べる、字のファイルの代表。ダイアログは並べた
// ものしか選べないので、よく使うものだけを挙げる（木では拡張子を問わず出る）。
export const TEXT_EXTENSIONS = [
  "txt", "log", "csv", "tsv", "json", "jsonc", "yaml", "yml", "toml", "ini",
  "xml", "css", "scss", "less", "js", "jsx", "mjs", "cjs", "ts", "tsx", "py",
  "rb", "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php",
  "sh", "bash", "zsh", "sql", "graphql", "diff", "patch", "env", "conf",
];

// 字にならないもの。ここに無い拡張子は字として開く（VS Code と同じく、
// 読めるものは読ませる側に倒す）。中身まで覗くと、木を並べるだけで全部の
// ファイルを読みに行くことになるので、判じるのは名前だけ。
const BINARY_EXTENSIONS = [
  // 書庫
  "zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "lz4",
  // 実行物・目的ファイル
  "exe", "dll", "dylib", "so", "o", "a", "bin", "wasm", "class", "jar",
  "pyc", "pyo", "node", "msi", "com",
  // 音と動画
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "mp4", "m4v",
  "mov", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg",
  // 書体
  "woff", "woff2", "ttf", "otf", "eot",
  // 他のアプリの書類
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "psd", "ai", "sketch", "fig", "key", "numbers", "pages", "epub",
  // 入れ物
  "dmg", "iso", "img", "pkg", "deb", "rpm", "apk", "ipa", "crx", "appimage",
  // 控えと鍵
  "db", "sqlite", "sqlite3", "mdb", "realm", "p12", "pfx", "der", "keychain",
];

const endsWithAny = (lower: string, exts: string[]) =>
  exts.some((ext) => lower.endsWith(`.${ext}`));

export function kindOf(nameOrPath: string): Kind {
  const name = nameOrPath.split("/").pop() ?? nameOrPath;
  const lower = name.toLowerCase();
  if (isMarkdown(lower)) return "markdown";
  if (isImage(lower)) return "image";
  if (endsWithAny(lower, HTML_EXTENSIONS)) return "html";
  if (endsWithAny(lower, PDF_EXTENSIONS)) return "pdf";
  if (endsWithAny(lower, BINARY_EXTENSIONS)) return "other";
  // 拡張子の無い名前（Makefile・LICENSE）も字として開く。名前が空のとき
  // （道筋がフォルダで終わるとき）だけは、開くものが無いので除く。
  return name ? "text" : "other";
}

// 一覧に出す顔。名前を読む前に何のファイルか分かるようにする。
//
// 名前は Material Symbols のもの。無い名前を書くと、その字がそのまま出て
// しまうので、実際に描いて確かめたものだけを並べてある（svg という名前の
// 記号は無いので図形の記号で代える。写真と絵は同じ字面なので分けない）。
const ICONS: Record<string, string> = {
  svg: "shapes",
  gif: "gif_box",
};

const BY_KIND: Record<Kind, string> = {
  markdown: "markdown",
  image: "image",
  html: "html",
  pdf: "picture_as_pdf",
  text: "draft",
  other: "draft",
};

export function iconOf(nameOrPath: string): string {
  const name = nameOrPath.split("/").pop() ?? nameOrPath;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const kind = kindOf(name);
  return (kind === "image" && ICONS[ext]) || BY_KIND[kind];
}

// fude で開けるもの。ツリーの絞り込みとダイアログで共に使う。
export const isViewable = (nameOrPath: string): boolean => kindOf(nameOrPath) !== "other";

// 画像を 1 枚選ぶダイアログ。本文へ取り込むときの入口。
//
// 開いている最中の 2 度目は受けない。OS の選択窓が二重に開くと、主たる実行の
// 環がどちらの窓を待てばよいか決まらず、窓ごと止まることがある。
//
// 窓を出すのは押下の処理から抜けたあと。押している最中に OS の窓を出すと、
// 窓の側は手が離れるのを待ち、こちらは窓が閉じるのを待つ形になり得る。
let picking: Promise<string | null> | null = null;

export function pickImageFile(): Promise<string | null> {
  if (picking) return picking;
  picking = new Promise<string | null>((done) => {
    requestAnimationFrame(() => {
      open({
        multiple: false,
        title: "画像を選択",
        filters: [{ name: "画像", extensions: IMAGE_EXTENSIONS }],
      })
        .then((sel) => done(typeof sel === "string" ? sel : null))
        .catch(() => done(null));
    });
  }).finally(() => {
    picking = null;
  });
  return picking;
}

// 1 枚だけ選ぶダイアログ。フォルダを開かずに読むときの入口。
export async function pickDocFile(): Promise<string | null> {
  const md = MD_EXTENSIONS.map((e) => e.slice(1));
  const sel = await open({
    multiple: false,
    title: "ファイルを選択",
    filters: [
      {
        name: "読めるもの",
        extensions: [
          ...md,
          ...IMAGE_EXTENSIONS,
          ...HTML_EXTENSIONS,
          ...PDF_EXTENSIONS,
          ...TEXT_EXTENSIONS,
        ],
      },
      { name: "Markdown", extensions: md },
      { name: "画像", extensions: IMAGE_EXTENSIONS },
      { name: "HTML", extensions: HTML_EXTENSIONS },
      { name: "PDF", extensions: PDF_EXTENSIONS },
      { name: "字のファイル", extensions: TEXT_EXTENSIONS },
    ],
  });
  return typeof sel === "string" ? sel : null;
}
