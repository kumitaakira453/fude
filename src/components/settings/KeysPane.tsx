import { useMemo } from "react";

// キー操作の一覧（設定の面のひとつ）。⌘/ でここが開く。
//
// 場面で分ける。同じキーが場面で別のものを指すことがある（⌘I は読むときの
// コメントで、書いている最中は斜体）ので、混ぜると読み違える。

type Face = "move" | "read" | "write" | "review" | "misc";

const GROUPS: { title: string; face: Face; rows: [string, string][] }[] = [
  {
    title: "開く・行き来する",
    face: "move",
    rows: [
      ["⌘O", "開く（フォルダ・ファイル）"],
      ["⌘P", "ファイルを探して開く"],
      ["⌘⇧P", "ワークスペースを探して開く"],
      ["⌘J", "ワークスペースの一覧（⏎ で開く）"],
      ["⌃Tab", "ワークスペースの一覧を出して切り替え（押したまま Tab で次へ）"],
      ["⌘T", "ワークスペースを新規作成"],
      ["⌘1〜9", "ツールバーの左から n 番目のワークスペースへ（⌘9 は一番右。⌘ を押したままにすると番号が出ます）"],
      ["⌘N", "新しいメモ（保存先はあとで決められます）"],
      ["⌘[", "戻る"],
      ["⌘]", "進む"],
      ["⌘\\", "横に分割"],
      ["⌘W", "タブを閉じる"],
      ["⌘⌥W", "他のタブを閉じる"],
      ["⌘⇧W", "すべてのタブを閉じる"],
      ["⌘⇧T", "閉じたタブを開き直す"],
    ],
  },
  {
    title: "読む",
    face: "read",
    rows: [
      ["⌘D", "ファイル一覧の表示・非表示"],
      ["⌘⇧O", "目次の表示・非表示"],
      ["⌘⇧K", "コメント欄の表示・非表示"],
      ["⌘F", "このファイルの中を検索"],
      ["⌘G", "次を探す"],
      ["⌘⇧F", "フォルダ全体を検索"],
      ["⌘⇧M", "メタ情報"],
      ["⌘⌥C", "全文をコピー"],
      ["⌘⇧E", "HTML で書き出す"],
    ],
  },
  {
    title: "書いている最中",
    face: "write",
    rows: [
      ["⌘E", "選んだところを編集する"],
      ["⌘B", "太字"],
      ["⌘I", "斜体"],
      ["⌘U", "下線"],
      ["⌘⇧X", "取り消し線"],
      ["⌘⇧C", "行内コード"],
      ["⌘K", "選んだところをリンクにする"],
      ["/", "段落の先頭で、挿入するブロックを選ぶ"],
      [":", "絵文字を選ぶ"],
      ["⌘⏎", "チェックの切り替え（タスクの行で）"],
      ["⇧⏎", "同じ段落の中で改行する"],
      ["Tab", "コードブロックではインデント（表の中では次のセル）"],
      ["⇧Tab", "インデントを戻す（表の中では前のセル）"],
      ["⌘← ⌘→", "セルの先頭・末尾へ"],
      ["⌘Z", "元に戻す"],
      ["⌘⇧Z ⌘Y", "やり直す"],
      ["⌘⌫", "行頭まで削除"],
      ["⌫", "選んだところを削除する"],
      ["Esc", "編集を取り消す"],
    ],
  },
  {
    title: "コメントと版",
    face: "review",
    rows: [
      ["⌘I", "選んだところにコメント"],
      ["⌘⇧I", "セル・項目・ブロック全体にコメント"],
      ["⌘⇧R", "コメントの一覧を開く"],
      ["⌘⇧D", "選択中のコメントを解決済みにする（一覧で）"],
      ["⌘Z", "解決・削除を取り消す"],
      ["⌘⇧P", "コメントの下書きをプレビュー"],
      ["⌘S", "バージョンを保存する（下書きでは名前を付けて保存）"],
      ["⌘Y", "バージョン履歴"],
    ],
  },
  {
    title: "画像・HTML・CSV・JSON を見る",
    face: "misc",
    rows: [
      ["ピンチ", "指した場所を中心に拡大・縮小"],
      ["ドラッグ", "はみ出している部分を動かして見る"],
      ["ダブルクリック", "画面に合わせる ↔ 実寸"],
      ["⌘+ ⌘-", "拡大・縮小"],
      ["⌘0", "実寸で表示"],
      ["⌘⇧0", "画面に合わせる"],
      ["⌘⇧V", "表示の切り替え（CSV・TSV はテキスト ↔ 表、JSON はツリー ↔ テキスト）"],
    ],
  },
  {
    title: "メタ情報の編集（⌘⇧M）",
    face: "misc",
    rows: [
      ["Tab", "次の欄へ（⇧Tab で前の欄）"],
      ["↑ ↓", "上下の欄へ"],
      ["⌥↑ ⌥↓", "行を上下に移動（リストの中では項目を移動）"],
      ["Enter", "リストの項目では、下に項目を追加"],
      ["⌫", "キーが空の行を削除（リストでは項目を削除）"],
      ["Esc", "閉じる"],
    ],
  },
  {
    title: "ドラッグハンドル（本文の左に出るもの）",
    face: "misc",
    rows: [
      ["ドラッグ", "ブロックを移動"],
      ["クリック", "ブロックのメニュー"],
      ["右クリック", "表の行・列を削除（行・列のハンドルで）"],
    ],
  },
  {
    title: "そのほか",
    face: "misc",
    rows: [
      ["⌘,", "設定"],
      ["⌘/", "ショートカットの一覧（この画面）"],
      ["⌘F", "設定を検索（設定を開いているとき）"],
      ["↑ ↓", "設定の項目を切り替え"],
    ],
  },
];

// 打った字で絞る。キーの字か、何をするかに含むものを残す。まとまりの名前に
// 当たったら、そのまとまりを丸ごと出す。
export function filterKeys(query: string): typeof GROUPS {
  const q = query.trim().toLowerCase();
  if (!q) return GROUPS;
  const hit = (text: string) =>
    q.split(/\s+/).every((word) => text.toLowerCase().includes(word));
  return GROUPS.flatMap((g) => {
    if (hit(g.title)) return [g];
    const rows = g.rows.filter(([key, what]) => hit(`${key} ${what}`));
    return rows.length ? [{ ...g, rows }] : [];
  });
}

// 絞り込みが当てるための言葉（面の行の別名に入れる）。
export const KEY_WORDS: string[] = GROUPS.flatMap((g) => [g.title, ...g.rows.map(([, what]) => what)]);

export function KeysPane({ query = "" }: { query?: string }) {
  const groups = useMemo(() => filterKeys(query), [query]);
  if (groups.length === 0) {
    return <p className="mg-set-none">「{query}」に当たるキー操作はありません</p>;
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.title} className="mg-set-group">
          <h3 className="mg-set-group-title">{g.title}</h3>
          <div className="mg-set-card">
            {g.rows.map(([key, what]) => (
              <div key={`${key} ${what}`} className="mg-set-row is-static mg-set-key">
                <span className="mg-set-row-main">
                  <span className="mg-set-key-what">{what}</span>
                </span>
                <kbd className="mg-set-kbd">{key}</kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
