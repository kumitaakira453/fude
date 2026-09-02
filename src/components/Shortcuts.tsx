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
      ["⌘P", "ファイルを探して開く"],
      ["⌘F", "このファイルの中を検索"],
      ["⌘⇧F", "フォルダ全体を検索"],
      ["⌘B", "サイドバーの開閉"],
      ["⌘⇧R", "指摘の一覧を開く"],
      ["⌘,", "設定"],
      ["⌘/", "この一覧"],
    ],
  },
  {
    title: "本文",
    rows: [
      ["⌘I", "選んだところに指摘する"],
      ["⌘⇧I", "セル全体／ブロック全体に指摘する"],
      ["⌘E", "選んだところを編集する"],
      ["Esc", "編集を取り消す"],
    ],
  },
  {
    title: "画面",
    rows: [
      ["⌘\\", "横に分割"],
      ["⌘W", "タブを閉じる"],
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
