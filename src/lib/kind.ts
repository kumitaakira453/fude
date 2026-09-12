import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS, isImage, isMarkdown, MD_EXTENSIONS } from "./fsAccess";

// ファイルの見せ方の別。開いたときに何で描くかを決める。
//
// 判じるのは拡張子だけ。中身を覗くと、木を並べるだけで全部のファイルを
// 読みに行くことになる。

export type Kind = "markdown" | "image" | "html" | "pdf" | "other";

export const HTML_EXTENSIONS = ["html", "htm", "xhtml"];
export const PDF_EXTENSIONS = ["pdf"];

const endsWithAny = (lower: string, exts: string[]) =>
  exts.some((ext) => lower.endsWith(`.${ext}`));

export function kindOf(nameOrPath: string): Kind {
  const name = nameOrPath.split("/").pop() ?? nameOrPath;
  const lower = name.toLowerCase();
  if (isMarkdown(lower)) return "markdown";
  if (isImage(lower)) return "image";
  if (endsWithAny(lower, HTML_EXTENSIONS)) return "html";
  if (endsWithAny(lower, PDF_EXTENSIONS)) return "pdf";
  return "other";
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

// 1 枚だけ選ぶダイアログ。フォルダを開かずに読むときの入口。
export async function pickDocFile(): Promise<string | null> {
  const md = MD_EXTENSIONS.map((e) => e.slice(1));
  const sel = await open({
    multiple: false,
    title: "ファイルを選択",
    filters: [
      {
        name: "読めるもの",
        extensions: [...md, ...IMAGE_EXTENSIONS, ...HTML_EXTENSIONS, ...PDF_EXTENSIONS],
      },
      { name: "Markdown", extensions: md },
      { name: "画像", extensions: IMAGE_EXTENSIONS },
      { name: "HTML", extensions: HTML_EXTENSIONS },
      { name: "PDF", extensions: PDF_EXTENSIONS },
    ],
  });
  return typeof sel === "string" ? sel : null;
}
