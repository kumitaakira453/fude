import GithubSlugger from "github-slugger";
import type { Block } from "./blocks";
import { buildProjection } from "./projection";

// ページ内リンクの行き先。
//
// 見出しの id は描くときに rehype-slug が振っている（Markdown.tsx）。ここは
// 「その id を先に知る」ための側で、同じ github-slugger を同じ順で回す。
// 順番が要るのは、同じ見出しが複数あるときに連番（-1, -2）が付くため。
// 数え直しではなく同じ算法を通すので、画面・GitHub・写しの 3 者で食い違わない。

export interface Href {
  // 断片を除いた道筋。`#…` だけのリンクでは空。
  path: string;
  // `#` の後ろ。無ければ空。
  id: string;
}

export function splitHref(href: string): Href {
  const at = href.indexOf("#");
  if (at < 0) return { path: href, id: "" };
  const id = href.slice(at + 1);
  return { path: href.slice(0, at), id: decode(id) };
}

// 断片は道筋と同じように符号化されて書かれることがある（GitHub から写した
// リンクなど）。解けなければ書かれたまま使う。
function decode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// 見出しの字の並びから id を作る。順番に意味があるので、並びごと受ける
// （同じ見出しが 2 度目に出たときに連番が付く）。
export function slugsOf(texts: string[]): string[] {
  const slugger = new GithubSlugger();
  return texts.map((text) => slugger.slug(text.trim()));
}

// 文書の見出しに振られる id を、ブロック番号から引けるようにする。
export function headingIds(blocks: Block[]): Map<number, string> {
  const heads = blocks.filter((b) => b.type === "heading");
  const ids = slugsOf(heads.map((b) => buildProjection(b.src).plain));
  const out = new Map<number, string>();
  heads.forEach((block, i) => {
    if (ids[i]) out.set(block.index, ids[i]);
  });
  return out;
}

// その塊を含む節の id。手前の見出しを遡って探す。見出しの外なら null。
export function anchorAt(blocks: Block[], at: number): string | null {
  const ids = headingIds(blocks);
  for (let i = Math.min(at, blocks.length - 1); i >= 0; i--) {
    const id = ids.get(blocks[i].index);
    if (id) return id;
  }
  return null;
}

// 見出しへ寄せる。
//
// 本文は先頭から順に描かれるので、押した時点では行き先がまだ DOM に無い。
// 見つかるまで数フレーム押さえ、それでも無ければ見つからなかったことを知らせる
// （黙って何も起きないと、読み手はリンクが壊れているのか自分の見落としなのかを
// 判じられない）。
const WAIT_FRAMES = 40;
// 着地を目立たせている間。飛んだ先が画面のどこにあるかを言う。
const FLASH = 1200;

// そこへ寄せて、しばらく目立たせる。返すのは印を外す時計の札。
export function land(el: HTMLElement): number {
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  el.classList.add("mg-landed");
  return window.setTimeout(() => el.classList.remove("mg-landed"), FLASH);
}

export function landOn(
  content: HTMLElement,
  id: string,
  onMiss?: () => void,
): () => void {
  let frame = 0;
  let timer = 0;
  let left = WAIT_FRAMES;

  const find = (): HTMLElement | null => {
    for (const el of content.querySelectorAll<HTMLElement>("[id]")) {
      if (el.id === id) return el;
    }
    return null;
  };

  const step = () => {
    const el = find();
    if (el) {
      timer = land(el);
      return;
    }
    if (--left <= 0) {
      onMiss?.();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  step();

  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
