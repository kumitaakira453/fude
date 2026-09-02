import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import * as A from "../state/atoms";
import {
  activateTab,
  closePane,
  closeTab,
  closeTabAt,
  dropOnPane,
  moveTab,
  openInPane,
  remapLeafPaths,
  reopenTab,
  reviveLayout,
  splitPane,
  type StoredNode,
} from "./ui";

type Store = ReturnType<typeof createStore>;

let store: Store;

beforeEach(() => {
  store = createStore();
  store.set(A.layoutAtom, { kind: "leaf", id: "p1", tabs: [], active: 0 });
  store.set(A.activePaneIdAtom, "p1");
});

const panes = () => store.get(A.panesAtom);
const pane = (id: string) => panes().find((p) => p.id === id);
const first = () => panes()[0];

describe("openInPane", () => {
  it("タブを足して選択する", () => {
    openInPane(store, "p1", "a.md");
    openInPane(store, "p1", "b.md");
    expect(first().tabs).toEqual(["a.md", "b.md"]);
    expect(A.activePath(first())).toBe("b.md");
  });

  it("同じファイルは重ねず、既にあるタブを選ぶ", () => {
    openInPane(store, "p1", "a.md");
    openInPane(store, "p1", "b.md");
    openInPane(store, "p1", "a.md");
    expect(first().tabs).toEqual(["a.md", "b.md"]);
    expect(A.activePath(first())).toBe("a.md");
  });

  it("作用中タブの直後に差し込む", () => {
    openInPane(store, "p1", "a.md");
    openInPane(store, "p1", "b.md");
    activateTab(store, "p1", 0);
    openInPane(store, "p1", "c.md");
    expect(first().tabs).toEqual(["a.md", "c.md", "b.md"]);
    expect(A.activePath(first())).toBe("c.md");
  });
});

describe("closeTab", () => {
  it("作用中より前を閉じたら位置がずれない", () => {
    for (const f of ["a.md", "b.md", "c.md"]) openInPane(store, "p1", f);
    expect(A.activePath(first())).toBe("c.md");
    closeTab(store, "p1", 0);
    expect(first().tabs).toEqual(["b.md", "c.md"]);
    expect(A.activePath(first())).toBe("c.md");
  });

  it("作用中を閉じたら範囲内に収まる", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    closeTab(store, "p1", 1);
    expect(first().tabs).toEqual(["a.md"]);
    expect(A.activePath(first())).toBe("a.md");
  });

  it("単一ペインで最後の 1 枚を閉じると空のまま残る", () => {
    openInPane(store, "p1", "a.md");
    closeTab(store, "p1", 0);
    expect(panes()).toHaveLength(1);
    expect(first().tabs).toEqual([]);
    expect(A.activePath(first())).toBeNull();
  });

  it("分割中に最後の 1 枚を閉じるとペインごと畳む", () => {
    openInPane(store, "p1", "a.md");
    splitPane(store, "row", "b.md");
    expect(panes()).toHaveLength(2);
    const side = store.get(A.activePaneIdAtom);
    closeTab(store, side, 0);
    expect(panes()).toHaveLength(1);
    expect(first().tabs).toEqual(["a.md"]);
  });
});

describe("closeTabAt", () => {
  it("掴んだあと並びが変わっていても、そのファイルを閉じる", () => {
    for (const f of ["a.md", "b.md", "c.md"]) openInPane(store, "p1", f);
    // 引き出している間に手前のタブが閉じられ、位置が 1 つずれた状況
    closeTab(store, "p1", 0);
    closeTabAt(store, "p1", "c.md");
    expect(first().tabs).toEqual(["b.md"]);
  });

  it("既に無いファイルなら何もしない", () => {
    openInPane(store, "p1", "a.md");
    closeTabAt(store, "p1", "gone.md");
    expect(first().tabs).toEqual(["a.md"]);
  });
});

describe("reopenTab", () => {
  it("閉じた位置に戻す", () => {
    for (const f of ["a.md", "b.md", "c.md"]) openInPane(store, "p1", f);
    closeTab(store, "p1", 1);
    expect(first().tabs).toEqual(["a.md", "c.md"]);
    expect(reopenTab(store)).toBe("b.md");
    expect(first().tabs).toEqual(["a.md", "b.md", "c.md"]);
    expect(A.activePath(first())).toBe("b.md");
  });

  it("閉じた順に戻す", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    closeTab(store, "p1", 0);
    closeTab(store, "p1", 0);
    expect(reopenTab(store)).toBe("b.md");
    expect(reopenTab(store)).toBe("a.md");
    expect(first().tabs).toEqual(["a.md", "b.md"]);
  });

  it("控えが無ければ何もしない", () => {
    openInPane(store, "p1", "a.md");
    expect(reopenTab(store)).toBeNull();
    expect(first().tabs).toEqual(["a.md"]);
  });

  it("移動したタブは控えない", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    splitPane(store, "row");
    const side = store.get(A.activePaneIdAtom);
    moveTab(store, { paneId: "p1", index: 0 }, side);
    expect(reopenTab(store)).toBeNull();
  });

  it("既に開き直されていれば次の控えへ進む", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    closeTab(store, "p1", 1); // b.md
    closeTab(store, "p1", 0); // a.md
    openInPane(store, "p1", "a.md");
    expect(reopenTab(store)).toBe("b.md");
  });

  it("ペインごと閉じた分もまとめて控える", () => {
    openInPane(store, "p1", "a.md");
    splitPane(store, "row");
    const side = store.get(A.activePaneIdAtom);
    openInPane(store, side, "b.md");
    closePane(store, side);
    expect(reopenTab(store)).toBe("b.md");
  });
});

describe("moveTab", () => {
  it("同じペイン内で並べ替える", () => {
    for (const f of ["a.md", "b.md", "c.md"]) openInPane(store, "p1", f);
    moveTab(store, { paneId: "p1", index: 2 }, "p1", 0);
    expect(first().tabs).toEqual(["c.md", "a.md", "b.md"]);
    expect(A.activePath(first())).toBe("c.md");
  });

  it("別のペインへ移すと送り側から消える", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    splitPane(store, "row", "z.md");
    const side = store.get(A.activePaneIdAtom);

    moveTab(store, { paneId: "p1", index: 0 }, side);
    expect(pane("p1")?.tabs).toEqual(["b.md"]);
    expect(pane(side)?.tabs).toEqual(["z.md", "a.md"]);
    expect(A.activePath(pane(side))).toBe("a.md");
    expect(store.get(A.activePaneIdAtom)).toBe(side);
  });

  it("送り側が最後の 1 枚でも移した先は残る", () => {
    openInPane(store, "p1", "a.md");
    splitPane(store, "row", "z.md");
    const side = store.get(A.activePaneIdAtom);
    moveTab(store, { paneId: side, index: 0 }, "p1");
    // 送り側は空になったので畳まれ、受け側に両方が残る
    expect(panes()).toHaveLength(1);
    expect(first().tabs).toEqual(["a.md", "z.md"]);
  });
});

describe("dropOnPane", () => {
  it("中央に落とすとそのペインで開く", () => {
    openInPane(store, "p1", "a.md");
    dropOnPane(store, "p1", "center", "b.md");
    expect(panes()).toHaveLength(1);
    expect(first().tabs).toEqual(["a.md", "b.md"]);
  });

  it("端に落とすと分割して新しいペインで開く", () => {
    openInPane(store, "p1", "a.md");
    dropOnPane(store, "p1", "right", "b.md");
    expect(panes()).toHaveLength(2);
    expect(panes().map((p) => p.tabs)).toEqual([["a.md"], ["b.md"]]);
  });

  it("タブを端に落とすと元のペインから消える", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    dropOnPane(store, "p1", "right", "a.md", { paneId: "p1", index: 0 });
    expect(panes().map((p) => p.tabs)).toEqual([["b.md"], ["a.md"]]);
  });

  it("これ以上分割できないときは中央扱いになる", () => {
    openInPane(store, "p1", "a.md");
    for (let i = 0; i < A.MAX_PANES; i++) splitPane(store, "row", `s${i}.md`);
    expect(panes()).toHaveLength(A.MAX_PANES);
    const before = panes().length;
    dropOnPane(store, "p1", "right", "z.md");
    expect(panes()).toHaveLength(before);
    expect(pane("p1")?.tabs).toContain("z.md");
  });
});

describe("splitPane", () => {
  it("指定が無ければ作用中のタブを複製する", () => {
    openInPane(store, "p1", "a.md");
    splitPane(store, "row");
    expect(panes().map((p) => p.tabs)).toEqual([["a.md"], ["a.md"]]);
  });

  it("上限を超えて分割しない", () => {
    for (let i = 0; i < A.MAX_PANES + 3; i++) splitPane(store, "row", `s${i}.md`);
    expect(panes()).toHaveLength(A.MAX_PANES);
  });
});

describe("remapLeafPaths", () => {
  it("改名に追従し、作用中タブを見失わない", () => {
    for (const f of ["a.md", "b.md"]) openInPane(store, "p1", f);
    activateTab(store, "p1", 1);
    remapLeafPaths(store, (p) => (p === "b.md" ? "renamed.md" : p));
    expect(first().tabs).toEqual(["a.md", "renamed.md"]);
    expect(A.activePath(first())).toBe("renamed.md");
  });

  it("削除されたタブを取り除き、位置を詰める", () => {
    for (const f of ["a.md", "b.md", "c.md"]) openInPane(store, "p1", f);
    remapLeafPaths(store, (p) => (p === "c.md" ? null : p));
    expect(first().tabs).toEqual(["a.md", "b.md"]);
    expect(A.activePath(first())).toBe("b.md");
  });
});

describe("closePane", () => {
  it("全て閉じたら空のペインが 1 つ残る", () => {
    openInPane(store, "p1", "a.md");
    closePane(store, "p1");
    expect(panes()).toHaveLength(1);
    expect(first().tabs).toEqual([]);
  });
});

describe("reviveLayout", () => {
  const valid = new Set(["a.md", "b.md"]);

  it("タブを持たなかった頃の保存レイアウトを読める", () => {
    // 旧形式: 1 ペイン 1 ファイルで path を持つ
    const stored: StoredNode = {
      kind: "split",
      id: "s1",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", id: "p1", path: "a.md" },
        { kind: "leaf", id: "p2", path: "b.md" },
      ],
    };
    const { layout, active } = reviveLayout(stored, valid, "p2");
    store.set(A.layoutAtom, layout);
    expect(panes().map((p) => p.tabs)).toEqual([["a.md"], ["b.md"]]);
    expect(pane(active)?.tabs).toEqual(["b.md"]);
  });

  it("旧形式でファイルが無いペインは空になる", () => {
    const stored: StoredNode = { kind: "leaf", id: "p1", path: null };
    const { layout } = reviveLayout(stored, valid, "p1");
    store.set(A.layoutAtom, layout);
    expect(first().tabs).toEqual([]);
  });

  it("消えたファイルのタブを落とし、作用中を保つ", () => {
    const stored: StoredNode = {
      kind: "leaf",
      id: "p1",
      tabs: ["a.md", "gone.md", "b.md"],
      active: 2,
    };
    const { layout } = reviveLayout(stored, valid, "p1");
    store.set(A.layoutAtom, layout);
    expect(first().tabs).toEqual(["a.md", "b.md"]);
    expect(A.activePath(first())).toBe("b.md");
  });

  it("作用中のタブが消えていたら先頭に寄せる", () => {
    const stored: StoredNode = {
      kind: "leaf",
      id: "p1",
      tabs: ["a.md", "gone.md"],
      active: 1,
    };
    const { layout } = reviveLayout(stored, valid, "p1");
    store.set(A.layoutAtom, layout);
    expect(A.activePath(first())).toBe("a.md");
  });

  it("id を振り直して既存と衝突させない", () => {
    const stored: StoredNode = { kind: "leaf", id: "p1", tabs: ["a.md"], active: 0 };
    const one = reviveLayout(stored, valid, "p1");
    const two = reviveLayout(stored, valid, "p1");
    expect(one.layout.id).not.toBe(two.layout.id);
  });
});
