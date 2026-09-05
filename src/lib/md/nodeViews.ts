import type { Node as PmNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from "prosemirror-view";
import { renderMermaid } from "../mermaid";
import { MERMAID, PLAIN, languages } from "./highlight";
import { schema } from "./schema";

// 編集面の専用の描画。
//
// 読むときは React の部品（CodeBlock / Mermaid / MdImage）が描いている。編集面は
// ProseMirror が DOM を持つので、同じ形を NodeView で組む。外側のクラスは読むときと
// 同じものを当てるので、見た目の指定は 1 か所のまま両方に効く。

// 図の見せ方。読むときと同じ「図だけ」を既定にする。
export type MermaidMode = "code" | "split" | "diagram";

const MODES: { mode: MermaidMode; icon: string; label: string }[] = [
  { mode: "code", icon: "code", label: "ソース" },
  { mode: "split", icon: "horizontal_split", label: "分割" },
  { mode: "diagram", icon: "visibility", label: "図" },
];

// 打ち終わってから描き直すまでの待ち。打つたびに描くと図が跳ねる。
const REDRAW_DELAY = 250;

export interface EditorDeps {
  // 図の明暗。mermaid は暗い / 明るいの 2 通りしか描き分けない。
  dark: boolean;
  // 相対パスの画像をローカルから解く。読むときの MdImage と同じ経路。
  resolveAsset?: (src: string) => Promise<string | null>;
  peekAsset?: (src: string) => string | null;
  // 図の拡大。モーダルは React の側にあるので、開く合図だけを出す。
  onZoom?: (svg: string, onEdit: () => void) => void;
  // 図の見せ方の控え。id を鍵に、この編集面が開いている間だけ持つ。
  modes: Map<string, MermaidMode>;
  // 描き直しの頼み口。テーマの明暗が変わったとき、開いている図をまとめて描き直す。
  redraws: Set<() => void>;
}

function icon(name: string, size = 15): HTMLElement {
  const el = document.createElement("span");
  el.className = "material-symbols-rounded select-none leading-none";
  el.style.fontSize = `${size}px`;
  el.style.fontVariationSettings = `'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`;
  el.setAttribute("aria-hidden", "true");
  el.textContent = name;
  return el;
}

// 言語を選ぶ小窓。OS の一覧はアプリの見た目から浮くので、自分で出す。
// 塊は角丸のために overflow を切っているので、小窓は body に置いて画面座標で貼る。
function pickLang(
  anchor: HTMLElement,
  current: string | null,
  onPick: (value: string) => void,
) {
  const menu = document.createElement("div");
  menu.className = "mg-lang-menu";

  const filter = document.createElement("input");
  filter.className = "mg-lang-filter";
  filter.type = "text";
  filter.placeholder = "言語をしぼる";
  menu.appendChild(filter);

  const list = document.createElement("div");
  list.className = "mg-lang-list";
  menu.appendChild(list);

  const close = () => {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    menu.remove();
  };
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const draw = (needle: string) => {
    const want = needle.trim().toLowerCase();
    list.replaceChildren(
      ...languages(current)
        .filter((name) => !want || name.includes(want))
        .map((name) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "mg-lang-row";
          if (name === (current ?? PLAIN)) row.classList.add("is-on");
          row.textContent = name;
          row.addEventListener("mousedown", (e) => e.preventDefault());
          row.addEventListener("click", () => {
            close();
            onPick(name);
          });
          return row;
        }),
    );
  };
  draw("");
  filter.addEventListener("input", () => draw(filter.value));

  document.body.appendChild(menu);
  // 下に入らなければ上へ出す。押した札の左端に頭を揃える。
  const at = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const below = window.innerHeight - at.bottom;
  menu.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))}px`;
  menu.style.top =
    below > box.height + 12
      ? `${at.bottom + 4}px`
      : `${Math.max(8, at.top - box.height - 4)}px`;

  filter.focus();
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}

function button(name: string, title: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "mg-code-btn";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.appendChild(icon(name));
  // 押した拍子に編集面から焦点が外れると、書いていた場所を見失う。
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return el;
}

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: PmNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private deps: EditorDeps;

  private head: HTMLElement;
  private lang: HTMLButtonElement;
  private copy: HTMLButtonElement;
  private tools: HTMLElement;
  private stage: HTMLElement;
  private canvas: HTMLElement;
  private error: HTMLElement;
  private picks = new Map<MermaidMode, HTMLButtonElement>();

  // 描き直しの待ちと世代。遅れて返った古い図で新しい図を潰さない。
  private timer = 0;
  private seq = 0;
  private svg = "";
  private dead = false;
  private redraw = () => this.draw(true);

  constructor(
    node: PmNode,
    view: EditorView,
    getPos: () => number | undefined,
    deps: EditorDeps,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.deps = deps;

    this.dom = document.createElement("div");
    this.dom.className = "mg-codeblock mg-pm-code";

    const head = document.createElement("div");
    head.className = "mg-code-head";
    head.contentEditable = "false";
    this.head = head;

    this.lang = document.createElement("button");
    this.lang.type = "button";
    this.lang.className = "mg-code-lang";
    this.lang.title = "言語";
    this.lang.addEventListener("mousedown", (e) => e.preventDefault());
    this.lang.addEventListener("click", () =>
      pickLang(this.lang, this.node.attrs.lang as string | null, (value) =>
        this.setLang(value),
      ),
    );
    head.appendChild(this.lang);

    this.tools = document.createElement("div");
    this.tools.className = "mg-code-tools";

    const picker = document.createElement("div");
    picker.className = "mg-code-modes";
    for (const { mode, icon: name, label } of MODES) {
      const b = button(name, label, () => this.setMode(mode));
      picker.appendChild(b);
      this.picks.set(mode, b);
    }
    this.tools.appendChild(picker);
    const zoom = button("zoom_out_map", "拡大", () => this.zoom());
    zoom.classList.add("mg-code-zoom");
    this.tools.appendChild(zoom);

    this.copy = button("content_copy", "コピー", () => void this.toClipboard());
    this.tools.appendChild(this.copy);
    head.appendChild(this.tools);
    this.dom.appendChild(head);

    // 図。押すと拡大する。中の文字は編集の対象ではない。
    this.stage = document.createElement("div");
    this.stage.className = "mg-mermaid";
    this.stage.contentEditable = "false";
    this.stage.title = "クリックで拡大";
    this.stage.addEventListener("click", () => this.zoom());
    this.canvas = document.createElement("div");
    this.canvas.className = "mg-mermaid-inner";
    this.stage.appendChild(this.canvas);

    this.error = document.createElement("div");
    this.error.className = "mg-mermaid-err";
    this.error.contentEditable = "false";

    const pre = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    pre.appendChild(this.contentDOM);
    this.dom.appendChild(pre);
    // 図はソースの下。両方出すときは、書いた結果が下に出るほうが読み順に合う。
    this.dom.appendChild(this.error);
    this.dom.appendChild(this.stage);

    deps.redraws.add(this.redraw);
    this.paint();
  }

  // 言語の札と見せ方を、いまの節点に合わせる。
  private paint() {
    const lang = this.node.attrs.lang as string | null;
    const isMermaid = lang === MERMAID;
    this.lang.textContent = lang ?? PLAIN;

    this.dom.classList.toggle("is-mermaid", isMermaid);
    const mode = this.mode();
    this.dom.dataset.mode = isMermaid ? mode : "code";
    for (const [m, b] of this.picks) b.classList.toggle("is-on", m === mode);

    if (isMermaid) {
      this.draw();
    } else {
      this.canvas.replaceChildren();
      this.error.textContent = "";
      this.svg = "";
    }
  }

  private id(): string | null {
    return (this.node.attrs.id as string | null) ?? null;
  }

  private mode(): MermaidMode {
    const id = this.id();
    return (id && this.deps.modes.get(id)) || "diagram";
  }

  private setMode(mode: MermaidMode) {
    const id = this.id();
    if (id) this.deps.modes.set(id, mode);
    this.dom.dataset.mode = mode;
    for (const [m, b] of this.picks) b.classList.toggle("is-on", m === mode);
    this.view.focus();
  }

  // 言語を選び直す。図を選んだときは、書いた本人がまだ触っている最中なので
  // ソースを残したまま図を足す。
  private setLang(value: string) {
    const at = this.getPos();
    if (at === undefined) return;
    const lang = value === PLAIN ? null : value;
    if (value === MERMAID) {
      const id = this.id();
      if (id) this.deps.modes.set(id, "split");
    }
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(at, undefined, {
        ...this.node.attrs,
        lang,
        // 字下げで書かれた塊に言語は付けられない。囲みへ移す。
        fenced: true,
        fence: (this.node.attrs.fence as string) || "```",
      }),
    );
    this.view.focus();
  }

  private zoom() {
    if (!this.svg || !this.deps.onZoom) return;
    // 鉛筆は分割へ移してソースの先頭にカーソルを置く。編集面ではソースが
    // 目の前にあるので、別の編集窓は開かない。
    this.deps.onZoom(this.svg, () => {
      this.setMode("split");
      const at = this.getPos();
      if (at === undefined) return;
      const { state } = this.view;
      this.view.dispatch(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(at + 1)))
          .scrollIntoView(),
      );
      this.view.focus();
    });
  }

  private async toClipboard() {
    try {
      await navigator.clipboard.writeText(this.node.textContent);
      this.copy.classList.add("is-done");
      window.setTimeout(() => this.copy.classList.remove("is-done"), 1400);
    } catch {
      /* クリップボードが使えないときは黙って諦める */
    }
  }

  // 図を描く。書きかけで構文が通らない間は、直前に描けた図を残す。
  private draw(now = false) {
    const code = this.node.textContent.trim();
    window.clearTimeout(this.timer);
    if (!code) {
      this.canvas.replaceChildren();
      this.error.textContent = "";
      this.svg = "";
      return;
    }
    const run = () => {
      const token = ++this.seq;
      void renderMermaid(code, this.deps.dark)
        .then((svg) => {
          if (this.dead || token !== this.seq) return;
          this.svg = svg;
          this.canvas.innerHTML = svg;
          this.error.textContent = "";
        })
        .catch((e: { message?: string }) => {
          if (this.dead || token !== this.seq) return;
          this.error.textContent = String(e?.message || e);
        });
    };
    if (now || !this.svg) run();
    else this.timer = window.setTimeout(run, REDRAW_DELAY);
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    const wasText = this.node.textContent;
    const wasLang = this.node.attrs.lang;
    this.node = node;
    if (node.attrs.lang !== wasLang) this.paint();
    else if (node.attrs.lang === MERMAID && node.textContent !== wasText) this.draw();
    return true;
  }

  // 帯と図の中の操作は編集面に渡さない。塊の余白を押したときは渡す（行頭に
  // カーソルを置く手が塞がる）。
  stopEvent(event: Event): boolean {
    const at = event.target;
    if (!(at instanceof Node)) return false;
    return this.head.contains(at) || this.stage.contains(at) || this.error.contains(at);
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(m.target);
  }

  destroy() {
    this.dead = true;
    this.deps.redraws.delete(this.redraw);
    window.clearTimeout(this.timer);
  }
}

class ImageView implements NodeView {
  // ProseMirror はこの要素を覚えるので、後から差し替えない。中身だけ入れ替える。
  dom: HTMLElement;
  private alive = true;
  private alt: string;
  private title: string | null;

  constructor(node: PmNode, deps: EditorDeps) {
    const src = node.attrs.src as string;
    this.alt = node.attrs.alt as string;
    this.title = node.attrs.title as string | null;
    const remote = /^(https?:|data:|blob:)/.test(src);
    const at = remote ? src : (deps.peekAsset?.(src) ?? null);

    this.dom = document.createElement("span");
    this.dom.className = "mg-img";
    this.fill(at);

    if (!remote && !at && deps.resolveAsset) {
      void deps.resolveAsset(src)
        .then((found) => this.fill(found))
        .catch(() => this.fill(null));
    }
  }

  // 解けたら画像、解けなければ読むときと同じ枠。
  private fill(src: string | null) {
    if (!this.alive) return;
    if (!src) {
      const box = document.createElement("span");
      box.className =
        "mg-img-missing inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--mg-border)] px-2 py-1 text-xs text-[var(--mg-muted)]";
      box.textContent = `🖼 ${this.alt || "画像"}`;
      this.dom.replaceChildren(box);
      return;
    }
    const el = document.createElement("img");
    el.src = src;
    el.alt = this.alt;
    if (this.title) el.title = this.title;
    el.loading = "lazy";
    el.className = "mx-auto my-4 max-w-full rounded-lg shadow-md";
    this.dom.replaceChildren(el);
  }

  destroy() {
    this.alive = false;
  }
}

export function nodeViews(deps: EditorDeps) {
  return {
    codeBlock: (node: PmNode, view: EditorView, getPos: () => number | undefined) =>
      new CodeBlockView(node, view, getPos, deps),
    image: (node: PmNode) => new ImageView(node, deps),
  };
}

// カーソルの居るブロックに印を付ける。図だけを出しているときにカーソルが
// 入ると見えなくなるので、そのときだけソースを出すのに使う。
export const insideBlock = new Plugin({
  props: {
    decorations(state) {
      const { $head } = state.selection;
      for (let d = $head.depth; d > 0; d--) {
        if ($head.node(d).type !== schema.nodes.codeBlock) continue;
        const at = $head.before(d);
        return DecorationSet.create(state.doc, [
          Decoration.node(at, at + $head.node(d).nodeSize, { class: "is-inside" }),
        ]);
      }
      return null;
    },
  },
});
