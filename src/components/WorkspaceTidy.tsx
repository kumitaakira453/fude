import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PHASE_LABEL, type Phase } from "../lib/claude";
import { groupKeyOf, initialOf } from "../lib/railGroups";
import { colorVar, type Workspace } from "../lib/workspaces";

// 終了・削除済みのセッションのワークスペースを、まとめて削除する前の問い。
// 初めは全部を削除の対象にし、行を押すと「残す」に替わる（もう一度押すと戻る）。
// フォルダとファイルは消さない。

const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

export function WorkspaceTidy({
  items,
  onGo,
  onClose,
}: {
  items: { ws: Workspace; phase: Phase }[];
  onGo: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [kept, setKept] = useState<Set<string>>(new Set());
  const picked = items.filter((i) => !kept.has(i.ws.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flip = (id: string) =>
    setKept((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return createPortal(
    <div className="mg-ver-save-back" onClick={onClose}>
      <div
        className="mg-tidy"
        role="dialog"
        aria-label="終了したセッションのワークスペースを整理"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mg-tidy-head">
          <div className="mg-tidy-title">終了したセッションのワークスペースを整理</div>
          <p className="mg-tidy-note">
            セッションが終了したか、記録が消えたワークスペースです。フォルダとファイルは消えません。押すと残せます。
          </p>
        </div>
        <ul className="mg-tidy-list">
          {items.map(({ ws, phase }) => {
            const keep = kept.has(ws.id);
            return (
              <li key={ws.id}>
                <button
                  type="button"
                  className={`mg-tidy-row${keep ? " is-kept" : ""}`}
                  aria-pressed={!keep}
                  data-tip={keep ? "押すと削除に戻す" : "押すと残す"}
                  onClick={() => flip(ws.id)}
                >
                  <span className="mg-tidy-chip" style={{ background: colorVar(ws.color) }} aria-hidden>
                    {initialOf(ws.name)}
                  </span>
                  <span className="mg-tidy-text">
                    <span className="mg-tidy-name">{ws.name}</span>
                    <span className="mg-tidy-where">{baseName(groupKeyOf(ws))}</span>
                  </span>
                  <span className={`mg-tidy-tag${keep ? " is-kept" : ""}`}>
                    {keep ? "残す" : PHASE_LABEL[phase]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mg-tidy-foot">
          <span className="mg-tidy-count">
            {items.length} 件中 {picked.length} 件を削除
          </span>
          <button type="button" className="mg-small" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="mg-small is-danger"
            disabled={picked.length === 0}
            onClick={() => onGo(picked.map((i) => i.ws.id))}
          >
            {picked.length} 件を削除
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
