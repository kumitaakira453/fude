import { fromMarkdown } from "./fromMarkdown";
import { pack, type Wire } from "./loadedWire";

// 本文の解析だけを受け持つ。
//
// 解析器は**メイン側と同じ `fromMarkdown`**。別のものに置き換えないので、
// 結果は必ず一致する。保存のバイト一致（無編集で開いて保存 → 原文と一致）は
// ブロックごとの原文の範囲に依存しているので、ここを変えてはいけない。

export interface Ask {
  id: number;
  body: string;
}

export interface Reply {
  id: number;
  wire?: Wire;
  // 解析でしくじったときは、頼んだ側が同期でやり直す。
  error?: string;
}

self.onmessage = (event: MessageEvent<Ask>) => {
  const { id, body } = event.data;
  try {
    const wire = pack(fromMarkdown(body));
    (self as unknown as { postMessage: (r: Reply) => void }).postMessage({
      id,
      wire,
    });
  } catch (err) {
    (self as unknown as { postMessage: (r: Reply) => void }).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
