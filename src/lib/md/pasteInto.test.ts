// @vitest-environment jsdom
import { DOMParser as PmDOMParser, Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";
import { toMarkdown } from "./toMarkdown";

// 貼り付けたものを、貼り先の項目に合わせる。
//
// TODO の中に素の箇条書きを貼ると、チェックと点が混ざって階層が読めなくなる。
// 階層はそのままに、印だけ貼り先にそろえる。

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
    state: EditorState.create({ doc: loaded.doc, plugins: editorPlugins({ onSave: () => {} }) }),
  });
  open = { view, loaded, place };
  return view;
}

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

function caretEnd(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

// Markdown を貼る。貼り付けの道具（DataTransfer）は jsdom に無いので、
// 読み取ったあとの切れ端を直に流す。
function paste(view: EditorView, text: string) {
  const cut = new Slice(fromMarkdown(text).doc.content, 0, 0);
  const out = view.someProp("transformPasted", (f) => f(cut, view, true)) ?? cut;
  view.dispatch(view.state.tr.replaceSelection(out));
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

describe("貼り付けたものを貼り先にそろえる", () => {
  it("TODO の中に素の箇条書きを貼ると、印が付く", () => {
    const view = editor("- [ ] あ\n");
    caretEnd(view, "あ");
    paste(view, "- 一つ\n- 二つ\n");
    expect(source()).toBe("- [ ] あ\n  - [ ] 一つ\n  - [ ] 二つ\n");
  });

  it("階層はそのまま残る", () => {
    const view = editor("- [ ] あ\n");
    caretEnd(view, "あ");
    paste(view, "- 親\n  - 子\n");
    expect(source()).toContain("  - [ ] 子");
  });

  it("素の項目に TODO を貼ると、印が外れる", () => {
    const view = editor("- あ\n");
    caretEnd(view, "あ");
    paste(view, "- [x] 済み\n- [ ] まだ\n");
    expect(source()).toBe("- あ\n  - 済み\n  - まだ\n");
  });

  it("項目の外ではそのまま貼る", () => {
    const view = editor("段落\n");
    caretEnd(view, "段落");
    paste(view, "- [x] 済み\n");
    expect(source()).toContain("- [x] 済み");
  });
});

describe("DOM から読み返す", () => {
  const read = (html: string) => {
    const place = document.createElement("div");
    place.innerHTML = html;
    return PmDOMParser.fromSchema(schema).parse(place);
  };

  it("項目の印を拾う", () => {
    const list = read('<ul><li data-box="x"><p>済み</p></li></ul>').child(0);
    expect(list.child(0).attrs.box).toBe("x");
  });

  it("まだの項目も印として拾う", () => {
    const list = read('<ul><li data-box=" "><p>まだ</p></li></ul>').child(0);
    expect(list.child(0).attrs.box).toBe(" ");
  });

  it("印の無い項目は素のまま", () => {
    const list = read("<ul><li><p>点</p></li></ul>").child(0);
    expect(list.child(0).attrs.box).toBeNull();
  });
});
