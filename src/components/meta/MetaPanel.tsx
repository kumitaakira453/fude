import { Icon } from "../Icon";
import { kindOf } from "./kinds";

// 本文の上に出すメタ情報の表（設定で出すと決めたときだけ）。読むためのもので、
// 書き換えは押して開く小窓（MetaModal）でする。
export function MetaPanel({
  data,
  broken,
  onOpen,
}: {
  // 読み取ったメタ情報。無ければ null。
  data: Record<string, unknown> | null;
  broken: boolean;
  onOpen: () => void;
}) {
  if (!data && !broken) return null;
  const entries = data ? Object.entries(data) : [];
  return (
    <section className="mg-meta-panel" aria-label="メタ情報">
      {/* 編集は欄全体のもの。行に重ねると、その行の編集に見える。 */}
      <header className="mg-meta-panel-head">
        <span>
          メタ情報
          {!broken && <span className="mg-meta-panel-count"> · {entries.length} 項目</span>}
        </span>
        <button type="button" className="mg-tbtn" data-tip="メタ情報を編集" data-key="⌘⇧M" onClick={onOpen}>
          <Icon name="edit" size={12} />
          編集
        </button>
      </header>
      {broken ? (
        <button type="button" className="mg-meta-panel-broken" onClick={onOpen}>
          メタ情報を読めません。押すと元の字のまま直せます
        </button>
      ) : (
        <table className="mg-meta-panel-table" onClick={onOpen}>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>
                  {Array.isArray(value) ? (
                    <span className="mg-meta-panel-items">
                      {value.map((v, i) => (
                        <span key={i} className="mg-meta-panel-item">
                          {textOf(v)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <Value text={textOf(value)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// 値を 1 行の字にする。日付は日付だけ、入れ子は書いたままに近い形で出す。
function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Value({ text }: { text: string }) {
  const kind = kindOf(text).id;
  return <span className={`mg-meta-panel-value is-${kind}`}>{text}</span>;
}
