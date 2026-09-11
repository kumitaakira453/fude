// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { calloutIcoAt, setCalloutIcon } from "./calloutIcon";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { nodeViews } from "./nodeViews";
import { editorPlugins } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 編集面の専用の描画を、実際に組み立てて試す。view.test.ts と同じ土台に、
// 専用の描画（nodeViews）を足したもの。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
    nodeViews: nodeViews({ dark: false, modes: new Map(), redraws: new Set() }),
  });
  open = { view, loaded, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

describe("タスクのチェック", () => {
  it("押すと未了と完了が入れ替わる", () => {
    const view = editor("- [ ] やる\n");
    const check = view.dom.querySelector(".mg-task-check");
    expect(check).not.toBeNull();

    click(check!);
    expect(source()).toBe("- [x] やる\n");

    // 入れ替えたあとの節点にも、押せるチェックが出ている。
    click(view.dom.querySelector(".mg-task-check")!);
    expect(source()).toBe("- [ ] やる\n");
  });

  it("押した項目だけが入れ替わる", () => {
    // 専用の描画は自分の位置を持っているので、描かれない "- [ ] " が
    // 混ざっても隣に飛ばない。
    const view = editor(
      ["- [ ] あ", "- [ ]い", "- [ ] う", "- [ ] え"].join("\n") + "\n",
    );
    const checks = view.dom.querySelectorAll(".mg-task-check");
    // "- [ ]い" はタスクにならないので、チェックは 3 つ。
    expect(checks).toHaveLength(3);

    click(checks[1]);
    expect(source()).toBe(["- [ ] あ", "- [ ]い", "- [x] う", "- [ ] え"].join("\n") + "\n");
  });

  it("印のある項目にだけチェックを出し、点は落とす", () => {
    const view = editor("- ふつう\n- [ ] やる\n- [x] やった\n");
    const items = [...view.dom.querySelectorAll("li")];
    expect(items).toHaveLength(3);

    // 印の無い項目は素の li のまま。点は list-item のまま出る。
    expect(items[0].className).toBe("");
    expect(items[0].querySelector(".mg-task-check")).toBeNull();
    expect(items[0].firstElementChild?.tagName).toBe("P");

    // 印のある項目は、読むときと同じ task-list-item。点はこの印で落とす。
    for (const at of [1, 2]) {
      expect(items[at].className).toBe("task-list-item");
      expect(items[at].querySelector(":scope > .mg-task-check")).not.toBeNull();
      expect(items[at].querySelector(":scope > .mg-task-body > p")).not.toBeNull();
    }
    expect(items[1].dataset.checked).toBe("false");
    expect(items[2].dataset.checked).toBe("true");
  });

  it("入れ子は項目の中に入り、外側の項目にチェックの要素を足さない", () => {
    const view = editor(
      ["- そと", "  - なか", "", "> 引用", ">", "> - そと", ">   - なか", ""].join("\n"),
    );
    const outers = [...view.dom.querySelectorAll("li")].filter(
      (li) => li.querySelector("ul") !== null,
    );
    // 素の入れ子と、引用の中の入れ子。
    expect(outers).toHaveLength(2);

    for (const li of outers) {
      // 点の無い項目には、チェックの要素も印も入れない。
      expect(li.className).toBe("");
      expect(li.querySelector(".mg-task-check")).toBeNull();
      expect(li.querySelector(".mg-task-body")).toBeNull();
      // 項目の中身は段落 → 入れ子の一覧の順。入れ子は項目の中に入る。
      const kids = [...li.children].map((el) => el.tagName);
      expect(kids).toEqual(["P", "UL"]);
      expect(li.querySelector(":scope > ul > li > p")?.textContent).toBe("なか");
    }
  });

  it("チェックは編集の対象にしない", () => {
    const view = editor("- [ ] やる\n");
    const check = view.dom.querySelector(".mg-task-check")!;
    expect(check.getAttribute("contenteditable")).toBe("false");
    // 中身の入れ物の外にあるので、編集モデルには映らない。
    expect(view.state.doc.textContent).toBe("やる");
  });
});

describe("囲みのアイコン", () => {
  const body = ["<callout icon=\"💡\">", "", "めも", "", "</callout>", ""].join("\n");

  it("押したアイコンから囲みを見つけ、選び直すと原文が変わる", () => {
    const view = editor(body);
    const ico = view.dom.querySelector(".mg-callout-ico");
    expect(ico).not.toBeNull();

    const hit = calloutIcoAt(view, ico);
    expect(hit).not.toBeNull();

    setCalloutIcon(view, hit!.pos, "✅");
    expect(source()).toContain('<callout icon="✅">');
  });

  it("空にすると属性ごと落ちる", () => {
    const view = editor(body);
    const hit = calloutIcoAt(view, view.dom.querySelector(".mg-callout-ico"));
    setCalloutIcon(view, hit!.pos, "");
    expect(source()).toContain("<callout>");
    expect(source()).not.toContain("icon=");
  });

  it("実データの形でも囲みの位置が取れる", () => {
    // 色まで付いた形。中身は入れ物（mg-callout-body）の中に入る。
    const view = editor(
      ['<callout icon="⚠️" color="gray_bg">', "", "気をつけること", "", "</callout>", ""].join(
        "\n",
      ),
    );
    const ico = view.dom.querySelector(".mg-callout-ico")!;
    expect(ico.textContent).toBe("⚠️");
    expect(view.dom.querySelector(".mg-callout")?.getAttribute("data-color")).toBe(
      "gray_bg",
    );

    const hit = calloutIcoAt(view, ico);
    expect(hit?.node.type.name).toBe("callout");
    expect(view.state.doc.nodeAt(hit!.pos)?.attrs.icon).toBe("⚠️");
  });

  it("囲みの外を押しても掴まない", () => {
    const view = editor("ただの段落\n");
    expect(calloutIcoAt(view, view.dom.querySelector("p"))).toBeNull();
    expect(calloutIcoAt(view, null)).toBeNull();
  });
});

describe("トグル", () => {
  const TOGGLE = "<details>\n<summary>ひらく</summary>\n\n中の本文\n\n</details>\n";
  const press = (el: Element) =>
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

  it("三角を押すと中身を畳み、もう一度押すと戻る", () => {
    const view = editor(TOGGLE);
    const box = view.dom.querySelector(".mg-details")!;
    const mark = box.querySelector(".mg-details-mark")!;
    expect(box.classList.contains("is-closed")).toBe(false);
    press(mark);
    expect(box.classList.contains("is-closed")).toBe(true);
    press(mark);
    expect(box.classList.contains("is-closed")).toBe(false);
    // 畳んでも中身は doc に残る（原文も動かない）
    expect(source()).toBe(TOGGLE);
  });

  it("畳むとき、カーソルが中に居たら手前へ出す", () => {
    const view = editor("前の段落\n\n" + TOGGLE);
    // トグルの中身（段落）の中へカーソルを置く
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent === "中の本文") at = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    press(view.dom.querySelector(".mg-details-mark")!);
    expect(view.state.selection.from).toBeLessThan(at);
    expect(view.state.doc.resolve(view.state.selection.from).parent.textContent).toBe(
      "前の段落",
    );
  });

  it("題は本文として描かれる（入力欄ではない）", () => {
    const view = editor(TOGGLE);
    const head = view.dom.querySelector(".mg-details-head")!;
    expect(head.textContent).toBe("ひらく");
    expect(head.querySelector("input")).toBeNull();
    // 中身は題の後ろに並ぶ
    expect(view.state.doc.child(0).child(0).type.name).toBe("detailsSummary");
    expect(view.state.doc.child(0).child(1).textContent).toBe("中の本文");
  });

  it("見出しトグルは見出しのタグで描く", () => {
    const view = editor("<details>\n<summary><h2>決め方</h2></summary>\n\n中の本文\n\n</details>\n");
    const head = view.dom.querySelector(".mg-details-head")!;
    expect(head.querySelector("h2")?.textContent).toBe("決め方");
    expect(view.state.doc.child(0).child(0).attrs.level).toBe(2);
  });
});
