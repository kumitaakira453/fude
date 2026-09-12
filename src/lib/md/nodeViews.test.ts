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

function editor(body: string, path?: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
    nodeViews: nodeViews({ dark: false, modes: new Map(), redraws: new Set(), path }),
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
  const key = (view: EditorView, name: string) =>
    view.someProp("handleKeyDown", (f) =>
      f(view, new KeyboardEvent("keydown", { key: name, bubbles: true })),
    );
  // 題の末尾へカーソルを置く。
  const caretAtEndOfHead = (view: EditorView) => {
    const title = view.state.doc.child(0).child(0);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + title.content.size + 1)),
    );
  };

  it("三角を押すと中身が出て、もう一度押すと畳む", () => {
    const view = editor(TOGGLE);
    const box = view.dom.querySelector(".mg-details")!;
    const mark = box.querySelector(".mg-details-mark")!;
    // 原文が <details> なら閉じて始まる
    expect(box.classList.contains("is-closed")).toBe(true);
    press(mark);
    expect(box.classList.contains("is-closed")).toBe(false);
    press(mark);
    expect(box.classList.contains("is-closed")).toBe(true);
    // 畳んでも中身は doc に残る（原文も動かない）
    expect(source()).toBe(TOGGLE);
  });

  it("原文が <details open> なら開いて始まる", () => {
    const view = editor("<details open>\n<summary>ひらく</summary>\n\n中の本文\n\n</details>\n");
    expect(view.dom.querySelector(".mg-details")!.classList.contains("is-closed")).toBe(
      false,
    );
  });

  it("押して変えた開閉は、作り直しても覚えている", () => {
    const at = "/覚える.md";
    const first = editor(TOGGLE, at);
    press(first.dom.querySelector(".mg-details-mark")!);
    expect(first.dom.querySelector(".mg-details")!.classList.contains("is-closed")).toBe(
      false,
    );
    open?.view.destroy();
    open?.place.remove();

    // 同じファイルを開き直すと、閉じた原文でも開いたまま
    const again = editor(TOGGLE, at);
    expect(again.dom.querySelector(".mg-details")!.classList.contains("is-closed")).toBe(
      false,
    );
    // 別のファイルには移らない
    open?.view.destroy();
    open?.place.remove();
    const other = editor(TOGGLE, "/別.md");
    expect(other.dom.querySelector(".mg-details")!.classList.contains("is-closed")).toBe(
      true,
    );
  });

  it("畳むとき、カーソルが中に居たら手前へ出す", () => {
    const view = editor("前の段落\n\n" + TOGGLE);
    press(view.dom.querySelector(".mg-details-mark")!);
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

  it("畳んだ題で Enter を押すと、次のトグルができてその題へ入る", () => {
    const view = editor(TOGGLE);
    // 原文が <details> なので畳んで始まる
    caretAtEndOfHead(view);
    expect(key(view, "Enter")).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.child(1).type.name).toBe("details");
    expect(view.state.doc.child(1).child(0).type.name).toBe("detailsSummary");
    // カーソルは新しい題の中
    expect(view.state.selection.$from.parent.type.name).toBe("detailsSummary");
    expect(view.state.selection.$from.parent.textContent).toBe("");
  });

  it("開いた題で Enter を押すと、中身の先頭に行ができてそこへ入る", () => {
    const view = editor(TOGGLE);
    press(view.dom.querySelector(".mg-details-mark")!);
    caretAtEndOfHead(view);
    expect(key(view, "Enter")).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.child(0).childCount).toBe(3);
    expect(view.state.selection.$from.parent.textContent).toBe("");
  });

  it("中身の無いトグルは薄く描く印を持つ", () => {
    const view = editor("<details>\n<summary>ひらく</summary>\n\n</details>\n");
    const box = view.dom.querySelector(".mg-details")!;
    expect(box.classList.contains("is-empty")).toBe(true);
    // 中身を書くと外れる
    const at = view.state.doc.child(0).child(0);
    view.dispatch(view.state.tr.insertText("中身", 1 + at.content.size + 2));
    expect(view.dom.querySelector(".mg-details")!.classList.contains("is-empty")).toBe(
      false,
    );
  });

  it("見出しの段を印として出す（三角の置き場所に使う）", () => {
    const view = editor("<details>\n<summary><h2>決め方</h2></summary>\n\n中の本文\n\n</details>\n");
    const box = view.dom.querySelector(".mg-details") as HTMLElement;
    expect(box.dataset.level).toBe("2");
    // 素のトグルに戻すと印も落ちる
    const at = view.state.doc.child(0).child(0);
    view.dispatch(
      view.state.tr.setNodeMarkup(1, undefined, { ...at.attrs, level: null }),
    );
    expect((view.dom.querySelector(".mg-details") as HTMLElement).dataset.level).toBe("0");
  });
});

describe("図の見せ方", () => {
  const SRC = "```mermaid\nflowchart TB\n  A --> B\n```\n\nあとの段落\n";

  // 「図だけ」を押す。塊の頭にある選び手の 3 つめ。
  const pressDiagram = (view: EditorView) => {
    const picks = view.dom.querySelectorAll<HTMLElement>(".mg-code-modes button");
    picks[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    picks[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  it("図だけにすると、カーソルが塊の外へ出る", () => {
    const view = editor(SRC);
    // 塊の中にカーソルを置く
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
    );
    expect(view.state.selection.$head.parent.type.name).toBe("codeBlock");

    pressDiagram(view);

    // 中に居ると、図だけにしてもソースが出たままになる。
    expect(view.state.selection.$head.parent.type.name).not.toBe("codeBlock");
    const box = view.dom.querySelector(".mg-pm-code") as HTMLElement;
    expect(box.dataset.mode).toBe("diagram");
  });

  it("外に居るときは動かさない", () => {
    const view = editor(SRC);
    const end = view.state.doc.content.size - 1;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
    );
    pressDiagram(view);
    expect(view.state.selection.$head.pos).toBe(end);
  });
});
