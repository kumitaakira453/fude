import type { Node as PmNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from "prosemirror-view";
import { renderMermaid } from "../mermaid";
import { covers } from "./decos";
import { MERMAID, PLAIN, languages } from "./highlight";
import { schema, summaryOf, withSummary } from "./schema";

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

export function icon(name: string, size = 15, fill = false): HTMLElement {
  const el = document.createElement("span");
  el.className = "material-symbols-rounded select-none leading-none";
  el.style.fontSize = `${size}px`;
  el.style.fontVariationSettings = `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`;
  el.setAttribute("aria-hidden", "true");
  el.textContent = name;
  return el;
}

// 言語を選ぶ小窓。OS の一覧はアプリの見た目から浮くので、自分で出す。
// 塊は角丸のために overflow を切っているので、小窓は body に置いて画面座標で貼る。
//
// 開いた時点で先頭が選ばれていて、絞り込んで Enter で決められる。
function pickLang(
  anchor: HTMLElement,
  current: string | null,
  onPick: (value: string) => void,
  onDone?: () => void,
) {
  const menu = document.createElement("div");
  menu.className = "mg-lang-menu";

  const find = document.createElement("div");
  find.className = "mg-lang-find";
  find.appendChild(icon("search", 17));
  const filter = document.createElement("input");
  filter.className = "mg-lang-filter";
  filter.type = "text";
  filter.placeholder = "言語";
  find.appendChild(filter);
  menu.appendChild(find);

  const list = document.createElement("div");
  list.className = "mg-lang-list";
  menu.appendChild(list);

  let shown: string[] = [];
  let rows: HTMLButtonElement[] = [];
  let active = 0;

  const close = () => {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    menu.remove();
    onDone?.();
  };
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const take = (name: string) => {
    close();
    onPick(name);
  };
  const mark = () => {
    rows.forEach((row, i) => row.classList.toggle("is-active", i === active));
    rows[active]?.scrollIntoView({ block: "nearest" });
  };
  const move = (by: number) => {
    if (!shown.length) return;
    active = (active + by + shown.length) % shown.length;
    mark();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) take(shown[active]);
    }
  };

  const draw = (needle: string) => {
    const want = needle.trim().toLowerCase();
    shown = languages(current).filter((name) => !want || name.includes(want));
    active = 0;
    rows = shown.map((name) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "mg-lang-row";
      if (name === (current ?? PLAIN)) row.classList.add("is-on");
      row.textContent = name;
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("mouseenter", () => {
        active = shown.indexOf(name);
        mark();
      });
      row.addEventListener("click", () => take(name));
      return row;
    });
    list.replaceChildren(...rows);
    mark();
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
  private name: HTMLElement;
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
    this.name = document.createElement("span");
    this.lang.appendChild(this.name);
    this.lang.appendChild(icon("expand_more", 16));
    this.lang.addEventListener("mousedown", (e) => e.preventDefault());
    this.lang.addEventListener("click", () => {
      // 小窓を出している間は、手が離れても操作を消さない。
      this.head.classList.add("is-open");
      pickLang(
        this.lang,
        this.node.attrs.lang as string | null,
        (value) => this.setLang(value),
        () => this.head.classList.remove("is-open"),
      );
    });
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
    this.name.textContent = lang ?? PLAIN;

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

// 箇条書きの項目。checked が付いているものだけ、読むときと同じチェックを出す。
//
// チェックは編集の対象ではないので、中身とは別の入れ物に分ける。印の無い項目は
// 素の li のまま（点はそのまま出る）。
class ListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: PmNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  // 印の無い項目には無い。
  private check: HTMLButtonElement | null = null;

  constructor(node: PmNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("li");
    const checked = node.attrs.checked as boolean | null;
    if (checked === null) {
      this.contentDOM = this.dom;
      return;
    }

    this.dom.dataset.checked = String(checked);
    // 読むときと同じ印。点を落とす指定がこの印に当たっている。
    this.dom.className = "task-list-item";

    this.check = document.createElement("button");
    this.check.type = "button";
    this.check.className = "mg-task-check";
    this.check.setAttribute("contenteditable", "false");
    // 押した拍子に編集面から焦点が外れると、書いていた場所を見失う。
    this.check.addEventListener("mousedown", (e) => e.preventDefault());
    this.check.addEventListener("click", (e) => {
      e.preventDefault();
      this.flip();
    });
    this.dom.appendChild(this.check);

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "mg-task-body";
    this.dom.appendChild(this.contentDOM);
    this.paint(checked);
  }

  private paint(checked: boolean) {
    if (!this.check) return;
    const label = checked ? "未完了に戻す" : "完了にする";
    this.check.setAttribute("aria-label", label);
    this.check.replaceChildren(
      icon(checked ? "check_box" : "check_box_outline_blank", 20, checked),
    );
  }

  // 原文の "- [ ] " と "- [x] " を入れ替える。
  private flip() {
    const at = this.getPos();
    if (at === undefined) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(at, undefined, {
        ...this.node.attrs,
        checked: !(this.node.attrs.checked as boolean),
      }),
    );
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    const was = this.node.attrs.checked as boolean | null;
    const now = node.attrs.checked as boolean | null;
    // 印が付いた・外れたときは作りが変わる。組み直させる。
    if ((was === null) !== (now === null)) return false;
    this.node = node;
    if (now !== null && now !== was) this.paint(now);
    return true;
  }

  // チェックへの操作は編集面に渡さない。中身を押したときは渡す。
  stopEvent(event: Event): boolean {
    const at = event.target;
    return !!this.check && at instanceof Node && this.check.contains(at);
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return !!this.check && !this.contentDOM.contains(m.target);
  }
}

// トグルの見出し。原文では開きタグの中の <summary> なので、本文のブロックとして
// は編集できない。入力欄として出し、打ったぶんを attrs へ差し戻す。
class DetailsView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: PmNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private head: HTMLElement;
  private title: HTMLInputElement;

  constructor(node: PmNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "mg-details";

    const head = document.createElement("div");
    head.className = "mg-details-head";
    // 入力欄は編集できないところに置いても打てる。ProseMirror には渡さない。
    head.contentEditable = "false";
    // 帯の余白を押したときも見出しを打てるようにする。
    head.addEventListener("mousedown", (e) => {
      if (e.target === head) {
        e.preventDefault();
        this.title.focus();
      }
    });
    this.head = head;
    this.title = document.createElement("input");
    this.title.type = "text";
    this.title.className = "mg-details-title";
    this.title.placeholder = "トグル";
    this.title.value = summaryOf(node.attrs.head as string);
    this.title.addEventListener("input", () => this.push());
    this.title.addEventListener("keydown", (e) => this.onKey(e));
    head.appendChild(this.title);
    this.dom.appendChild(head);

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "mg-details-body";
    this.dom.appendChild(this.contentDOM);
  }

  private push() {
    const at = this.getPos();
    if (at === undefined) return;
    // 原文では生 HTML なので、タグを作れる字は入れさせない。
    const text = this.title.value.replace(/[<>]/g, "");
    const caret = this.title.selectionStart;
    if (text !== this.title.value) this.title.value = text;

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(at, undefined, {
        ...this.node.attrs,
        head: withSummary(this.node.attrs.head as string, text),
      }),
    );
    // 書き換えで焦点が編集面へ戻ることがある。打っている場所へ返す。
    if (document.activeElement !== this.title) {
      this.title.focus();
      if (caret !== null) this.title.setSelectionRange(caret, caret);
    }
  }

  // Enter と下矢印で中身へ入る。Escape は編集面へ戻す。
  private onKey(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "Escape") return;
    e.preventDefault();
    const at = this.getPos();
    if (at === undefined) return;
    const { state } = this.view;
    this.view.dispatch(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(at + 1), 1)).scrollIntoView(),
    );
    this.view.focus();
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const text = summaryOf(node.attrs.head as string);
    // 打っている最中に入れ直すと、カーソルが頭へ戻る。
    if (document.activeElement !== this.title && this.title.value !== text) {
      this.title.value = text;
    }
    return true;
  }

  // 見出しの帯の操作は編集面に渡さない。中身を押したときは渡す。
  stopEvent(event: Event): boolean {
    const at = event.target;
    return at instanceof Node && this.head.contains(at);
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(m.target);
  }
}

export function nodeViews(deps: EditorDeps) {
  return {
    codeBlock: (node: PmNode, view: EditorView, getPos: () => number | undefined) =>
      new CodeBlockView(node, view, getPos, deps),
    details: (node: PmNode, view: EditorView, getPos: () => number | undefined) =>
      new DetailsView(node, view, getPos),
    listItem: (node: PmNode, view: EditorView, getPos: () => number | undefined) =>
      new ListItemView(node, view, getPos),
    image: (node: PmNode) => new ImageView(node, deps),
  };
}

// カーソルの居るブロックに印を付ける。図だけを出しているときにカーソルが
// 入ると見えなくなるので、そのときだけソースを出すのに使う。
//
// 印は状態に持つ。毎回作り直すと ProseMirror は「装飾が変わった」と見なして
// 打鍵ごとに節点を描き直す。同じ塊の中を動いている間も作り直さない
// （範囲を引いている間は選択の変化が毎フレーム来る）。
function insideDecos(state: EditorState, prev: DecorationSet): DecorationSet {
  const { $head } = state.selection;
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type !== schema.nodes.codeBlock) continue;
    const at = $head.before(d);
    const to = at + $head.node(d).nodeSize;
    if (covers(prev, at, to)) return prev;
    return DecorationSet.create(state.doc, [
      Decoration.node(at, to, { class: "is-inside" }),
    ]);
  }
  return DecorationSet.empty;
}

export const insideBlock = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => insideDecos(state, DecorationSet.empty),
    apply: (tr, prev, _old, next) => {
      if (!tr.docChanged && !tr.selectionSet) return prev;
      // 本文が動いたら位置が合わないので、使い回しの相手にはしない。
      return insideDecos(next, tr.docChanged ? DecorationSet.empty : prev);
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
