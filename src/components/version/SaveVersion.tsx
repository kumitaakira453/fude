import { useState } from "react";
import { createPortal } from "react-dom";
import { useImeSafeEnter } from "../../hooks/useImeSafeEnter";
import { Icon } from "../Icon";

// バージョンの名前を決める小窓。
//
// 名前は任意なので、開いた時点で日時を入れて全選択しておく。空欄と向き合わせず、
// そのまま Enter でも打てる。
//
// 画面の中央に出す。帯のボタンの真下に垂らすと、名前を考えるあいだ目を本文の
// 右上の隅に留めることになる。
//
// 打ちかけは開くたびに作り直す（この部品ごと出し入れするので、閉じた時点で
// 消える）。取り消した名前が次に開いたときへ残らない。
export function SaveVersion({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ime = useImeSafeEnter();

  const save = () => {
    onClose();
    onSave(name);
  };

  return createPortal(
    <div className="mg-ver-save-back" onClick={onClose}>
      <div
        className="mg-ver-save"
        role="dialog"
        aria-label="バージョンを保存"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mg-ver-save-head">
          <Icon name="save_as" size={16} className="text-[var(--mg-accent)]" />
          バージョンを保存
        </div>
        <input
          autoFocus
          value={name}
          placeholder="名前なしで保存"
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && !ime.isComposing(e)) {
              e.preventDefault();
              save();
            }
          }}
          className="mg-ver-save-input"
        />
        <div className="mg-ver-save-foot">
          {/* 押した瞬間に確定する（mousedown で拾う）。click を待つと、
              入力欄から焦点が外れる拍子に押下がどこにも届かないことがある。 */}
          <button
            type="button"
            className="mg-small"
            onMouseDown={(e) => {
              e.preventDefault();
              onClose();
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="mg-small is-go"
            onMouseDown={(e) => {
              e.preventDefault();
              save();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
