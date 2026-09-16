import { copyFile, writeFile } from "@tauri-apps/plugin-fs";
import { createDir, extForMime, isImage, pathExists } from "./fsAccess";
import { dirOf } from "./paths";

// 画像を文書に入れる、ただ 1 つの入口。
//
// 落とす・貼る・選ぶ・道筋を打つの 4 経路があるが、保存先と名前の決め方を
// それぞれが持つと、設定を変えたときに片方だけ従うことになる。バイト列と
// 元の名前を受け取って保存し、本文に書く道筋を返すところだけをここに置く。

export interface Incoming {
  bytes: Uint8Array;
  // 元のファイル名。貼り付けのように名前を持たない持ち込みでは null。
  name: string | null;
  mime: string | null;
}

// 窓が持ち込みのために作る名前。中身を表さないので、名前が無いものとして扱う。
// 日時から作った名前のほうが、フォルダを直接覗いたときに手掛かりになる。
const MADE_UP = ["image", "unknown", "blob", "clipboard"];

// ファイル名に置けない字を落とす。区切りや制御の字を含んだ名前で外へ出さない。
function usable(name: string): string {
  return Array.from(name)
    .filter((ch) => ch >= " " && !"/\\:".includes(ch))
    .join("")
    .trim();
}

const two = (n: number) => String(n).padStart(2, "0");

// 名前の無い持ち込みに与える名前。並べたときに撮った順になる。
function stamp(now: Date): string {
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
  return `貼り付け ${date} ${time}`;
}

// 保存する名前を決める。元の名前を残し、無いときだけ日時から作る。
//
// 内容のハッシュにすれば重なりは自動で畳めるが、フォルダを Finder で覗いた
// ときに何の画像か分からなくなる。画像は人も直接触るものなので読める名前を採る。
export function imageName(incoming: Incoming, now: Date): string {
  const safe = usable((incoming.name ?? "").split("/").pop() ?? "");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const made = !stem || MADE_UP.includes(stem.toLowerCase());
  if (!made && isImage(safe)) return safe;

  const had = dot > 0 ? safe.slice(dot + 1) : "";
  const ext = extForMime(incoming.mime) ?? (had || "png");
  return `${made ? stamp(now) : stem}.${ext}`;
}

// 空いている名前を返す。重なったら後ろに連番を付ける。
export async function freeName(dirAbs: string, base: string): Promise<string> {
  if (!(await pathExists(`${dirAbs}/${base}`))) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const cand = `${stem} ${i}${ext}`;
    if (!(await pathExists(`${dirAbs}/${cand}`))) return cand;
  }
  return base;
}

// 打たれた道筋を絶対パスに直す。頭が / でなければ文書のある場所から解く。
export function absFrom(docAbs: string, input: string): string {
  const path = input.trim().replace(/^file:\/\//, "");
  if (!path) return "";
  const stack = path.startsWith("/") ? [""] : dirOf(docAbs).split("/");
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    // 根より上へは出ない。
    if (seg === "..") {
      if (stack.length > 1) stack.pop();
    } else stack.push(seg);
  }
  return stack.join("/");
}

// 設定に打たれたフォルダ名を、置き場所として使える形に均す。
//
// 文書のあるところより外は指させない。空にしたときは既定へ戻す（画像だけが
// 文書と同じ階層に散らばるのを避ける）。
export const DEFAULT_DIR = "images";

export function cleanDir(name: string): string {
  const parts = name
    .split("/")
    .map((seg) => usable(seg))
    .filter((seg) => seg !== "" && seg !== "." && seg !== "..");
  return parts.join("/") || DEFAULT_DIR;
}

// 画像の置き場所。文書と同じところの、設定で決めたフォルダ。
function homeOf(docAbs: string, dirName: string): string {
  return `${dirOf(docAbs)}/${dirName}`;
}

// バイト列を保存し、本文に書く道筋を返す。
export async function stow(
  docAbs: string,
  dirName: string,
  incoming: Incoming,
  now: Date = new Date(),
): Promise<string> {
  const dir = homeOf(docAbs, dirName);
  await createDir(dir);
  const name = await freeName(dir, imageName(incoming, now));
  await writeFile(`${dir}/${name}`, incoming.bytes);
  return `./${dirName}/${name}`;
}

// 既にあるファイルを取り込み、本文に書く道筋を返す。
//
// すでに置き場所の中を指しているものは複製しない。同じ画像を選び直すたびに
// 増え続けることになる。
export async function adopt(
  docAbs: string,
  dirName: string,
  srcAbs: string,
  now: Date = new Date(),
): Promise<string> {
  const dir = homeOf(docAbs, dirName);
  if (srcAbs.startsWith(`${dir}/`)) {
    return `./${dirName}/${srcAbs.slice(dir.length + 1)}`;
  }
  await createDir(dir);
  const from: Incoming = { bytes: new Uint8Array(), name: srcAbs, mime: null };
  const name = await freeName(dir, imageName(from, now));
  await copyFile(srcAbs, `${dir}/${name}`);
  return `./${dirName}/${name}`;
}

// 持ち込み（落としたもの・写したもの）。DataTransfer と DataTransferList が
// どちらも当てはまる形で受ける。
export interface Held {
  files: FileList | File[];
}

// 持ち込みの中の画像。字や他の種別のファイルは拾わない。
//
// 落とした / 貼った瞬間に「受けるかどうか」を決める必要があるので、ここは
// 待ちを挟まない。中身を読むのは受けると決めたあと。
export function imageFiles(data: Held | null): File[] {
  return Array.from(data?.files ?? []).filter(
    (f) => f.type.startsWith("image/") || isImage(f.name),
  );
}

export async function readIncoming(files: File[]): Promise<Incoming[]> {
  return Promise.all(
    files.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name || null,
      mime: file.type || null,
    })),
  );
}
