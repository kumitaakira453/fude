// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "../../lib/review";

// 一覧から解決にしたとき、押した一枚で札が下がること。
//
// 台帳への書き込みと読み直しを待ってから消すと、押しても何も起きない間が
// できて、効いていないように見える。ここで見たいのはその順番なので、
// 書き込みは「まだ終わらない約束」に差し替えて確かめる。

let letGo: (ok: boolean) => void = () => {};

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: () => Promise.resolve(true),
  message: () => Promise.resolve(),
}));
vi.mock("../../lib/review", async (real) => {
  const mod = await real<typeof import("../../lib/review")>();
  return {
    ...mod,
    resolveThread: () => new Promise<boolean>((done) => (letGo = done)),
    reopenThread: () => Promise.resolve(true),
    readVersion: () => Promise.resolve(null),
    reviewPrompt: () => "",
  };
});
vi.mock("../../state/review", async (real) => {
  const mod = await real<typeof import("../../state/review")>();
  return { ...mod, syncLedger: () => Promise.resolve() };
});

const { ReviewScreen } = await import("./ReviewScreen");
const { ledgerAtom, reviewThreadAtom } = await import("../../state/review");
const { activeFolderIdAtom, contentCacheAtom, reviewFilterAtom, reviewListWidthAtom } = await import(
  "../../state/atoms",
);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  // jsdom に無いもの。印（::highlight）の登録先を探すときに見る。
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s) => s };
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const thread = (id: string, body: string, extra: Partial<ReviewThread> = {}): ReviewThread => ({
  id,
  file: "/docs/a.md",
  quote: "本文",
  block_hash: "",
  selection: "本文",
  selection_offset: 0,
  section_path: [],
  base_version: "v1",
  status: { kind: "open" },
  comments: [{ id: `c-${id}`, author: "you", body, created_at: 0 }],
  created_at: 0,
  ...extra,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function show(
  threads = [thread("t1", "ひとつめ"), thread("t2", "ふたつめ")],
  filter: "todo" | "open" | "done" = "open",
) {
  const store = createStore();
  store.set(ledgerAtom, { version: 1, threads, versions: [] } as never);
  store.set(activeFolderIdAtom, "/docs");
  store.set(contentCacheAtom, new Map([["/docs/a.md", "本文\n"]]));
  store.set(reviewFilterAtom, filter);
  store.set(reviewThreadAtom, threads[0]?.id ?? null);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <ReviewScreen />
      </Provider>,
    ),
  );
  return store;
}

const cards = () => [...document.querySelectorAll(".mg-thread-card")].map((e) => e.textContent);

describe("一覧から解決にする", () => {
  it("書き込みを待たずに、押した札がその場で下がる", () => {
    show();
    expect(cards().join("")).toContain("ひとつめ");
    const done = document.querySelectorAll(".mg-thread-done")[0] as HTMLButtonElement;
    act(() => done.click());
    // まだ台帳は書き終えていない（letGo を呼んでいない）。
    expect(cards().join("")).not.toContain("ひとつめ");
    expect(cards().join("")).toContain("ふたつめ");
  });

  it("しくじったら戻す", async () => {
    show();
    const done = document.querySelectorAll(".mg-thread-done")[0] as HTMLButtonElement;
    act(() => done.click());
    expect(cards().join("")).not.toContain("ひとつめ");
    await act(async () => {
      letGo(false);
      await Promise.resolve();
    });
    expect(cards().join("")).toContain("ひとつめ");
  });
});

// 同じファイルの別のコメントへ移るとき。本文は組み直さず（右の表示を作り直すと
// 選ぶたびに 1 秒以上固まった）、返信の下書きは持ち越さない。
describe("同じファイルのコメントを渡り歩く", () => {
  const settle = () =>
    act(async () => {
      await new Promise((ok) => setTimeout(ok, 60));
    });
  const draft = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="返信を書く"]');

  it("本文を出している入れ物はそのまま、返信の下書きは空に戻る", async () => {
    show();
    await settle();
    const doc = document.querySelector(".mg-doc");
    expect(doc).not.toBeNull();
    const box = draft()!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "下書き");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(draft()!.value).toBe("下書き");
    const second = document.querySelectorAll<HTMLElement>(".mg-thread-card")[1];
    act(() => second.click());
    await settle();
    expect(document.querySelector(".mg-doc")).toBe(doc);
    expect(draft()!.value).toBe("");
  });
});

// 受信箱の絞り込み。未対応は「最後の発言が自分でないもの」、新しい順に並ぶ。
describe("絞り込みと並び", () => {
  const ai = (id: string, body: string, at: number) =>
    thread(id, body, {
      comments: [
        { id: `c-${id}`, author: "you", body, created_at: 0 },
        { id: `r-${id}`, author: "AI", body: "返信", created_at: at },
      ],
    });
  const list = () => [
    ai("a", "古い返信", 10),
    thread("b", "自分が最後"),
    ai("c", "新しい返信", 20),
    thread("d", "片付いた", { status: { kind: "resolved", by: "you", at: 1 } }),
  ];
  const segs = () =>
    [...document.querySelectorAll(".mg-seg button")].map((b) => b.textContent);

  it("未対応・未解決の件数を切り替えに出す", () => {
    show(list(), "todo");
    expect(segs()).toEqual(["未対応2", "未解決3", "解決済み"]);
  });

  it("未対応は自分が応える番のものだけを、最後の発言の新しい順に並べる", () => {
    show(list(), "todo");
    // 選んでいる先頭（a）は条件に合うので、そのまま並びに入る。
    const shown = cards();
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain("新しい返信");
    expect(shown[1]).toContain("古い返信");
  });

  it("解決済みでは、未解決に戻す釦になる", async () => {
    show(list(), "done");
    expect(cards().join("")).toContain("片付いた");
    expect(document.querySelector(".mg-thread-done")?.getAttribute("title")).toContain("未解決に戻す");
  });

  it("切り替えは押した 1 枚で効いた見た目になり、一覧はその後で組み直す", async () => {
    show(list(), "todo");
    // 開いた直後の受け取りを済ませてから押す。
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 60));
    });
    const done = [...document.querySelectorAll<HTMLButtonElement>(".mg-seg button")].find((b) =>
      b.textContent?.startsWith("解決済み"),
    )!;
    act(() => done.click());
    expect(done.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".mg-inbox-list.is-pending")).not.toBeNull();
    expect(cards().join("")).not.toContain("片付いた");
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 60));
    });
    expect(document.querySelector(".mg-inbox-list.is-pending")).toBeNull();
    expect(cards().join("")).toContain("片付いた");
  });

  it("↓ と ↑ で一覧の前後へ移る", () => {
    const store = show(list(), "open");
    const at = () => store.get(reviewThreadAtom);
    // 新しい順：c, a, b。最初は先頭に渡した a を選んでいる。
    expect(at()).toBe("a");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(at()).toBe("b");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });
    expect(at()).toBe("a");
  });
});

// 左の一覧も、右の欄と同じ仕切りで幅を変えられる。上下限で収め、二度押しで戻る。
describe("一覧の幅", () => {
  const at = (name: string, x: number, target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(new MouseEvent(name, { bubbles: true, clientX: x, button: 0 }));
    });
  const list = () => document.querySelector<HTMLElement>(".mg-inbox")!;
  const grip = () => list().nextElementSibling as HTMLElement;

  it("仕切りを引くと一覧の幅が変わり、離したときに覚える", () => {
    const store = show();
    expect(list().style.width).toBe("400px");
    expect(grip().classList.contains("mg-side-grip")).toBe(true);
    at("pointerdown", 400, grip());
    at("pointermove", 480);
    expect(list().style.width).toBe("480px");
    at("pointerup", 480);
    expect(store.get(reviewListWidthAtom)).toBe(480);
  });

  it("頭の段の説明は短く、狭めても折り返さない", () => {
    show();
    const label = document.querySelector(".mg-inbox-head-label");
    expect(label?.textContent).toBe("新しい順");
  });

  it("下限より狭くならず、二度押しで 400px に戻る", () => {
    const store = show();
    at("pointerdown", 400, grip());
    at("pointermove", 100);
    at("pointerup", 100);
    expect(store.get(reviewListWidthAtom)).toBe(280);
    act(() => {
      grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(store.get(reviewListWidthAtom)).toBe(400);
  });
});
