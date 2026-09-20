// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activeFolderIdAtom,
  folderIgnoresAtom,
  ignoreAtom,
  imageDirAtom,
  liveEditAtom,
  settingsOpenAtom,
  shortcutsOpenAtom,
} from "../state/atoms";
import { Settings } from "./Settings";

// 設定。面は責務で分け、面をまたいで探せる。
//
// 見たいのは「探している設定に辿り着けること」。面の切り替えと絞り込みが
// その 2 つの道なので、両方を押さえる。

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("9.9.9") }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let store: ReturnType<typeof createStore>;

function open(before?: (s: ReturnType<typeof createStore>) => void) {
  store = createStore();
  store.set(settingsOpenAtom, true);
  before?.(store);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Provider store={store}>
        <Settings />
      </Provider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  // 控えは窓ごとに残る。次の試しへ持ち越すと、書いていない値が入っている。
  localStorage.clear();
});

const box = () => document.querySelector<HTMLElement>(".mg-set")!;
const text = () => box().textContent ?? "";
// Beta の札も同じ入れ物に入るので、名前だけを見る。
const names = () =>
  Array.from(box().querySelectorAll(".mg-set-row-name")).map((el) =>
    (el.textContent ?? "").replace(/Beta$/, ""),
  );
const face = (label: string) =>
  Array.from(box().querySelectorAll<HTMLElement>(".mg-set-tab")).find((el) =>
    el.textContent?.includes(label),
  )!;
const find = () => box().querySelector<HTMLInputElement>(".mg-set-find input")!;

const type = (value: string) => {
  const field = find();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("面を責務で分ける", () => {
  it("はじめは見た目の面", () => {
    open();
    expect(text()).toContain("テーマ");
    expect(text()).toContain("書体");
  });

  it("書く面には、書くときの設定だけを出す", () => {
    open();
    act(() => face("書く").click());
    expect(names()).toContain("リアルタイム編集");
    expect(names()).toContain("画像の置き場所");
    // ファイル一覧の設定は混ぜない。
    expect(names()).not.toContain("Markdown 以外も並べる");
  });

  it("ファイルの面には、一覧まわりだけを出す", () => {
    open();
    act(() => face("ファイル").click());
    expect(names()).toContain("Markdown 以外も並べる");
    expect(names()).toContain("一覧から外すもの");
  });

  it("試験中という面は持たない（熟し具合は札で示す）", () => {
    open();
    expect(text()).not.toContain("試験中");
    act(() => face("書く").click());
    expect(box().querySelector(".mg-set-beta")).not.toBeNull();
  });
});

describe("設定を探す", () => {
  it("面をまたいで当てる", () => {
    open();
    type("画像");
    // 「書く」の画像の置き場所と、「ファイル」の Markdown 以外も並べる
    expect(names()).toContain("画像の置き場所");
    expect(names()).toContain("Markdown 以外も並べる");
  });

  it("当たった項目がどの面のものかを添える", () => {
    open();
    type("画像の置き場所");
    expect(box().querySelector(".mg-set-where")?.textContent).toBe("書く");
  });

  it("別名でも当たる", () => {
    open();
    type("wysiwyg");
    expect(names()).toContain("リアルタイム編集");
  });

  it("絞り込んでいるあいだは面の切り替えを出さない", () => {
    open();
    type("画像");
    expect(box().querySelector(".mg-set-tabs")).toBeNull();
  });

  it("当たりが無ければその旨を出す（黙って空にしない）", () => {
    open();
    type("そんな設定はない");
    expect(box().querySelector(".mg-set-none")?.textContent).toContain("ありません");
  });

  it("消せば面の並びへ戻る", () => {
    open();
    type("画像");
    type("");
    expect(box().querySelector(".mg-set-tabs")).not.toBeNull();
  });
});

describe("触ったら効く", () => {
  it("スイッチを押すと設定が変わる", () => {
    open();
    act(() => face("書く").click());
    expect(store.get(liveEditAtom)).toBe(false);
    const row = Array.from(box().querySelectorAll<HTMLElement>(".mg-set-row")).find((el) =>
      el.textContent?.includes("リアルタイム編集"),
    )!;
    act(() => row.click());
    expect(store.get(liveEditAtom)).toBe(true);
  });

  it("打ち込みの欄がそのまま設定になる", () => {
    open();
    act(() => face("書く").click());
    const field = box().querySelector<HTMLInputElement>(".mg-set-drop input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(field, "素材");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(store.get(imageDirAtom)).toBe("素材");
  });

  it("キー操作の一覧へ渡す（設定は閉じる）", () => {
    open();
    act(() => face("このアプリ").click());
    const row = Array.from(box().querySelectorAll<HTMLElement>(".mg-set-row")).find((el) =>
      el.textContent?.includes("キー操作"),
    )!;
    act(() => row.click());
    expect(store.get(settingsOpenAtom)).toBe(false);
    expect(store.get(shortcutsOpenAtom)).toBe(true);
  });

  it("Esc で閉じる", () => {
    open();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(store.get(settingsOpenAtom)).toBe(false);
  });
});

describe("一覧から外すもの", () => {
  const side = (label: string) =>
    Array.from(box().querySelectorAll<HTMLElement>(".mg-set-sides button")).find(
      (el) => el.textContent === label,
    )!;
  const field = () => box().querySelector<HTMLTextAreaElement>(".mg-set-drop textarea")!;
  const foot = () => box().querySelector<HTMLElement>(".mg-set-sides-foot")!;
  const act_ = (label: string) =>
    Array.from(foot().querySelectorAll<HTMLElement>("button")).find(
      (el) => el.textContent === label,
    )!;
  const write = (value: string) =>
    act(() => {
      const el = field();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const toFiles = () => act(() => face("ファイル").click());

  it("フォルダを開いていなければ、そのフォルダだけの決まりは選べない", () => {
    open((s) => s.set(activeFolderIdAtom, null));
    toFiles();
    expect(side("いまのフォルダ").hasAttribute("disabled")).toBe(true);
  });

  it("決まりが無いフォルダでは共通を読むだけにする", () => {
    open((s) => {
      s.set(activeFolderIdAtom, "/work/ark");
      s.set(ignoreAtom, "node_modules/");
    });
    toFiles();
    act(() => side("いまのフォルダ").click());
    expect(field().value).toBe("node_modules/");
    expect(field().readOnly).toBe(true);
    expect(foot().textContent).toContain("共通の決まりで外しています");
  });

  it("決まりを作ると、そのフォルダにだけ入る", () => {
    open((s) => {
      s.set(activeFolderIdAtom, "/work/ark");
      s.set(ignoreAtom, "node_modules/");
    });
    toFiles();
    act(() => side("いまのフォルダ").click());
    act(() => act_("このフォルダだけの決まりを作る").click());
    write("target/");
    expect(store.get(folderIgnoresAtom)).toEqual({ "/work/ark": "target/" });
    // 共通は動かさない。
    expect(store.get(ignoreAtom)).toBe("node_modules/");
  });

  it("共通に戻すと、そのフォルダの決まりが消える", () => {
    open((s) => {
      s.set(activeFolderIdAtom, "/work/ark");
      s.set(folderIgnoresAtom, { "/work/ark": "target/", "/work/other": "*.bak" });
    });
    toFiles();
    act(() => side("いまのフォルダ").click());
    act(() => act_("共通に戻す").click());
    expect(store.get(folderIgnoresAtom)).toEqual({ "/work/other": "*.bak" });
  });

  it("共通の面では共通を書く", () => {
    open((s) => s.set(activeFolderIdAtom, "/work/ark"));
    toFiles();
    write("*.lock");
    expect(store.get(ignoreAtom)).toBe("*.lock");
    expect(store.get(folderIgnoresAtom)).toEqual({});
  });
});
