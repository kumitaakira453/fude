import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLinger } from "../hooks/useLinger";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { groupKeyOf, initialOf, otherRoots, railGroups } from "../lib/railGroups";
import { RAIL_MS, RAIL_STRIP, SIDEBAR_WIDTH } from "../lib/sidebar";
import { currentWindowLabel } from "../lib/windows";
import { colorVar, liveWorkspaces, type Workspace } from "../lib/workspaces";
import {
  newWorkspaceAtom,
  railOpenAtom,
  workspaceAtom,
  workspaceMenuAtom,
  workspacesAtom,
} from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { addToBar, barAtom, hintOf, hintsAtom, moveInBar } from "../state/workspaceBar";
import { Icon } from "./Icon";
import { MARKED, StatusMark } from "./StatusMark";
import { WorkspaceCard } from "./WorkspaceCard";

// 左端の帯。ワークスペースをフォルダごとに寄せた札で並べる。1 回押せば切り替わる。
//
// 上のボタン（⌘⇧B）で開くと、左の欄の木の上へ伸びて、見出し付きの一覧になる
// （開いた幅は App が wide で渡す）。札は開いても閉じても同じ位置に置き、名前など
// の字だけを消し出しする。一覧で押して移ると畳む。札を指すとしばらくして
// 中身の札を出す。右押しで手入れのメニュー、一番下の ＋ で作る。

const DRAG_TYPE = "application/x-fude-ws";
// 札を指してから中身の札を出すまで。通りすがりには出さず、待たせもしない
// （会話は札を出してから読み、読み終わるまでは読み込み中と出す）。
const CARD_AFTER_MS = 250;

export function WorkspaceRail({ wide = RAIL_STRIP + SIDEBAR_WIDTH }: { wide?: number }) {
  const [open, setOpen] = useAtom(railOpenAtom);
  // 開いた中身は、畳む動きが終わるまで描き続ける（その間に字を薄くして消す）。
  const shown = useLinger(open, RAIL_MS);
  const [bar, setBar] = useAtom(barAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const hints = useAtomValue(hintsAtom);
  const openMenu = useSetAtom(workspaceMenuAtom);
  const setMaking = useSetAtom(newWorkspaceAtom);
  const { openWorkspace } = useWorkspace();
  const { closeWorkspace } = useWorkspaceOps();
  const [elsewhere, setElsewhere] = useState<Set<string>>(new Set());
  const [card, setCard] = useState<{ ws: Workspace; at: DOMRect; n: number } | null>(null);
  const cardTimer = useRef(0);
  const [dragging, setDragging] = useState<string | null>(null);

  const all = useMemo(() => {
    const byId = new Map(list.map((w) => [w.id, w]));
    if (current) byId.set(current.id, current);
    return [...byId.values()];
  }, [list, current]);
  const groups = useMemo(() => railGroups(bar, all), [bar, all]);
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // 列に載っていないもの（他の窓で作ったものなど）は末尾に足す。
  useEffect(() => {
    const missing = list.filter((w) => !bar.includes(w.id));
    if (missing.length === 0) return;
    setBar((was) => missing.reduce((acc, w) => addToBar(acc, w.id), was));
  }, [list, bar, setBar]);

  useEffect(() => {
    const me = currentWindowLabel();
    const read = () =>
      void liveWorkspaces()
        .then((live) => setElsewhere(new Set(live.filter(([l]) => l !== me).map(([, id]) => id))))
        .catch(() => setElsewhere(new Set()));
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [bar, current?.id]);

  useEffect(() => () => window.clearTimeout(cardTimer.current), []);

  const pick = (ws: Workspace) => {
    hideCard();
    setOpen(false);
    if (ws.id !== current?.id) void openWorkspace(ws);
  };
  const showCardSoon = (ws: Workspace, el: HTMLElement, n: number) => {
    window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(
      () => setCard({ ws, at: el.getBoundingClientRect(), n }),
      CARD_AFTER_MS,
    );
  };
  const hideCard = () => {
    window.clearTimeout(cardTimer.current);
    setCard(null);
  };
  const menu = (e: React.MouseEvent, ws: Workspace) => {
    e.preventDefault();
    hideCard();
    openMenu({ id: ws.id, x: e.clientX, y: e.clientY });
  };
  // 並べ替えは同じまとまりの中だけ。まとまりは決め方で決まるので、跨いでも意味が無い。
  const dropOn = (e: React.DragEvent, target: Workspace) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    setDragging(null);
    const moved = all.find((w) => w.id === id);
    if (!moved || moved.id === target.id || groupKeyOf(moved) !== groupKeyOf(target)) return;
    e.preventDefault();
    setBar((was) => moveInBar(was, id, was.indexOf(target.id)));
  };

  let n = 0;
  return (
    <nav
      className={`mg-wsrail${open ? " is-open" : ""}${shown ? " is-shown" : ""}`}
      style={{ width: open ? wide : RAIL_STRIP }}
      aria-label="ワークスペース"
      onMouseLeave={hideCard}
    >
      <div className="mg-wsrail-head">
        <button
          type="button"
          className="mg-wsrail-toggle"
          data-tip={open ? "畳む" : "ワークスペースの一覧"}
          data-key="⌘⇧B"
          aria-expanded={open}
          onClick={() => {
            hideCard();
            setOpen(!open);
          }}
        >
          <Icon name={open ? "rail_close" : "rail_open"} size={17} />
        </button>
        {shown && <span className="mg-wsrail-title mg-wsrail-fade">ワークスペース</span>}
      </div>
      <div
        className="mg-wsrail-list"
        onWheel={(e) => {
          // 畳んだ帯はバーを持たない（overflow: hidden）ので、ホイールで自分で送る。
          if (!open) e.currentTarget.scrollTop += e.deltaY;
        }}
      >
        {groups.map((g, gi) => (
          <div key={g.key} className="mg-wsrail-group" title={open ? g.key : undefined}>
            {/* 畳んだときの区切り線と、開いたときの見出しを重ねて置き、高さを動かす。 */}
            <div className={`mg-wsrail-group-top${gi === 0 ? " is-first" : ""}`}>
              {gi > 0 && <div className="mg-wsrail-sep" aria-hidden />}
              {shown && <div className="mg-wsrail-group-head mg-wsrail-fade">{g.label}</div>}
            </div>
            {g.items.map((ws) => {
              const i = n++;
              const on = ws.id === current?.id;
              const away = !on && elsewhere.has(ws.id);
              const phase = phaseFor(ws);
              const num = hintOf(i, order.length);
              const key = num ? `⌘${num}` : undefined;
              const chip = (
                <span
                  className="mg-wsrail-chip"
                  style={{ background: colorVar(ws.color) }}
                  aria-hidden
                >
                  {initialOf(ws.name)}
                  <StatusMark phase={phase} />
                  {hints && key && <kbd className="mg-wsrail-hint">{key}</kbd>}
                </span>
              );
              return (
                <div
                  key={ws.id}
                  role="button"
                  tabIndex={0}
                  data-ws={ws.id}
                  aria-current={on || undefined}
                  aria-label={ws.name}
                  draggable={open}
                  className={`mg-wsrail-item${on ? " is-on" : ""}${away ? " is-away" : ""}${
                    dragging === ws.id ? " is-dragging" : ""
                  }`}
                  onClick={() => pick(ws)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(ws);
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (!open) showCardSoon(ws, e.currentTarget, i);
                  }}
                  onMouseLeave={hideCard}
                  onMouseDown={(e) => {
                    // 右ボタンで押した瞬間に、下の語が選ばれるのを止める。
                    if (e.button === 2) e.preventDefault();
                  }}
                  onContextMenu={(e) => menu(e, ws)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, ws.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(ws.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
                  }}
                  onDrop={(e) => dropOn(e, ws)}
                >
                  {chip}
                  {shown && (
                    <>
                      <span className="mg-wsrail-text mg-wsrail-fade">
                        <span className="mg-wsrail-name">{ws.name}</span>
                        <span className="mg-wsrail-where">
                          {g.label}
                          {otherRoots(ws) > 0 && ` ＋${otherRoots(ws)}`}
                          {away && " ・ 別のウィンドウ"}
                        </span>
                      </span>
                      {phase && MARKED[phase] && MARKED[phase] !== "done" && (
                        <span className={`mg-wsrail-state mg-wsrail-fade is-${MARKED[phase]}`}>{PHASE_LABEL[phase]}</span>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        data-tip="ワークスペースを削除"
                        className="mg-wsrail-x"
                        onClick={(e) => {
                          e.stopPropagation();
                          void closeWorkspace(ws.id);
                        }}
                      >
                        <Icon name="close" size={12} stroke={1.8} />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mg-wsrail-item mg-wsrail-add"
        data-tip={open ? undefined : "ワークスペースを作る"}
        data-key="⌘T"
        onClick={() => {
          hideCard();
          setOpen(false);
          setMaking(true);
        }}
      >
        <span className="mg-wsrail-chip is-add" aria-hidden>
          <Icon name="add" size={15} />
        </span>
        {shown && (
          <span className="mg-wsrail-text mg-wsrail-fade">
            <span className="mg-wsrail-name">ワークスペースを作る</span>
            <span className="mg-wsrail-where">フォルダ・Claude のセッションから</span>
          </span>
        )}
      </button>
      {card && <WorkspaceCard ws={card.ws} at={card.at} keys={hintOf(card.n, order.length)} />}
    </nav>
  );
}
