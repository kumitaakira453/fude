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
}

const processor = unified().use(remarkParse).use(remarkGfm);

interface MdastNode {
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
    blocks.push({ index, src: body.slice(start, end), start, end });
  });
  return blocks;
}

// ブロックの編集結果を body に差し戻す（範囲外＝ブロック間の空行等は保持）。
export function replaceBlock(body: string, block: Block, newSrc: string): string {
  return body.slice(0, block.start) + newSrc + body.slice(block.end);
}
