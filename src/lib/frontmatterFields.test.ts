import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  addField,
  addItem,
  dropField,
  dropItem,
  fieldsOf,
  freeKey,
  newFrontmatter,
  safeScalar,
  swapFields,
  withKey,
  withValue,
} from "./frontmatterFields";

// Notion から降りてくるフロントマターの実物の形。鍵に「4. 」が付いたものや、
// 値が空で次の行から並びが始まるものが混ざる。
const FM = [
  "---",
  "notion_id: 3cf53222-ff1e-81cf-86f2-f28c9d8ee6e1",
  "種別: 新規依頼",
  "依頼日: '2026-09-02'",
  "4. 画面・機能案:",
  "- 3ce53222-ff1e-813b-934d-d06774db8c13",
  "- 3ce53222-ff1e-8000-0000-000000000000",
  "title: 【請求情報通知】ビューを指定して通知対象を絞り込める",
  "url: https://app.notion.com/p/3cf53222ff1e81cf86f2f28c9d8ee6e1",
  "last_synced: '2026-09-10T08:07:09.068081+00:00'",
  "---",
  "",
].join("\n");

const keys = (fm: string) => fieldsOf(fm).map((f) => f.key);
const find = (fm: string, key: string) => fieldsOf(fm).find((f) => f.key === key)!;
const read = (fm: string) =>
  yaml.load(fm.slice(4, fm.lastIndexOf("---"))) as Record<string, unknown>;

describe("フロントマターの欄", () => {
  it("鍵の並び順のまま取り出す", () => {
    expect(keys(FM)).toEqual([
      "notion_id",
      "種別",
      "依頼日",
      "4. 画面・機能案",
      "title",
      "url",
      "last_synced",
    ]);
  });

  it("値が空の鍵に続く並びは、項目ごとの箱になる", () => {
    const f = find(FM, "4. 画面・機能案");
    expect(f.cells.map((c) => c.text)).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "3ce53222-ff1e-8000-0000-000000000000",
    ]);
  });

  it("引用符は外して見せ、形は覚えておく", () => {
    const f = find(FM, "依頼日");
    expect(f.cells[0].text).toBe("2026-09-02");
    expect(f.cells[0].quote).toBe("'");
  });

  it("箱の範囲は生テキストのその値を指している", () => {
    const f = find(FM, "url");
    const [from, to] = f.cells[0].at;
    expect(FM.slice(from, to)).toBe(
      "https://app.notion.com/p/3cf53222ff1e81cf86f2f28c9d8ee6e1",
    );
  });

  it("フロントマターでない字からは何も取れない", () => {
    expect(fieldsOf("")).toEqual([]);
    expect(fieldsOf("# 題\n\n本文\n")).toEqual([]);
  });
});

describe("値の差し替え", () => {
  it("その値の行だけが変わり、他の行は一字も動かない", () => {
    const next = withValue(FM, find(FM, "種別").cells[0], "修正依頼");
    const was = FM.split("\n");
    const now = next.split("\n");
    expect(now.length).toBe(was.length);
    now.forEach((line, i) => {
      if (i === 2) expect(line).toBe("種別: 修正依頼");
      else expect(line).toBe(was[i]);
    });
  });

  it("引用符付きの値は引用符のまま差し替わる（日付として読まれないように）", () => {
    const next = withValue(FM, find(FM, "依頼日").cells[0], "2026-09-30");
    expect(next).toContain("依頼日: '2026-09-30'");
    expect(read(next)["依頼日"]).toBe("2026-09-30");
  });

  it("並びの項目を差し替えても、隣の項目は動かない", () => {
    const f = find(FM, "4. 画面・機能案");
    const next = withValue(FM, f.cells[1], "差し替えた");
    expect(read(next)["4. 画面・機能案"]).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "差し替えた",
    ]);
  });

  it("差し替えたあとも同じ数の欄が取れる（範囲がずれない）", () => {
    const next = withValue(FM, find(FM, "notion_id").cells[0], "短くした");
    expect(keys(next)).toEqual(keys(FM));
    expect(find(next, "last_synced").cells[0].text).toBe(
      "2026-09-10T08:07:09.068081+00:00",
    );
  });

  it("値の無い鍵に打つと、コロンの後ろに区切りの空白が入る", () => {
    const fm = "---\nmemo:\n---\n";
    const next = withValue(fm, fieldsOf(fm)[0].cells[0], "書いた");
    expect(next).toBe("---\nmemo: 書いた\n---\n");
  });
});

describe("打った字を YAML として置ける形にする", () => {
  it("そのまま置ける字は裸のまま", () => {
    expect(safeScalar("新規依頼")).toBe("新規依頼");
    expect(safeScalar("a-b-c")).toBe("a-b-c");
  });

  it("記号で始まる・コロンを含む・前後に空白のある字は引用符で包む", () => {
    expect(safeScalar("a: b")).toBe("'a: b'");
    expect(safeScalar("- 項目")).toBe("'- 項目'");
    expect(safeScalar("# 見出し")).toBe("'# 見出し'");
    expect(safeScalar(" 前に空白")).toBe("' 前に空白'");
    expect(safeScalar("")).toBe("''");
  });

  it("引用符を包む側に回したときは中の引用符を二重にする", () => {
    // 字の途中の ' は平文でもそのまま置ける。包むのは元が引用符付きだったとき。
    expect(safeScalar("It's")).toBe("It's");
    expect(safeScalar("It's", "'")).toBe("'It''s'");
  });

  it("何を打ってもファイルは YAML として読み直せる", () => {
    for (const typed of ["a: b", "- x", "{}", "[1,2]", "#", "'", '"', "", "  "]) {
      const next = withValue(FM, find(FM, "種別").cells[0], typed);
      expect(() => read(next)).not.toThrow();
      expect(read(next)["種別"]).toBe(typed);
    }
  });
});

describe("手に負えない値", () => {
  it("入れ子の対応表は打たせない", () => {
    const fm = "---\nowner:\n  name: 汲田\n  team: 開発\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });

  it("複数行の字は打たせない", () => {
    const fm = "---\nnote: |\n  一行目\n  二行目\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });

  it("流し書きの並びは打たせない", () => {
    const fm = "---\ntags: [a, b]\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });
});

describe("鍵の打ち替え", () => {
  it("鍵だけが変わる", () => {
    const next = withKey(FM, find(FM, "種別"), "区分");
    expect(next).toContain("区分: 新規依頼");
    expect(next.split("\n").length).toBe(FM.split("\n").length);
    expect(read(next)["区分"]).toBe("新規依頼");
  });

  it("そのままでは鍵にできない字は引用符で包む", () => {
    const next = withKey(FM, find(FM, "種別"), "a: b");
    expect(next).toContain("'a: b': 新規依頼");
    expect(read(next)["a: b"]).toBe("新規依頼");
  });

  it("値が並びの鍵でも打ち替えられる", () => {
    const next = withKey(FM, find(FM, "4. 画面・機能案"), "案");
    expect(read(next)["案"]).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "3ce53222-ff1e-8000-0000-000000000000",
    ]);
  });
});

describe("欄を消す", () => {
  it("その行だけが消える", () => {
    const next = dropField(FM, find(FM, "種別"));
    expect(keys(next)).toEqual([
      "notion_id",
      "依頼日",
      "4. 画面・機能案",
      "title",
      "url",
      "last_synced",
    ]);
    expect(next).not.toContain("新規依頼");
    expect(next).toContain("依頼日: '2026-09-02'");
  });

  it("並びを持つ欄は項目ごと消える", () => {
    const next = dropField(FM, find(FM, "4. 画面・機能案"));
    expect(next).not.toContain("3ce53222");
    expect(keys(next)).not.toContain("4. 画面・機能案");
    expect(read(next).title).toBe(read(FM).title);
  });

  it("入れ子を持つ欄は中身ごと消える", () => {
    const fm = "---\nowner:\n  name: 汲田\n  team: 開発\nnext: あと\n---\n";
    const next = dropField(fm, fieldsOf(fm)[0]);
    expect(next).toBe("---\nnext: あと\n---\n");
  });
});

describe("欄を入れ替える", () => {
  it("2 つの欄が入れ替わり、間の行は動かない", () => {
    const next = swapFields(FM, find(FM, "notion_id"), find(FM, "依頼日"));
    expect(keys(next)).toEqual([
      "依頼日",
      "種別",
      "notion_id",
      "4. 画面・機能案",
      "title",
      "url",
      "last_synced",
    ]);
    expect(read(next)).toEqual(read(FM));
  });

  it("並びを持つ欄は項目ごと動く", () => {
    const next = swapFields(FM, find(FM, "4. 画面・機能案"), find(FM, "種別"));
    // 種別（1 行）と 4. 画面・機能案（3 行）が、互いの居場所へ入れ替わる。
    expect(keys(next)).toEqual([
      "notion_id",
      "4. 画面・機能案",
      "依頼日",
      "種別",
      "title",
      "url",
      "last_synced",
    ]);
    expect(read(next)).toEqual(read(FM));
  });

  it("どちらを先に渡しても同じ", () => {
    const a = swapFields(FM, find(FM, "種別"), find(FM, "title"));
    const b = swapFields(FM, find(FM, "title"), find(FM, "種別"));
    expect(a).toBe(b);
  });
});

describe("欄を足す", () => {
  it("閉じの --- の直前に入る", () => {
    const next = addField(FM, "担当");
    expect(keys(next).at(-1)).toBe("担当");
    expect(next).toContain("last_synced: '2026-09-10T08:07:09.068081+00:00'\n担当:\n---");
    expect(read(next)["担当"]).toBe(null);
  });

  it("足したばかりの欄にも打てる", () => {
    const added = addField(FM, "担当");
    const next = withValue(added, find(added, "担当").cells[0], "汲田");
    expect(next).toContain("担当: 汲田");
  });

  it("重なる鍵は番号を付けて避ける", () => {
    expect(freeKey(FM, "担当")).toBe("担当");
    expect(freeKey(FM, "種別")).toBe("種別 2");
    expect(freeKey(addField(FM, "種別 2"), "種別")).toBe("種別 3");
  });
});

describe("並びの項目を足す・消す", () => {
  it("指した項目の下に入る", () => {
    const f = find(FM, "4. 画面・機能案");
    const next = addItem(FM, f.cells[0]);
    const now = find(next, "4. 画面・機能案");
    expect(now.cells.map((c) => c.text)).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "",
      "3ce53222-ff1e-8000-0000-000000000000",
    ]);
    expect(withValue(next, now.cells[1], "足した")).toContain("- 足した");
  });

  it("項目を 1 つ消す", () => {
    const f = find(FM, "4. 画面・機能案");
    const next = dropItem(FM, f.cells[0]);
    expect(read(next)["4. 画面・機能案"]).toEqual([
      "3ce53222-ff1e-8000-0000-000000000000",
    ]);
  });

  it("最後の 1 つを消すと、値の無い鍵に戻る", () => {
    let next = FM;
    for (const cell of find(FM, "4. 画面・機能案").cells.slice().reverse()) {
      next = dropItem(next, cell);
    }
    expect(find(next, "4. 画面・機能案").cells.map((c) => c.text)).toEqual([""]);
    expect(read(next)["4. 画面・機能案"]).toBe(null);
  });
});

describe("何も無いファイルに付ける", () => {
  it("中身の無い入れ物を作る。鍵は決め打ちしない", () => {
    expect(newFrontmatter()).toBe("---\n---\n\n");
    expect(fieldsOf(newFrontmatter())).toEqual([]);
  });

  it("そこへ行を足せる", () => {
    const fm = addField(newFrontmatter(), freeKey(newFrontmatter(), "項目"));
    expect(fm).toBe("---\n項目:\n---\n\n");
    expect(fieldsOf(fm).map((f) => f.key)).toEqual(["項目"]);
  });

  it("足した行は鍵も値も打てる", () => {
    let fm = addField(newFrontmatter(), "項目");
    fm = withKey(fm, fieldsOf(fm)[0], "title");
    fm = withValue(fm, fieldsOf(fm)[0].cells[0], "[草案] 1: はじめ");
    expect(read(fm).title).toBe("[草案] 1: はじめ");
  });
});
