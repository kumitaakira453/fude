import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// 本文をトップレベルのブロック（段落・見出し・リスト・表・コードフェンス等）に
// 分割する。編集は「クリックした極小のブロックだけ」を生ソース化するために使う。
// レンダリング後の高さに依存しないよう、ソースのオフセット範囲で厳密に切り出す。

export interface Block {
  index: number;
  src: string; // このブロックの生 Markdown
  start: number; // body 内のオフセット（開始）
  end: number; // body 内のオフセット（終端・排他）
  type: string; // mdast のノード種別（list / table / paragraph など）
  depth?: number; // 見出しの階層（type が heading のときだけ）
}

const processor = unified().use(remarkParse).use(remarkGfm);

interface MdastNode {
  type?: string;
  depth?: number;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export function splitBlocks(body: string): Block[] {
  const tree = processor.parse(body) as { children: MdastNode[] };
  const blocks: Block[] = [];
  tree.children.forEach((node, index) => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? body.length;
    blocks.push({
      index,
      src: body.slice(start, end),
      start,
      end,
      type: node.type ?? "",
      depth: node.type === "heading" ? node.depth : undefined,
    });
  });
  return blocks;
}

// 指定したブロックが属する見出しの階層を、上位から順に返す。
// レビューの指摘に「どのセクションに対するものか」を持たせるために使う。
export function sectionPathAt(blocks: Block[], blockIndex: number): string[] {
  const stack: { depth: number; text: string }[] = [];
  for (const block of blocks) {
    if (block.index >= blockIndex) break;
    if (block.type !== "heading" || !block.depth) continue;
    while (stack.length && stack[stack.length - 1].depth >= block.depth) stack.pop();
    stack.push({ depth: block.depth, text: headingText(block.src) });
  }
  return stack.map((s) => s.text);
}

// 見出しブロックのソースから表示される文字列を取り出す。
// ATX（### 見出し）と Setext（見出し\n===）の両方を扱う。
function headingText(src: string): string {
  const firstLine = src.split("\n", 1)[0] ?? "";
  return firstLine
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s*#+\s*$/, "")
    .trim();
}

// ブロックの編集結果を body に差し戻す（範囲外＝ブロック間の空行等は保持）。
export function replaceBlock(body: string, block: Block, newSrc: string): string {
  return body.slice(0, block.start) + newSrc + body.slice(block.end);
}
