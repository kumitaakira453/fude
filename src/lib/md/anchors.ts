import { Plugin, PluginKey } from "prosemirror-state";
import type { Anchored } from "./reviewAnchors";

// 指摘の居場所を、編集モデルの位置で持ち回す。
//
// 当てるのは原文の突き合わせ（reviewAnchors）で、それは重い（本文を丸ごと
// 直列化する）。打鍵ごとに当て直すわけにいかないので、決めた位置を
// transaction で写していく。写せば、打っている間も印がずれない。
//
// 決め直すのは、開いたとき・台帳が変わったとき・本文が落ち着いたときだけ。

export const anchorsKey = new PluginKey<Anchored[]>("anchors");

export const anchors = new Plugin<Anchored[]>({
  key: anchorsKey,
  state: {
    init: () => [],
    apply(tr, prev) {
      const given = tr.getMeta(anchorsKey) as Anchored[] | undefined;
      if (given) return given;
      if (!tr.docChanged) return prev;
      const next: Anchored[] = [];
      for (const anchor of prev) {
        // 写すのはブロックの内側（pos + 1）。頭ぴったりの位置は消した範囲の
        // 境目に当たるので消えたと分からず、次のブロックへずれて残る。
        const moved = tr.mapping.mapResult(anchor.pos + 1, -1);
        // 対象が消えた。次の当て直しで、残っていれば戻る。
        if (moved.deleted) continue;
        next.push({ ...anchor, pos: moved.pos - 1 });
      }
      // 変わらないなら同じものを返す。返し直すと、これを見ている側が
      // 測り直しに入る。
      return same(prev, next) ? prev : next;
    },
  },
});

function same(a: Anchored[], b: Anchored[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].pos !== b[i].pos) return false;
  }
  return true;
}
