import { useAtom } from "jotai";
import { useOptimisticSetting } from "../../hooks/useOptimisticSetting";
import { AutoTextarea } from "../AutoTextarea";
import { Icon } from "../Icon";
import type { SwitchRow, WordsRow } from "./rows";

// 設定の 1 行。切り替えと打ち込みの 2 つだけをここで描く。
// 見本を出して選ぶもの（テーマ・書体・幅）と、このアプリの欄は形が違うので
// Settings の側が持つ。

export function Switch({ row }: { row: SwitchRow }) {
  const [stored, store] = useAtom(row.atom);
  // 押した瞬間に切り替える（反映に伴う描き直しを待たせない）。
  const [on, set] = useOptimisticSetting(stored, store);
  return (
    <button type="button" onClick={() => set(!on)} className="mg-set-row">
      <Icon
        name={row.icon}
        size={18}
        fill={on}
        className={on ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"}
      />
      <span className="mg-set-row-main">
        <span className="mg-set-row-name">
          {row.name}
          {row.beta && <span className="mg-set-beta">Beta</span>}
        </span>
        <span className="mg-set-note">{row.note}</span>
      </span>
      <span className={`mg-switch${on ? " is-on" : ""}`}>
        <i />
      </span>
    </button>
  );
}

export function Words({
  row,
  foot,
}: {
  row: WordsRow;
  // 打った中身から出す添え書き（効いている数など）。無ければ出さない。
  foot?: string;
}) {
  const [value, set] = useAtom(row.atom);
  return (
    <div className="mg-set-drop">
      <Icon name={row.icon} size={18} className="mg-set-drop-ico text-[var(--mg-muted)]" />
      <div className="mg-set-drop-main">
        <span className="mg-set-row-name">{row.name}</span>
        <span className="mg-set-note">{row.note}</span>
      {row.lines === "many" ? (
        <AutoTextarea
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={row.placeholder}
          minRows={3}
          maxRows={10}
          spellCheck={false}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={row.placeholder}
          spellCheck={false}
        />
      )}
        {foot && <span className="mg-set-note">{foot}</span>}
      </div>
    </div>
  );
}
