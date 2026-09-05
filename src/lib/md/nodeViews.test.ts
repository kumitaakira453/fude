// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
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
