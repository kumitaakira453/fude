import { Node as PmNode } from "prosemirror-model";
import type { Loaded, Span } from "./fromMarkdown";
import { schema } from "./schema";

// 読み込んだ本文を、Worker との間で受け渡せる形へ詰め替える。
//
// 解析（remark）はメインスレッドの外へ出す。本文の大きさに比例して重く、
// 2000 ブロックで実測 285ms、4000 ブロックで 441ms かかる一方、受け渡しは
// 24ms / 36ms で済む。
//
// `Loaded` は ProseMirror の節点と Map を持つので、そのままでは構造化複製を
// 通らない。ここで素の値へ均す。**純関数にしてあるのは試験のため**で、
// Worker は jsdom で動かないので `unpack(pack(x))` が `x` と一致することを
// この 2 つで押さえる。

export interface Wire {
  source: string;
  // doc.toJSON()。Worker 側で 0〜2ms。
  doc: unknown;
  ranges: [string, [number, number]][];
  spans: [string, Span][];
}

export function pack(loaded: Loaded): Wire {
  return {
    source: loaded.source,
    doc: loaded.doc.toJSON(),
    ranges: [...loaded.ranges],
    spans: [...loaded.spans],
  };
}

export function unpack(wire: Wire): Loaded {
  const doc = PmNode.fromJSON(schema, wire.doc);
  // 読み込み時のブロックは doc の子そのもの（fromMarkdown は originals へ
  // 入れる節点と doc の子に同じ実体を使う）。渡さずにここで引き直せば同じ
  // ものになる。
  const originals = new Map<string, PmNode>();
  doc.forEach((child) => {
    const id = child.attrs.id as string | null;
    if (id !== null) originals.set(id, child);
  });
  return {
    doc,
    source: wire.source,
    ranges: new Map(wire.ranges),
    originals,
    spans: new Map(wire.spans),
  };
}
