// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { tightImage } from "./gutterGeom";

// 絵だけの塊を、絵そのものの箱で測るところ。
//
// 編集面の入れ物は本文の幅いっぱいに広がる。そのまま塗ると絵より大きい枠が
// 出て、どこを選んだのかがぼやける。jsdom は組版しないので箱は差し替える。

function box(el: Element, r: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    new DOMRect(r.left, r.top, r.width, r.height);
}

function paper(html: string): HTMLElement {
  const el = document.createElement("p");
  el.innerHTML = html;
  document.body.appendChild(el);
  box(el, { top: 100, left: 0, width: 700, height: 220 });
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tightImage", () => {
  it("絵の箱を返す（入れ物の幅ではなく）", () => {
    const el = paper(
      '<span class="mg-img"><span class="mg-img-body"><span class="mg-img-hold"><img></span></span></span>',
    );
    box(el.querySelector(".mg-img-hold")!, { top: 116, left: 120, width: 460, height: 188 });
    const out = tightImage(el)!;
    expect([out.top, out.left, out.width, out.height]).toEqual([116, 120, 460, 188]);
  });

  it("キャプションを出していれば、その下端まで含める", () => {
    const el = paper(
      '<span class="mg-img has-cap"><span class="mg-img-body"><span class="mg-img-hold"><img></span></span><input class="mg-cap"></span>',
    );
    box(el.querySelector(".mg-img-hold")!, { top: 116, left: 120, width: 460, height: 160 });
    box(el.querySelector(".mg-cap")!, { top: 282, left: 120, width: 460, height: 20 });
    expect(tightImage(el)!.height).toBe(186);
  });

  it("しまってあるキャプションは含めない", () => {
    const el = paper(
      '<span class="mg-img"><span class="mg-img-body"><span class="mg-img-hold"><img></span></span><input class="mg-cap"></span>',
    );
    box(el.querySelector(".mg-img-hold")!, { top: 116, left: 120, width: 460, height: 160 });
    box(el.querySelector(".mg-cap")!, { top: 282, left: 120, width: 460, height: 20 });
    expect(tightImage(el)!.height).toBe(160);
  });

  it("字と混ざっている行は、塊の箱に任せる", () => {
    const el = paper(
      '前 <span class="mg-img"><span class="mg-img-body"><span class="mg-img-hold"><img></span></span></span> 後',
    );
    box(el.querySelector(".mg-img-hold")!, { top: 116, left: 120, width: 460, height: 188 });
    expect(tightImage(el)).toBeNull();
  });

  it("絵の無い塊は測らない", () => {
    expect(tightImage(paper("本文"))).toBeNull();
  });
});
