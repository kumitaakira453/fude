import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shortcutsOpenAtom } from "../state/atoms";
import { Icon } from "./Icon";

// キー操作の一覧。⌘/ で開く。
// 操作のそばに常に出しておくと本文の邪魔になるので、ここに集める。
//
// 場面で分ける。同じキーが場面で別のものを指すことがある（⌘I は読むときの
// コメントで、書いている最中は斜体）ので、混ぜると読み違える。

type Face = "move" | "read" | "write" | "review" | "misc";

const FACES: { id: Face; label: string; icon: string }[] = [
  { id: "move", label: "開く・移動", icon: "swap_horiz" },
  { id: "read", label: "読む", icon: "menu_book" },
  { id: "write", label: "書く", icon: "edit_note" },
  { id: "review", label: "コメントと版", icon: "rate_review" },
  { id: "misc", label: "そのほか", icon: "more_vert" },
];

const GROUPS: { title: string; face: Face; rows: [string, string][] }[] = [
  {
    title: "開く・行き来する",
    face: "move",
    rows: [
      ["⌘O", "開く（フォルダ・ファイル）"],
      ["⌘P", "ファイルを探して開く"],
      ["⌘N", "新しいメモ（保存先はあとで決める）"],
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
      ["⌘D", "ファイル一覧の開閉"],
      ["⌘⇧O", "目次（もう一度で畳む）"],
      ["⌘⇧K", "コメントの欄（もう一度で畳む）"],
      ["⌘F", "このファイルの中を検索"],
      ["⌘G", "次を探す"],
      ["⌘⇧F", "フォルダ全体を検索"],
      ["⌘⇧M", "メタ情報"],
      ["⌘⌥C", "全文をコピー"],
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
      ["/", "段落の先頭でブロックを選ぶ"],
      [":", "絵文字を選ぶ"],
      ["⌘⏎", "チェックを入れ替える（タスクの項目の中）"],
      ["⇧⏎", "同じ段落の中で改行する"],
      ["Tab", "コードの塊の中では字下げ（表の中は次のセル）"],
      ["⇧Tab", "字下げを戻す（表の中は前のセル）"],
      ["⌘← ⌘→", "セルの先頭・末尾へ"],
      ["⌘Z", "元に戻す"],
      ["⌘⇧Z ⌘Y", "やり直す"],
      ["⌘⌫", "行の頭まで消す"],
      ["⌫", "選んだところを削除する"],
      ["Esc", "編集を取り消す"],
    ],
  },
  {
    title: "コメントと版",
    face: "review",
    rows: [
      ["⌘I", "選んだところにコメント"],
      ["⌘⇧I", "セル・項目・ブロックの全体にコメント"],
      ["⌘⇧R", "コメントの一覧を開く"],
      ["⌘⇧D", "選んでいるコメントを解決にする（一覧の中）"],
      ["⌘Z", "解決・削除を取り消す"],
      ["⌘⇧P", "コメントの下書きをプレビュー"],
      ["⌘S", "バージョンを保存する（下書きでは名前を付けて保存）"],
      ["⌘Y", "バージョン履歴"],
    ],
  },
  {
    title: "画像・HTML を見る",
    face: "misc",
    rows: [
      ["ピンチ", "指した場所を中心に拡大・縮小"],
      ["ドラッグ", "はみ出しているところを動かす"],
      ["ダブルクリック", "枠に合わせる ↔ 原寸"],
      ["⌘+ ⌘-", "拡大・縮小"],
      ["⌘0", "原寸で見る"],
      ["⌘9", "枠に合わせる"],
    ],
  },
  {
    title: "メタ情報の小窓（⌘⇧M）",
    face: "misc",
    rows: [
      ["Tab", "次の欄へ（⇧Tab で前の欄）"],
      ["↑ ↓", "上下の欄へ"],
      ["⌥↑ ⌥↓", "行を上下に動かす（並びの中では項目を動かす）"],
      ["Enter", "並びの項目では下に項目を足す"],
      ["⌫", "空の鍵で行を消す（並びでは項目を消す）"],
      ["Esc", "小窓を閉じる"],
    ],
  },
  {
    title: "つまみ（本文の左に出る）",
    face: "misc",
    rows: [
      ["ドラッグ", "ブロックを移動"],
      ["クリック", "ブロックのメニュー"],
      ["右クリック", "表の行・列を削除（行・列のつまみ）"],
    ],
  },
  {
    title: "そのほか",
    face: "misc",
    rows: [
      ["⌘,", "設定"],
      ["⌘/", "この一覧"],
    ],
  },
];

export function Shortcuts() {
  const [open, setOpen] = useAtom(shortcutsOpenAtom);
  const [face, setFace] = useState<Face>("move");

  useEffect(() => {
    if (!open) return;
    // 探しにくる場所なので、開くたびに先頭の面から。
    setFace("move");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <div className="mg-keys-back" onClick={() => setOpen(false)}>
      <div className="mg-keys" onClick={(e) => e.stopPropagation()}>
        <nav className="mg-set-tabs">
          {FACES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFace(f.id)}
              className={`mg-set-tab${f.id === face ? " is-on" : ""}`}
            >
              <Icon name={f.icon} size={16} />
              {f.label}
            </button>
          ))}
        </nav>
        <div className="mg-keys-main">
          <div className="mg-keys-head">
            <span className="mg-keys-title">キー操作</span>
            <button
              type="button"
              className="mg-set-close"
              onClick={() => setOpen(false)}
              title="閉じる（Esc）"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="mg-keys-body">
            {GROUPS.filter((group) => group.face === face).map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                {group.rows.map(([key, label]) => (
                  <div key={key + label} className="mg-keys-row">
                    <kbd>{key}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
