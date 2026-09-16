// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { tightImage } from "./gutterGeom";

// 絵だけの塊を、絵そのものの箱で測るところ。
//
// 編集面の入れ物は本文の幅いっぱいに広がる。そのまま塗ると絵より大きい枠が
// 出て、どこを選んだのかがぼやける。jsdom は組版しないので箱は差し替える。

function box(el: Element, r: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () => new DOMRect(r.left, r.top, r.width, r.height);
}

function paper(html: string): HTMLElement {
  const el = document.createElement("p");
  el.innerHTML = html;
  document.body.appendChild(el);
  box(el, { top: 100, left: 0, width: 700, height: 220 });
  return el;
}

const IMG =
  '<span class="mg-img"><span class="mg-img-body"><span class="mg-img-col">' +
  '<span class="mg-img-hold"><img></span><input class="mg-cap"></span></span></span>';

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tightImage", () => {
  it("絵の桁の箱を返す（入れ物の幅ではなく）", () => {
    const el = paper(IMG);
    box(el.querySelector(".mg-img-col")!, { top: 116, left: 120, width: 460, height: 188 });
    const out = tightImage(el)!;
    expect([out.top, out.left, out.width, out.height]).toEqual([116, 120, 460, 188]);
  });

  it("絵の無い塊は測らない", () => {
    expect(tightImage(paper("本文"))).toBeNull();
  });

  it("まだ組まれていなければ測らない", () => {
    const el = paper(IMG);
    box(el.querySelector(".mg-img-col")!, { top: 0, left: 0, width: 0, height: 0 });
    expect(tightImage(el)).toBeNull();
  });

  it("帯に添えた字は数に入れない（桁の箱だけを見る）", () => {
    // 絵の上の帯には「置換」などの字がある。DOM の字で絵だけの塊かを
    // 判じると、その字まで数えて判定が落ちる。
    const el = paper(
      IMG.replace("<img>", '<img><span class="mg-img-bar"><button>置換</button></span>'),
    );
    box(el.querySelector(".mg-img-col")!, { top: 116, left: 120, width: 460, height: 188 });
    expect(tightImage(el)?.height).toBe(188);
  });
});
