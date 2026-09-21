import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useOptimisticSetting } from "../../hooks/useOptimisticSetting";
import { ignoreLines } from "../../lib/ignore";
import { activeFolderIdAtom, folderIgnoresAtom } from "../../state/atoms";
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

// 一覧から外すもの。共通とフォルダごとを切り替えて書く。
//
// 決まりがあるフォルダでは共通を見ない。重ねる形にすると、共通に書いたものを
// そのフォルダだけ外す手立てが無くなる。
export function IgnoreWords({ row }: { row: WordsRow }) {
  const [shared, setShared] = useAtom(row.atom);
  const [byFolder, setByFolder] = useAtom(folderIgnoresAtom);
  const folderId = useAtomValue(activeFolderIdAtom);
  const own = folderId === null ? undefined : byFolder[folderId];
  // 効いている側で開く。共通を書いても届かないフォルダで、共通の面から
  // 始めると、書いたものが効いていないことに気づけない。
  const [side, setSide] = useState<"shared" | "folder">(
    own === undefined ? "shared" : "folder",
  );

  const here = side === "folder" && folderId !== null;
  const value = here ? (own ?? shared) : shared;
  const reading = here && own === undefined;
  // 共通の面を見ているが、このフォルダは自分の決まりで動いている。
  const bypassed = !here && own !== undefined;

  const write = (next: string) => {
    if (here) setByFolder({ ...byFolder, [folderId!]: next });
    else setShared(next);
  };

  const start = () => setByFolder({ ...byFolder, [folderId!]: shared });
  const drop = () => {
    const next = { ...byFolder };
    delete next[folderId!];
    setByFolder(next);
  };

  const count = ignoreLines(value).length;

  return (
    <div className="mg-set-drop">
      <Icon name={row.icon} size={18} className="mg-set-drop-ico text-[var(--mg-muted)]" />
      <div className="mg-set-drop-main">
        <span className="mg-set-row-name">{row.name}</span>
        <span className="mg-set-note">{row.note}</span>
        <div className="mg-rail-pick mg-set-sides">
          <button
            type="button"
            onClick={() => setSide("shared")}
            className={side === "shared" ? "is-on" : ""}
          >
            すべてのフォルダ
          </button>
          <button
            type="button"
            onClick={() => setSide("folder")}
            disabled={folderId === null}
            title={folderId === null ? "フォルダを開いてから" : undefined}
            className={side === "folder" ? "is-on" : ""}
          >
            いまのフォルダ
          </button>
        </div>
        <AutoTextarea
          value={value}
          onChange={(e) => write(e.target.value)}
          placeholder={row.placeholder}
          minRows={3}
          maxRows={10}
          spellCheck={false}
          readOnly={reading}
        />
        <span className="mg-set-note mg-set-sides-foot">
          {reading ? (
            <>
              このフォルダは共通の決まりで外しています
              <button type="button" onClick={start}>
                このフォルダだけの決まりを作る
              </button>
            </>
          ) : bypassed ? (
            <>
              いまのフォルダは別の決まりで動いています（
              {ignoreLines(own).length} 件）
              <button type="button" onClick={() => setSide("folder")}>
                いまのフォルダの決まりを見る
              </button>
            </>
          ) : (
            <>
              {count > 0 ? `${count} 件で外しています` : "いまは何も外していません"}
              {here && (
                <button type="button" onClick={drop}>
                  共通に戻す
                </button>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
