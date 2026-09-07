// @vitest-environment jsdom
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ReviewThread } from "../review";
import { editorMarks, editorPending } from "./editorMarks";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import type { Anchored } from "./reviewAnchors";

// 編集面の印。jsdom は描画を持たないので、箱は当て木で置く。見るのは
// 「どの節点に、箇所の塗りか枠のどちらが出るか」。

const rects = new WeakMap<Element, DOMRect>();
const boxOf = (el: Element) => rects.get(el) ?? new DOMRect(0, 0, 0, 0);

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return boxOf(this);
  };
  const ofRange = function (this: Range): DOMRect {
    const el =
      this.startContainer instanceof Element
        ? this.startContainer
        : this.startContainer.parentElement;
    // 節点の入れ物まで辿って、その箱を少し内側にした 1 本とみなす。
    for (let at = el; at; at = at.parentElement) {
      const box = rects.get(at);
      if (box) {
        return new DOMRect(box.left + 2, box.top + 2, Math.max(0, box.width - 4), box.height);
      }
    }
    return new DOMRect(0, 0, 0, 0);
  };
  Range.prototype.getBoundingClientRect = ofRange;
  Range.prototype.getClientRects = function () {
    return [ofRange.call(this)] as unknown as DOMRectList;
  };
});

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

// 節点ごとの箱を上から順に積む。
function editor(body: string) {
  const loaded = fromMarkdown(body);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({
      doc: loaded.doc,
      plugins: editorPlugins({ onSave: () => {} }),
    }),
  });
  view.state.doc.forEach((_node, pos, index) => {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) rects.set(dom, new DOMRect(0, index * 100, 600, 100));
  });
  open = { view, loaded, place };
  return { view, loaded };
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

function posOf(view: EditorView, index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += view.state.doc.child(i).nodeSize;
  return at;
}

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "t1",
    file: "/doc.md",
    quote: "まんなかの段落。",
    block_hash: "",
    selection: "まんなか",
    selection_offset: 0,
    section_path: [],
    base_version: "v1",
    status: { kind: "open" },
    comments: [{ id: "c1", author: "you", body: "ここ直して", created_at: 1 }],
    created_at: 1,
    ...over,
  };
}

const anchored = (pos: number, over: Partial<Anchored> = {}): Anchored => ({
  id: "t1",
  pos,
  covered: 1,
  moved: false,
  guess: false,
  ...over,
});

const SRC = `はじめの段落。

まんなかの段落。

おわりの段落。
`;

const base = new DOMRect(0, 0, 600, 300);

describe("editorMarks", () => {
  it("箇所が見つかれば塗りだけを出す", () => {
    const { view } = editor(SRC);
    const marks = editorMarks(view, base, [anchored(posOf(view, 1))], [thread()]);
    expect(marks).toHaveLength(1);
    expect(marks[0].spots.length).toBeGreaterThan(0);
    expect(marks[0].areas).toHaveLength(0);
    expect(marks[0].note).toBe("ここ直して");
  });

  it("書き換わっていれば枠も添える", () => {
    const { view } = editor(SRC);
    const marks = editorMarks(
      view,
      base,
      [anchored(posOf(view, 1), { moved: true })],
      [thread()],
    );
    expect(marks[0].areas.length).toBeGreaterThan(0);
    expect(marks[0].spots.length).toBeGreaterThan(0);
  });

  it("箇所が残っていなければ枠だけを出す", () => {
    const { view } = editor(SRC);
    const marks = editorMarks(
      view,
      base,
      [anchored(posOf(view, 1))],
      [thread({ selection: "もう無いことば" })],
    );
    expect(marks[0].spots).toHaveLength(0);
    expect(marks[0].areas.length).toBeGreaterThan(0);
  });

  it("またいだ指摘は覆っている節点の枠を並べる", () => {
    const { view } = editor(SRC);
    const marks = editorMarks(
      view,
      base,
      [anchored(posOf(view, 1), { covered: 2 })],
      [thread()],
    );
    expect(marks[0].areas).toHaveLength(2);
    expect(marks[0].spots).toHaveLength(0);
    expect(marks[0].areas[1].top).toBe(200);
  });

  it("台帳に無い居場所は出さない", () => {
    const { view } = editor(SRC);
    expect(editorMarks(view, base, [anchored(posOf(view, 1))], [])).toHaveLength(0);
  });

  it("矩形は重ねる先の左上からの座標で返す", () => {
    const { view } = editor(SRC);
    const marks = editorMarks(
      view,
      new DOMRect(0, 40, 600, 300),
      [anchored(posOf(view, 1))],
      [thread()],
    );
    expect(marks[0].spots[0].top).toBe(100 + 2 - 40);
  });
});

describe("editorPending", () => {
  it("選んだ範囲を出す", () => {
    const { view } = editor(SRC);
    const at = posOf(view, 1);
    const rc = editorPending(view, base, {
      pos: at,
      spot: { from: at + 1, to: at + 5 },
    });
    expect(rc.length).toBeGreaterThan(0);
  });

  it("ブロック丸ごとなら枠を出す", () => {
    const { view } = editor(SRC);
    const rc = editorPending(view, base, { pos: posOf(view, 1), spot: null });
    expect(rc).toHaveLength(1);
    expect(rc[0].top).toBe(100);
  });
});
