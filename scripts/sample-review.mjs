// レビューの見本を仕込む。
//
// コメントの箇所が今どうなっているか（そのまま / 周りが変更 / 書き換え済み /
// 削除済み / 本文から外れた）を目で確かめるには、コメントを付けたあとに本文が
// 書き換わった状態が要る。手で作ると時間が掛かるので、ここで一式を置く。
//
// 指摘を起こす CLI は無いので、台帳と版の控えへ直に書く。書き方は Rust 側
// （src-tauri/src/review/store.rs, snapshot.rs）に合わせる。
//
//   node scripts/sample-review.mjs seed    見本を置く（台帳へ足す）
//   node scripts/sample-review.mjs clear   見本の分だけ台帳から外す
//
// 台帳の他の指摘には触らない。選び分けは sample/レビュー見本/ のパスで行う。

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const REPO = path.resolve(import.meta.dirname, "..");
const SAMPLE = path.join(REPO, "sample", "レビュー見本");
const REVIEW = path.join(
  process.env.HOME,
  "Library",
  "Application Support",
  "com.mdglow.app",
  "review",
);
const LEDGER = path.join(REVIEW, "store.json");
const LOCK = path.join(REVIEW, "store.json.lock");
const SNAPSHOTS = path.join(REVIEW, "snapshots");

// 台帳は絶対パスで持つ。macOS のファイル名は NFD で作られることがあるので、
// Rust 側と同じく NFC に揃える。
const abs = (name) => path.join(SAMPLE, name).normalize("NFC");

const HOUR = 3600_000;
const now = Date.now();
const at = (hoursAgo) => now - hoursAgo * HOUR;

// ---- 見本の中身 ----

const 変更の見本 = {
  name: "変更の見本.md",
  base: `# 変更の見本

fude はローカルの Markdown を読み書きするための道具です。

## 使いはじめ

この機能は管理者のみが使えます。

設定画面は歯車の印から開きます。

保存は自動で行われます。書き換えた分は 3 秒後にディスクへ落ちます。

## これから

次の版では、書き出しの形式を増やす予定です。

古い言い方の説明がここに残っています。読み飛ばしてください。
`,
  head: `# 変更の見本

fude はローカルの Markdown を読み書きするための道具です。

## 使いはじめ

この機能は全ユーザーが使えます。

設定画面は歯車の印から開きます。

保存は自動で行われます。書き換えた分はすぐにディスクへ落ち、版の履歴にも残ります。

## これから

次の版では、書き出しの形式を増やす予定です。
`,
  threads: [
    {
      id: "5a1e0001",
      // 箇所そのものが書き換わる。文字単位の印が出る。
      quote: "この機能は管理者のみが使えます。",
      selection: "管理者のみ",
      sectionPath: ["変更の見本", "使いはじめ"],
      comments: [["you", "「管理者のみ」は本当ですか。一般の人も使えるはずです。", 26]],
    },
    {
      id: "5a1e0002",
      // 書き換わらない。そのままの見本。
      quote: "設定画面は歯車の印から開きます。",
      selection: "歯車の印",
      sectionPath: ["変更の見本", "使いはじめ"],
      comments: [["you", "印の名前は画面の表記に合わせたい。", 20]],
    },
    {
      id: "5a1e0003",
      // 指摘した文はそのままで、同じ段落の後ろだけが動く。
      quote: "保存は自動で行われます。書き換えた分は 3 秒後にディスクへ落ちます。",
      selection: "保存は自動で行われます",
      sectionPath: ["変更の見本", "使いはじめ"],
      comments: [
        ["you", "自動保存の間隔が長すぎませんか。", 8],
        ["AI", "間隔をやめて、書き換えたらすぐ落ちるようにしました。", 6],
      ],
    },
    {
      id: "5a1e0004",
      // ブロックごと消える。
      quote: "古い言い方の説明がここに残っています。読み飛ばしてください。",
      selection: "読み飛ばしてください",
      sectionPath: ["変更の見本", "これから"],
      comments: [["you", "読み飛ばす前提の段落は要らないので消してください。", 5]],
    },
    {
      id: "5a1e0005",
      // 控えの無い指摘（別のところから取り込んだ想定）。今の本文に文が無く、
      // 版も引けないので居場所を決められない＝本文から外れる。
      quote: "仕様の詳細は、設定画面の別紙にまとめてあります。",
      selection: "設定画面の別紙",
      sectionPath: [],
      orphan: true,
      comments: [["you", "別紙の場所が分かりません。この文はどこへ行きましたか。", 30]],
    },
  ],
};

const 表の見本 = {
  name: "表の見本.md",
  base: `# 表の見本

## 対応の一覧

| 機能 | 対応 | 備考 |
| --- | --- | --- |
| 全文検索 | 済 | フォルダ全体 |
| 差分表示 | 未 | 予定 |
| 書き出し | 済 | PDF のみ |

## 版の呼び名

fude の版は、本文そのものの内容ハッシュで名前が付きます。同じ内容の版は 1 つに畳まれるので、同じ本文を何度打っても履歴は増えません。控えは圧縮して置いてあり、読むときだけ解きます。版の呼び名は圧縮する前の中身から作るので、置き方を変えても呼び名は変わりません。
`,
  head: `# 表の見本

## 対応の一覧

| 機能 | 対応 | 備考 |
| --- | --- | --- |
| 全文検索 | 済 | フォルダ全体と 1 ファイル |
| 差分表示 | 済 | セル単位まで |
| 読み上げ | 未 | 検討中 |

## 版の呼び名

fude の版は、本文そのものの内容ハッシュで名前が付きます。同じ内容の版は 1 つに畳まれるので、同じ本文を何度残しても履歴は増えません。控えは gzip で圧縮して置いてあり、読むときだけ解きます。版の呼び名は圧縮する前の中身から作るため、置き方を変えても呼び名は変わりません。
`,
  threads: [
    {
      id: "5a1e0011",
      // 表ぜんたいが引用。行の増減とセルの中の字まで割れる。
      quote: `| 機能 | 対応 | 備考 |
| --- | --- | --- |
| 全文検索 | 済 | フォルダ全体 |
| 差分表示 | 未 | 予定 |
| 書き出し | 済 | PDF のみ |`,
      selection: "予定",
      sectionPath: ["表の見本", "対応の一覧"],
      comments: [
        ["you", "差分表示の「予定」はいつですか。書き出しの行はもう要りません。", 12],
        ["AI", "差分表示を済にし、書き出しの行を落として読み上げを足しました。", 9],
      ],
    },
    {
      id: "5a1e0012",
      // 長い段落の中の、数語だけが動く。
      quote:
        "fude の版は、本文そのものの内容ハッシュで名前が付きます。同じ内容の版は 1 つに畳まれるので、同じ本文を何度打っても履歴は増えません。控えは圧縮して置いてあり、読むときだけ解きます。版の呼び名は圧縮する前の中身から作るので、置き方を変えても呼び名は変わりません。",
      selection: "控えは圧縮して置いてあり",
      sectionPath: ["表の見本", "版の呼び名"],
      comments: [["you", "何で圧縮しているのかを書いてください。", 30]],
    },
  ],
};

const 会話の見本 = {
  name: "会話の見本.md",
  base: `# 会話の見本

コメントは 1 件ずつ会話になります。書いた人と、答えた人と、いつの話かが並びます。

## やり取り

返信は ⌘Enter で送れます。

解決にすると一覧から消えますが、記録は台帳に残ります。

## 版

版は手で打てます。打った版どうしを見比べると、その間に何が動いたかが読めます。
`,
  head: `# 会話の見本

コメントは 1 件ずつ会話になります。書いた人と、答えた人と、いつの話かが並びます。

## やり取り

返信は ⌘Enter で送れます。書いたものの姿は、送る前に確かめられます。

解決にすると一覧から消えますが、記録は台帳に残ります。取り消せば元どおりです。

## 版

版は手で打てます。打った版どうしを見比べると、その間に何が動いたかが読めます。

版は ⌘S で名前を付けて打てます。名前を省くと日時で呼ばれます。
`,
  // 履歴の見本。控えを置いて、版として並べる。
  versions: [
    {
      label: "書きはじめ",
      origin: "checkpoint",
      actor: "you",
      hoursAgo: 48,
      text: `# 会話の見本

コメントは 1 件ずつ会話になります。

## やり取り

返信は ⌘Enter で送れます。
`,
    },
    {
      label: "章を足した",
      origin: "checkpoint",
      actor: "you",
      hoursAgo: 24,
      text: `# 会話の見本

コメントは 1 件ずつ会話になります。書いた人と、答えた人と、いつの話かが並びます。

## やり取り

返信は ⌘Enter で送れます。

解決にすると一覧から消えますが、記録は台帳に残ります。
`,
    },
    {
      label: "返信の確かめと、解決の取り消しを足した",
      origin: "commit",
      actor: "ai",
      hoursAgo: 2,
      text: null, // 今の本文
      // どの指摘への対応か。紐付いていると、画面は「その対応で本文のどこが
      // 動いたか」を指摘の箇所の外まで含めて出せる。
      threads: ["5a1e0021", "5a1e0022"],
    },
  ],
  threads: [
    {
      id: "5a1e0021",
      quote: "返信は ⌘Enter で送れます。",
      selection: "⌘Enter",
      sectionPath: ["会話の見本", "やり取り"],
      comments: [
        ["you", "送る前に見え方を確かめたいです。", 30],
        ["AI", "書いたものの姿を確かめる口を足しました。", 28],
        ["you", "ありがとうございます。記法もそのまま出ますか。", 27],
      ],
    },
    {
      id: "5a1e0022",
      quote: "解決にすると一覧から消えますが、記録は台帳に残ります。",
      selection: "一覧から消えます",
      sectionPath: ["会話の見本", "やり取り"],
      comments: [
        ["you", "間違えて解決にしたときはどうなりますか。", 10],
        ["AI", "取り消せます。その旨を本文にも足しました。", 4],
      ],
    },
    {
      id: "5a1e0023",
      quote: "版は手で打てます。打った版どうしを見比べると、その間に何が動いたかが読めます。",
      selection: "手で打てます",
      sectionPath: ["会話の見本", "版"],
      resolved: { by: "you", hoursAgo: 3 },
      comments: [
        ["you", "版の打ち方が分かりません。", 20],
        ["AI", "⌘S で名前を付けて打てます。", 18],
      ],
    },
  ],
};

const DOCS = [変更の見本, 表の見本, 会話の見本];

// ---- 版の控え ----

const hashOf = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function putSnapshot(text) {
  const id = hashOf(text);
  fs.mkdirSync(SNAPSHOTS, { recursive: true });
  const to = path.join(SNAPSHOTS, id);
  if (!fs.existsSync(to)) fs.writeFileSync(to, gzipSync(Buffer.from(text, "utf8")));
  return id;
}

// ---- 台帳 ----

function withLock(change) {
  fs.mkdirSync(REVIEW, { recursive: true });
  let held;
  for (let i = 0; i < 100; i++) {
    try {
      held = fs.openSync(LOCK, "wx");
      break;
    } catch {
      // 30 秒より古い錠は落ちたプロセスの置き土産とみなす（Rust 側と同じ）。
      const age = fs.existsSync(LOCK) ? Date.now() - fs.statSync(LOCK).mtimeMs : 0;
      if (age > 30_000) fs.rmSync(LOCK, { force: true });
    }
  }
  if (held === undefined) throw new Error("台帳の錠を取れません");
  try {
    const ledger = fs.existsSync(LEDGER)
      ? JSON.parse(fs.readFileSync(LEDGER, "utf8"))
      : { format_version: 1, threads: [], versions: [] };
    const next = change(ledger);
    const tmp = `${LEDGER}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, LEDGER);
  } finally {
    fs.closeSync(held);
    fs.rmSync(LOCK, { force: true });
  }
}

// 見本の分か。パスで選び分ける（台帳の他の指摘には触らない）。
const mine = (entry) => entry.file.startsWith(SAMPLE.normalize("NFC"));

// ---- 仕込み ----

function seed() {
  fs.mkdirSync(SAMPLE, { recursive: true });
  const threads = [];
  const versions = [];

  for (const doc of DOCS) {
    const file = abs(doc.name);
    fs.writeFileSync(file, doc.head);

    // コメントを付けた時点の版。指摘はこれを基準にする。
    const baseId = putSnapshot(doc.base);
    const oldest = Math.min(
      ...doc.threads.flatMap((t) => t.comments.map(([, , h]) => h)),
    );
    versions.push({
      id: baseId,
      file,
      label: null,
      origin: "comment",
      actor: "system",
      created_at: at(oldest),
    });

    for (const v of doc.versions ?? []) {
      versions.push({
        id: putSnapshot(v.text ?? doc.head),
        file,
        label: v.label,
        origin: v.origin,
        actor: v.actor,
        ...(v.threads ? { threads: v.threads } : {}),
        created_at: at(v.hoursAgo),
      });
    }

    for (const t of doc.threads) {
      const first = t.comments[0][2];
      threads.push({
        id: t.id,
        file,
        quote: t.quote,
        block_hash: hashOf(t.quote),
        selection: t.selection,
        selection_offset: Math.max(0, t.quote.indexOf(t.selection)),
        section_path: t.sectionPath,
        prefix: "",
        suffix: "",
        // 控えを持たない指摘は、版を引けない側の見本。
        base_version: t.orphan ? hashOf(`${t.quote}\n控えなし`) : baseId,
        status: t.resolved
          ? { kind: "resolved", by: t.resolved.by, at: at(t.resolved.hoursAgo) }
          : { kind: "open" },
        comments: t.comments.map(([author, body, hoursAgo], i) => ({
          id: `${t.id}c${i + 1}`,
          author,
          body,
          created_at: at(hoursAgo),
        })),
        created_at: at(first),
        resolved: null,
      });
    }
  }

  withLock((ledger) => ({
    ...ledger,
    format_version: ledger.format_version ?? 1,
    // 入れ直しても増えないよう、見本の分は先に外してから足す。
    threads: [...(ledger.threads ?? []).filter((t) => !mine(t)), ...threads],
    versions: [...(ledger.versions ?? []).filter((v) => !mine(v)), ...versions],
  }));

  console.log(`見本を置きました: ${SAMPLE}`);
  console.log(`  文書 ${DOCS.length} 枚 / 指摘 ${threads.length} 件 / 版 ${versions.length} 個`);
  console.log("fude で sample フォルダを開いてください。");
}

function clear() {
  let dropped = 0;
  withLock((ledger) => {
    const threads = (ledger.threads ?? []).filter((t) => !mine(t));
    const versions = (ledger.versions ?? []).filter((v) => !mine(v));
    dropped = (ledger.threads?.length ?? 0) - threads.length;
    return { ...ledger, threads, versions };
  });
  console.log(`見本の指摘 ${dropped} 件を台帳から外しました（文書はそのまま）。`);
}

const what = process.argv[2];
if (what === "seed") seed();
else if (what === "clear") clear();
else {
  console.error("使い方: node scripts/sample-review.mjs seed | clear");
  process.exit(1);
}
