// @vitest-environment jsdom
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { editorPlugins, eraseLineBack } from "./plugins";
import { toMarkdown } from "./toMarkdown";

// 入れ子の項目で ⌘⌫ を続けて押す。
//
// 1 回目は行の字が消えるだけ（ブラウザの行削除）。そのあとは行の頭に居るので、
// 素の Backspace と同じ後片付け——点を外し、空の行を消す——へ進む必要がある。
// ここが配られていないと、中身の無い項目が点だけ残って積み上がる。

const noRects = () => [] as unknown as DOMRectList;
const noRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = noRects;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = noRects;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = noRect;

let open: { view: EditorView; loaded: Loaded; place: HTMLElement } | null = null;

afterEach(() => {
  open?.view.destroy();
  open?.place.remove();
  open = null;
});

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
  open = { view, loaded, place };
  return view;
}

// text の行の末尾にカーソルを置く。
function tail(view: EditorView, text: string) {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  if (at < 0) throw new Error(`見つからない: ${text}`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

// ⌘⌫ を 1 回。命令が受けなければ、ブラウザの「行の頭まで消す」を真似る
// （jsdom は素の削除をしないので、そこだけ手で補う）。
function erase(view: EditorView): "cmd" | "dom" | "none" {
  if (eraseLineBack(view.state, view.dispatch, view)) return "cmd";
  const { $from } = view.state.selection;
  const from = $from.start();
  if (from >= $from.pos) return "none";
  view.dispatch(view.state.tr.delete(from, $from.pos));
  return "dom";
}

const source = () => toMarkdown(open!.view.state.doc, open!.loaded);

const NEST = `- が
  - がが
`;

describe("⌘⌫ を続けて押す", () => {
  it("1 回目は行の字だけが消える", () => {
    const view = editor(NEST);
    tail(view, "がが");
    expect(erase(view)).toBe("dom");
    expect(view.state.selection.$from.parent.content.size).toBe(0);
  });

  it("空になった項目では点が外れて、押すたび浅くなる", () => {
    const view = editor(NEST);
    tail(view, "がが");
    erase(view);
    expect(erase(view)).toBe("cmd");
    expect(source()).toBe("- が\n-\n");
    expect(erase(view)).toBe("cmd");
    expect(source()).toBe("- が\n\n");
  });

  it("4 回で空の項目が残らない", () => {
    const view = editor(NEST);
    tail(view, "がが");
    for (let i = 0; i < 4; i++) erase(view);
    expect(source()).toBe("- が\n");
  });

  it("字が残っている行では、行の頭までを消すだけ", () => {
    const view = editor("- がが\n");
    tail(view, "がが");
    expect(erase(view)).toBe("dom");
    expect(source()).toBe("-\n");
  });
});
