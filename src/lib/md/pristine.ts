import type { Node as PmNode } from "prosemirror-model";
import type { Loaded } from "./fromMarkdown";

// 読み込んだときのまま触られていないブロックかどうか。
//
// 原文の範囲を attrs に持たせるだけだと、編集してもその値がコピーされて
// 古い範囲が残る。読み込み時のノードと内容を突き合わせて判定すれば、
// その取りこぼしが起きない。id が同じで内容が等しいものだけを未編集とする。
export function pristineRange(node: PmNode, loaded: Loaded): [number, number] | null {
  const id = node.attrs.id as string | null;
  if (!id) return null;
  const original = loaded.originals.get(id);
  if (!original || !original.eq(node)) return null;
  return loaded.ranges.get(id) ?? null;
}
