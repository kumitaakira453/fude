import { invoke } from "@tauri-apps/api/core";
import { renderMermaid } from "./mermaid";

// 図として描くコードの塊。mermaid はいつも、d2 は設定（ベータ）が入のときだけ。
// d2 は Mac に入っている d2 コマンドで描く（Rust の render_d2）。

export const D2 = "d2";

// .d2 のファイル。設定が入のときは、開くと図で出す（D2Doc）。
export const isD2Path = (nameOrPath: string): boolean => /\.d2$/i.test(nameOrPath);

export function isDiagramLang(lang: string | null | undefined, d2: boolean): boolean {
  return lang === "mermaid" || (d2 && lang === D2);
}

// d2 の描いた図の控え。同じ記述・同じ明暗は描き直さない（コマンドを起こすので重い）。
const drawn = new Map<string, string>();
const KEPT = 64;

// 描いた SVG から、動くもの（script と on* の属性）を落とす。mermaid は自分で
// 消毒している（securityLevel: strict）ので、外から来る d2 の図だけに当てる。
export function cleanSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("図を読めません");
  root.querySelectorAll("script").forEach((el) => el.remove());
  // d2 の外枠は幅・高さを持たず、左上に寄せる指定（xMinYMin）になっている。そのままだと
  // 枠いっぱいに広がって左上に貼り付くので、元の大きさを持たせて真ん中に寄せる。
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite)) {
    if (!root.hasAttribute("width")) root.setAttribute("width", String(box[2]));
    if (!root.hasAttribute("height")) root.setAttribute("height", String(box[3]));
  }
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // d2 が敷く下地（内側の svg の最初の、枠いっぱいの rect）を外し、画面の色に
  // なじませる。SVG に書き出すときはコマンドの出力のままなので、下地は残る。
  const ground = root.querySelector(":scope > svg > rect:first-child");
  if (ground && /\bfill-N7\b/.test(ground.getAttribute("class") ?? "")) ground.remove();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

// 図の下の注釈（d2 の --force-appendix の付録）の 1 件。番号は図の中の丸と同じ。
export interface DiagramNote {
  n: string;
  text: string;
}

const box4 = (v: string | null) => {
  const n = v?.trim().split(/[\s,]+/).map(Number);
  return n && n.length === 4 && n.every(Number.isFinite) ? n : null;
};

// 付録を図から外し、番号と文の組にして返す。図は区切り線の位置で高さを詰める。
// 付録は拡大縮小と関わらない字で出したいので、画面では図の外に並べる。
// 付録が無ければ、そのまま返す。
export function splitAppendix(svg: string): { svg: string; notes: DiagramNote[] } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const group = root.querySelector('g[class~="appendix"]');
  if (!group) return { svg, notes: [] };
  const notes: DiagramNote[] = [];
  for (const icon of group.querySelectorAll(':scope > g[class~="appendix-icon"]')) {
    const text = icon.nextElementSibling;
    notes.push({ n: icon.textContent?.trim() ?? "", text: text?.textContent?.trim() ?? "" });
  }
  const line = group.previousElementSibling;
  const cut = line?.localName === "line" ? Number(line.getAttribute("y1")) : NaN;
  group.remove();
  if (line?.localName === "line") line.remove();
  // 内側の svg の見取り枠を区切り線で切り、減った分だけ外側も縮める。
  const inner = root.querySelector(":scope > svg");
  const box = box4(inner?.getAttribute("viewBox") ?? null);
  if (inner && box && Number.isFinite(cut) && cut > box[1] && cut < box[1] + box[3]) {
    const drop = box[1] + box[3] - cut;
    inner.setAttribute("viewBox", `${box[0]} ${box[1]} ${box[2]} ${box[3] - drop}`);
    if (inner.hasAttribute("height")) inner.setAttribute("height", String(box[3] - drop));
    const outer = box4(root.getAttribute("viewBox"));
    if (outer) root.setAttribute("viewBox", `${outer[0]} ${outer[1]} ${outer[2]} ${outer[3] - drop}`);
    const h = Number(root.getAttribute("height"));
    if (Number.isFinite(h) && h > 0) root.setAttribute("height", String(h - drop));
  }
  return { svg: new XMLSerializer().serializeToString(root), notes };
}

async function renderD2(code: string, dark: boolean): Promise<string> {
  const key = `${dark ? 1 : 0}\n${code}`;
  const hit = drawn.get(key);
  if (hit) return hit;
  const svg = cleanSvg(await invoke<string>("render_d2", { code, dark }));
  drawn.set(key, svg);
  if (drawn.size > KEPT) {
    const oldest = drawn.keys().next().value;
    if (oldest !== undefined) drawn.delete(oldest);
  }
  return svg;
}

// 図のエラーを、題・場所・中身に分ける。本文の字と見分けられるよう、題を添えて出す。
// d2 のコードの誤りは「行:桁: 中身」の形で来る。コマンドが無い・時間切れのように
// コードの誤りでないものは題を変える。
export function describeDiagramError(
  lang: string,
  message: string,
): { title: string; where: string; text: string } {
  const at = /^(\d+):(\d+):\s*(.*)$/s.exec(message.trim());
  if (lang === D2 && at) {
    return { title: "コードエラー", where: `${at[1]} 行目 ${at[2]} 文字目`, text: at[3] };
  }
  if (lang === D2 && /^d2 (コマンドが見つかりません|が \d+ 秒で終わりませんでした|を起動できません)/.test(message)) {
    return { title: "d2 で描けません", where: "", text: message };
  }
  return { title: "コードエラー", where: "", text: message };
}

// 図を SVG 文字列にする。描けないときは例外（エラーの文をそのまま見せる）。
// d2 の組み方は、図の中の `vars: { d2-config: { layout-engine: … } }` で決める。
// 決めていなければ ELK で組む（src-tauri の d2.rs）。
export function renderDiagram(lang: string, code: string, dark: boolean): Promise<string> {
  return lang === D2 ? renderD2(code, dark) : renderMermaid(code, dark);
}
