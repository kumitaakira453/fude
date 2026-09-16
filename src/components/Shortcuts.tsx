import { useAtom } from "jotai";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { shortcutsOpenAtom } from "../state/atoms";
import { Icon } from "./Icon";

// キー操作の一覧。⌘/ で開く。
// 操作のそばに常に出しておくと本文の邪魔になるので、ここに集める。

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "開く・探す",
    rows: [
      ["⌘N", "新しいメモ（保存先はあとで決める）"],
      ["⌘P", "ファイルを探して開く"],
      ["⌘F", "このファイルの中を検索"],
      ["⌘⇧F", "フォルダ全体を検索"],
      ["⌘D", "サイドバーの開閉"],
      ["⌘⇧R", "コメントの一覧を開く"],
      ["⌘⇧M", "メタ情報を開く"],
      ["⌘,", "設定"],
      ["⌘/", "この一覧"],
    ],
  },
  {
    title: "本文",
    rows: [
      ["⌘I", "選んだところにコメント"],
      ["⌘⇧I", "セル・項目・ブロックの全体にコメント"],
      ["⌘E", "選んだところを編集する"],
      ["⌘S", "バージョンを保存する（下書きでは名前を付けて保存）"],
      ["/", "段落の先頭でブロックを選ぶ（書いている最中）"],
      [":", "絵文字を選ぶ（書いている最中）"],
      ["⌘B", "太字（書いている最中）"],
      ["⌘I", "斜体（書いている最中）"],
      ["⌘⇧X", "取り消し線（書いている最中）"],
      ["⌘⇧C", "行内コード（書いている最中）"],
      ["⌘K", "選んだところをリンクにする（書いている最中）"],
      ["⌘⏎", "チェックを入れ替える（タスクの項目の中）"],
      ["⌘⇧P", "コメントの下書きをプレビュー"],
      ["Tab", "コードの塊の中では字下げ（表の中は次のセル）"],
      ["⌫", "選んだところを削除する"],
      ["Esc", "編集を取り消す"],
    ],
  },
  {
    title: "画像・HTML を見る",
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
    title: "コメントの一覧",
    rows: [
      ["⌘⇧D", "選んでいるコメントを解決にする"],
      ["⌘Z", "解決・削除を取り消す"],
      ["Esc", "一覧を閉じる"],
    ],
  },
  {
    title: "画面",
    rows: [
      ["⌘\\", "横に分割"],
      ["⌘W", "タブを閉じる"],
      ["⌘⌥W", "他のタブを閉じる"],
      ["⌘⇧W", "すべてのタブを閉じる"],
      ["⌘⇧T", "閉じたタブを開き直す"],
      ["⌘[", "戻る"],
      ["⌘]", "進む"],
    ],
  },
  {
    title: "つまみ（本文の左に出る）",
    rows: [
      ["ドラッグ", "ブロックを移動"],
      ["クリック", "ブロックのメニュー"],
      ["右クリック", "表の行・列を削除（行・列のつまみ）"],
    ],
  },
];

export function Shortcuts() {
  const [open, setOpen] = useAtom(shortcutsOpenAtom);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <div className="mg-keys-back" onClick={() => setOpen(false)}>
      <div className="mg-keys" onClick={(e) => e.stopPropagation()}>
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
          {GROUPS.map((group) => (
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
    </div>,
    document.body,
  );
}
