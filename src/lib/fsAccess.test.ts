import { describe, expect, it } from "vitest";
import {
  ancestorPaths,
  childrenAt,
  filterTree,
  findNode,
  parentPath,
  type TreeNode,
} from "./fsAccess";

// ルート直下に requirements/ と README.md、requirements の下に 2 つのフォルダ。
function dir(path: string, children: TreeNode[]): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, abs: `/root/${path}`, kind: "dir", children };
}
function file(path: string): TreeNode {
  const name = path.split("/").pop() ?? path;
  return { name, path, abs: `/root/${path}`, kind: "file" };
}

const TREE: TreeNode[] = [
  dir("requirements", [
    dir("requirements/請求情報", [file("requirements/請求情報/05_技術検討書.md")]),
    dir("requirements/空フォルダ", []),
    file("requirements/README.md"),
  ]),
  file("README.md"),
];

describe("findNode", () => {
  it("ルート直下のファイルを引ける", () => {
    expect(findNode(TREE, "README.md")?.kind).toBe("file");
  });

  it("入れ子のフォルダを引ける", () => {
    const hit = findNode(TREE, "requirements/請求情報");
    expect(hit?.kind).toBe("dir");
    expect(hit?.name).toBe("請求情報");
  });

  it("深い階層のファイルを引ける", () => {
    const hit = findNode(TREE, "requirements/請求情報/05_技術検討書.md");
    expect(hit?.abs).toBe("/root/requirements/請求情報/05_技術検討書.md");
  });

  it("無いパスでは null", () => {
    expect(findNode(TREE, "requirements/存在しない.md")).toBeNull();
    expect(findNode(TREE, "")).toBeNull();
  });

  // 名前の前方一致で別の枝へ降りないこと（requirements2 が requirements の中を探さない）
  it("名前が前方一致する別のフォルダへ降りない", () => {
    const tree = [dir("req", [file("req/a.md")]), file("reqs.md")];
    expect(findNode(tree, "reqs.md")?.name).toBe("reqs.md");
  });
});

describe("childrenAt", () => {
  it("空文字ではルートを返す", () => {
    expect(childrenAt(TREE, "").map((n) => n.name)).toEqual([
      "requirements",
      "README.md",
    ]);
  });

  it("フォルダのパスでその中身を返す", () => {
    expect(childrenAt(TREE, "requirements").map((n) => n.name)).toEqual([
      "請求情報",
      "空フォルダ",
      "README.md",
    ]);
  });

  it("空のフォルダでは空", () => {
    expect(childrenAt(TREE, "requirements/空フォルダ")).toEqual([]);
  });

  it("ファイルのパスでは空", () => {
    expect(childrenAt(TREE, "README.md")).toEqual([]);
  });
});

describe("ancestorPaths", () => {
  it("浅い方から並ぶ", () => {
    expect(ancestorPaths("a/b/c.md")).toEqual(["a", "a/b"]);
  });

  it("ルート直下では空", () => {
    expect(ancestorPaths("README.md")).toEqual([]);
  });
});

describe("parentPath", () => {
  it("1 つ上のフォルダを返す", () => {
    expect(parentPath("a/b/c.md")).toBe("a/b");
  });

  it("ルート直下では空文字", () => {
    expect(parentPath("README.md")).toBe("");
  });
});

describe("filterTree", () => {
  it("空の条件では元のまま", () => {
    expect(filterTree(TREE, "")).toBe(TREE);
  });

  it("名前の部分一致で残る", () => {
    const got = filterTree(TREE, "技術");
    expect(got.map((n) => n.name)).toEqual(["requirements"]);
    expect(got[0].children?.map((n) => n.name)).toEqual(["請求情報"]);
  });

  it("パスの部分一致でも残る", () => {
    const got = filterTree(TREE, "請求情報");
    expect(got[0].children?.[0].children?.map((n) => n.name)).toEqual([
      "05_技術検討書.md",
    ]);
  });

  it("一致するファイルを持たないフォルダは落ちる", () => {
    const got = filterTree(TREE, "README");
    expect(got.map((n) => n.name)).toEqual(["requirements", "README.md"]);
    expect(got[0].children?.map((n) => n.name)).toEqual(["README.md"]);
  });

  it("大文字小文字を区別しない", () => {
    expect(filterTree(TREE, "readme").map((n) => n.name)).toEqual([
      "requirements",
      "README.md",
    ]);
  });
});
