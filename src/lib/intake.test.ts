import { describe, expect, it } from "vitest";
import { bringIn, INTAKE_LIMIT } from "./intake";

// 外から落とされたものを均す。WebKit の入れ子読み出し（webkitGetAsEntry）を
// 当て木で置き、辿り方と取りやめの判断を見る。

type Kid = Node2;
interface Node2 {
  name: string;
  body?: string; // ファイルなら中身
  kids?: Kid[]; // フォルダなら中の並び
}

// readEntries は一度に返す数が決まっている。分けて返す振る舞いも写す。
const BATCH = 2;

function entryOf(node: Node2): unknown {
  if (node.kids === undefined) {
    return {
      isFile: true,
      isDirectory: false,
      name: node.name,
      file: (ok: (f: File) => void) =>
        ok(new File([node.body ?? ""], node.name)),
    };
  }
  return {
    isFile: false,
    isDirectory: true,
    name: node.name,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok: (list: unknown[]) => void) => {
          const batch = node.kids!.slice(at, at + BATCH);
          at += batch.length;
          ok(batch.map(entryOf));
        },
      };
    },
  };
}

function dropOf(nodes: Node2[], withEntry = true): DataTransfer {
  const files = nodes
    .filter((n) => n.kids === undefined)
    .map((n) => new File([n.body ?? ""], n.name));
  return {
    files,
    items: nodes.map((n) => ({
      webkitGetAsEntry: withEntry ? () => entryOf(n) : undefined,
    })),
    types: ["Files"],
  } as unknown as DataTransfer;
}

const file = (name: string, body = "本文"): Node2 => ({ name, body });
const dir = (name: string, kids: Node2[]): Node2 => ({ name, kids });

async function relsOf(nodes: Node2[], withEntry = true): Promise<string[]> {
  const got = await bringIn(dropOf(nodes, withEntry));
  if (got === "too-many") throw new Error("多すぎる");
  return got.map((b) => b.rel);
}

describe("落とされたものを均す", () => {
  it("ファイルは名前がそのまま道筋になる", async () => {
    expect(await relsOf([file("読み物.md")])).toEqual(["読み物.md"]);
  });

  it("フォルダは階層を保って開く", async () => {
    const tree = dir("資料", [
      file("表紙.md"),
      dir("図", [file("a.png"), file("b.png")]),
    ]);
    expect(await relsOf([tree])).toEqual([
      "資料/表紙.md",
      "資料/図/a.png",
      "資料/図/b.png",
    ]);
  });

  it("一度に返る数を超えても、後ろが落ちない", async () => {
    const many = Array.from({ length: BATCH * 3 + 1 }, (_, i) =>
      file(`${i}.md`),
    );
    expect(await relsOf([dir("束", many)])).toHaveLength(many.length);
  });

  it("「.」で始まるものは取り込まない", async () => {
    const tree = dir("資料", [
      file(".DS_Store"),
      dir(".git", [file("HEAD")]),
      file("読み物.md"),
    ]);
    expect(await relsOf([tree])).toEqual(["資料/読み物.md"]);
  });

  it("空のフォルダは場所だけ残す", async () => {
    const got = await bringIn(dropOf([dir("空", [])]));
    expect(got).toEqual([{ rel: "空", file: null }]);
  });

  it("上限を超えたら一件も取り込まない", async () => {
    const many = Array.from({ length: INTAKE_LIMIT + 1 }, (_, i) =>
      file(`${i}.md`),
    );
    expect(await bringIn(dropOf([dir("束", many)]))).toBe("too-many");
  });

  it("入れ子を読めない持ち込みは、ファイルだけを平らに拾う", async () => {
    const got = await relsOf([file("a.md"), file(".隠し.md")], false);
    expect(got).toEqual(["a.md"]);
  });
});
