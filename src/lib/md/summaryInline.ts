// トグルの題を行内に戻す hast 変換。
//
// 題は空行で挟んで渡し、markdown として読ませている（そうしないと `**` が
// 記号のまま出る）。読んだ結果は段落になるので、summary の直下に出た段落を
// ほどいて行内に戻す。挟んだ空行の跡（字のない text）も落とす。

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  children?: Node[];
}

export function rehypeSummaryInline() {
  return (tree: Node) => {
    walk(tree);
  };
}

function walk(node: Node): void {
  const kids = node.children;
  if (!kids) return;
  if (node.tagName === "summary" && kids.some(isParagraph)) {
    node.children = kids.flatMap((kid) =>
      isParagraph(kid)
        ? (kid.children ?? [])
        : kid.type === "text" && !kid.value?.trim()
          ? []
          : [kid],
    );
  }
  node.children?.forEach(walk);
}

const isParagraph = (node: Node): boolean =>
  node.type === "element" && node.tagName === "p";
