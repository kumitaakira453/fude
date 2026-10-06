import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { PHASE_LABEL, type Phase } from "../lib/claude";
import { currentWindowLabel } from "../lib/windows";
import { colorVar, liveWorkspaces } from "../lib/workspaces";
import {
  newWorkspaceAtom,
  workspaceAtom,
  workspaceMenuAtom,
  workspacesAtom,
} from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { barAtom, hintsAtom, moveInBar, removeFromBar } from "../state/workspaceBar";
import { Icon } from "./Icon";

// ツールバーの中に並べるワークスペースの札。1 回押せば切り替わる。
// ファイルのタブとは段も形も分ける（同じ形で 2 段に重ねると、どちらがどちらか
// 読めない）。右押しで手入れのメニュー、末尾の ＋ で作る。
// 掴んで並べ替え、× か中クリックでツールバーから外す（⌘1〜9 はこの並びの位置を指す）。

const DRAG_TYPE = "application/x-fude-ws";

// 札に言葉で添える状態。作業中・待機中は点だけで足りる。
const PHASE_BADGE: Partial<Record<Phase, string>> = {
  waiting: "応答待ち",
  done: "終了",
  ended: "終了",
  deleted: "削除済み",
};

// ⌘ を押したままにして、番号を出すまでの間。
const HINT_AFTER_MS = 300;

// その札を指す ⌘ の数字（⌘9 は一番右）。指すキーが無ければ null。
export function hintOf(i: number, count: number): string | null {
  if (i === count - 1 && count >= 9) return "9";
  return i < 8 ? String(i + 1) : null;
}

export function WorkspacePills() {
  const [bar, setBar] = useAtom(barAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const openMenu = useSetAtom(workspaceMenuAtom);
  const [making, setMaking] = useAtom(newWorkspaceAtom);
  const { openWorkspace } = useWorkspace();
  // 別のウィンドウで開いているもの。押すとそのウィンドウが前に出る。
  const [elsewhere, setElsewhere] = useState<Set<string>>(new Set());
  const [dropAt, setDropAt] = useState<number | null>(null);
  const here = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const byId = new Map(list.map((w) => [w.id, w]));
    if (current) byId.set(current.id, current);
    return bar.flatMap((id) => {
      const ws = byId.get(id);
      return ws ? [ws] : [];
    });
  }, [bar, list, current]);

  useEffect(() => {
    const me = currentWindowLabel();
    const read = () =>
      void liveWorkspaces()
        .then((live) =>
          setElsewhere(
            new Set(live.filter(([l]) => l !== me).map(([, id]) => id)),
          ),
        )
        .catch(() => setElsewhere(new Set()));
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [bar, current?.id]);

  useEffect(() => {
    here.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.id, items.length]);

  // ⌘ だけを押したまましばらく待つと、札に ⌘1〜9 の番号を出す。⌘S などを
  // 押す途中でちらっと出ないよう、少し待ってから出す。
  const [hints, setHints] = useAtom(hintsAtom);
  useEffect(() => {
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      setHints(false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setHints(true), HINT_AFTER_MS);
      } else {
        hide();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") hide();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
      hide();
    };
  }, [setHints]);

  const indexAt = (e: React.DragEvent<HTMLDivElement>): number => {
    const pills = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-ws]"),
    );
    for (let i = 0; i < pills.length; i++) {
      const box = pills[i].getBoundingClientRect();
      if (e.clientX < box.left + box.width / 2) return i;
    }
    return pills.length;
  };

  return (
    // 札の並びだけを横に送る。＋ は送る箱の外に置き、端で切れないようにする。
    <div className="mg-ws-pills-wrap">
      <div
        role="tablist"
        aria-label="ワークスペース"
        className="mg-ws-pills"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropAt(indexAt(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDropAt(null);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          const at = dropAt;
          setDropAt(null);
          if (!id || at === null) return;
          e.preventDefault();
          setBar((was) => moveInBar(was, id, at));
        }}
      >
        {items.map((ws, i) => {
          const on = ws.id === current?.id;
          const away = !on && elsewhere.has(ws.id);
          const phase = phaseFor(ws);
          return (
            <div
              key={ws.id}
              tabIndex={0}
              data-ws={ws.id}
              ref={on ? here : undefined}
              role="tab"
              aria-selected={on}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, ws.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => {
                if (!on) void openWorkspace(ws);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !on) {
                  e.preventDefault();
                  void openWorkspace(ws);
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) setBar((was) => removeFromBar(was, ws.id));
              }}
              onMouseDown={(e) => {
                // 右ボタンで押した瞬間に、下の語が選ばれるのを止める。
                if (e.button === 2) e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu({ id: ws.id, x: e.clientX, y: e.clientY });
              }}
              title={
                away
                  ? `${ws.name}（別のウィンドウで開いています）`
                  : i < 9
                    ? `${ws.name}（⌘${i + 1}）`
                    : ws.name
              }
              className={`mg-ws-pill${on ? " is-on" : ""}${away ? " is-away" : ""}${
                dropAt === i ? " drop-before" : ""
              }${dropAt === i + 1 && i === items.length - 1 ? " drop-after" : ""}`}
            >
              {hints && hintOf(i, items.length) ? (
                <kbd className="mg-ws-pill-hint" style={{ color: colorVar(ws.color) }}>
                  ⌘{hintOf(i, items.length)}
                </kbd>
              ) : (
                <span
                  className="mg-ws-dot"
                  style={{ background: colorVar(ws.color) }}
                />
              )}
              <span className="truncate">{ws.name}</span>
              {phase && (
                <span
                  title={`Claude のセッション：${PHASE_LABEL[phase]}`}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${phase === "working" ? "animate-pulse" : ""}`}
                  style={{ background: PHASE_COLOR[phase] }}
                />
              )}
              {/* 返事を待っているもの・終わったものは、点だけでは見落とすので言葉でも出す。 */}
              {phase && PHASE_BADGE[phase] && (
                <span className={`mg-ws-pill-badge is-${phase}`}>
                  {PHASE_BADGE[phase]}
                </span>
              )}
              {/* ツールバーから外すだけ。ワークスペースは消えない（⌘⇧P からまた開ける）。 */}
              <span
                role="button"
                tabIndex={-1}
                title="ツールバーから外す（ワークスペースは残ります）"
                onClick={(e) => {
                  e.stopPropagation();
                  setBar((was) => removeFromBar(was, ws.id));
                }}
                className="mg-ws-pill-x"
              >
                <Icon name="close" size={12} />
              </span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        title="ワークスペースを新規作成（⌘T）"
        aria-expanded={!!making}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setMaking(making ? null : { left: box.left, top: box.bottom + 6 });
        }}
        className="mg-ws-pill-add"
      >
        <Icon name="add" size={16} />
      </button>
    </div>
  );
}
