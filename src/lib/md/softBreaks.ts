// 単独の改行を改行として描くための mdast 変換。
//
// CommonMark では行の途中の改行は空白に潰れる。文書ならそれで正しいが、
// コメントは会話に近く、Enter は改行の意図で押される。この構成を渡された
// ときだけ、字の中の改行を break に置き換える。
//
// 対象は text だけ。コードブロックと `コード` は値を text で持たないので、
// 中身は触らない。

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

export function remarkSoftBreaks() {
  return (tree: Node) => {
    split(tree);
  };
}

function split(node: Node): void {
  const kids = node.children;
  if (!kids) return;
  const out: Node[] = [];
  for (const kid of kids) {
    if (kid.type === "text" && kid.value?.includes("\n")) {
      kid.value.split("\n").forEach((part, i) => {
        if (i > 0) out.push({ type: "break" });
        if (part) out.push({ type: "text", value: part });
      });
    } else {
      split(kid);
      out.push(kid);
    }
  }
  node.children = out;
}
