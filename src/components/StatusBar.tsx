import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { PHASE_LABEL } from "../lib/claude";
import { RAIL_ROOM } from "../lib/sidebar";
import {
  activePaneAtom,
  activePath,
  contentCacheAtom,
  liveEditAtom,
  panesAtom,
  railAtom,
  readingWidthAtom,
  savingCountAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  watchModeAtom,
  workspaceAtom,
} from "../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../state/claude";
import { draftRelAtom } from "../state/drafts";
import { openCountsAtom, versionScreenAtom } from "../state/review";
import { Icon } from "./Icon";

// 足元の帯。開いている文書と画面の状態をまとめて出し、押すとその状態を切り替える
// か、関係する画面へ移る。状態をあちこちの小さな印に散らさないための置き場。

const WIDTHS = ["cozy", "wide", "full"] as const;
const WIDTH_LABEL = { cozy: "標準", wide: "広め", full: "全幅" } as const;
const WATCH_LABEL = {
  observer: "監視中",
  polling: "監視中（間隔で確認）",
  off: "監視停止",
} as const;

// 字数（空白と改行を除く）と行数。
export function countText(text: string): { chars: number; lines: number } {
  let chars = 0;
  let lines = text.length > 0 ? 1 : 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) lines++;
    else if (c !== 32 && c !== 9 && c !== 13 && c !== 0x3000) chars++;
  }
  return { chars, lines };
}

function Item({
  tip,
  keys,
  on,
  onClick,
  children,
  className = "",
}: {
  tip: string;
  keys?: string;
  on?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!onClick) {
    return (
      <span className={`mg-foot-item is-static ${className}`} data-tip={tip}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`mg-foot-item${on ? " is-on" : ""} ${className}`}
      data-tip={tip}
      data-key={keys}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function StatusBar() {
  const pane = useAtomValue(activePaneAtom);
  const path = activePath(pane);
  const cache = useAtomValue(contentCacheAtom);
  const text = path ? cache.get(path) : undefined;
  const saving = useAtomValue(savingCountAtom);
  const watch = useAtomValue(watchModeAtom);
  const [live, setLive] = useAtom(liveEditAtom);
  const [rail, setRail] = useAtom(railAtom);
  const [width, setWidth] = useAtom(readingWidthAtom);
  const panes = useAtomValue(panesAtom);
  const counts = useAtomValue(openCountsAtom);
  const ws = useAtomValue(workspaceAtom);
  const phase = useAtomValue(phaseForAtom)(ws);
  const isDraft = useAtomValue(draftRelAtom) !== null;
  const openVersions = useSetAtom(versionScreenAtom);
  const setSideOpen = useSetAtom(sidebarOpenAtom);
  const setFace = useSetAtom(sidebarTabAtom);
  const isLg = useMediaQuery(RAIL_ROOM);
  // 右の欄は、窓が広く、分割していないときだけ出せる。
  const canRail = isLg && panes.length <= 1;
  const count = useMemo(() => (text === undefined ? null : countText(text)), [text]);
  // 最後に書き終えた時刻。この窓で保存を見届けたときだけ出す。
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && saving === 0) setSavedAt(new Date());
    wasSaving.current = saving > 0;
  }, [saving]);
  useEffect(() => setSavedAt(null), [path]);
  const open = path ? (counts.get(path) ?? 0) : 0;
  const why = "窓が狭いか、分割しているあいだは出せません";

  return (
    <footer className="mg-foot">
      {path && (
        <>
          <Item
            tip={saving > 0 ? "保存しています" : isDraft ? "保存先がまだ決まっていない下書き" : "押すとバージョン履歴"}
            keys={saving > 0 || isDraft ? undefined : "⌘Y"}
            onClick={saving > 0 || isDraft ? undefined : () => openVersions(path)}
          >
            {saving > 0 ? (
              <Icon name="progress_activity" size={12} className="mg-spin" />
            ) : (
              <span className={`mg-foot-dot${isDraft ? " is-warn" : " is-ok"}`} />
            )}
            {saving > 0 ? "保存中" : isDraft ? "下書き" : "保存済み"}
            {saving === 0 && !isDraft && savedAt && (
              <span className="mg-foot-num">
                {savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </Item>
        </>
      )}
      <Item tip="ファイルの変更を見張っているか">
        <Icon name="visibility" size={12} stroke={1.7} />
        {WATCH_LABEL[watch]}
      </Item>
      {path && (
        <Item tip="閲覧と編集を切り替える" keys="⌘E" on={live} onClick={() => setLive((v) => !v)}>
          {live ? "編集" : "閲覧"}
        </Item>
      )}
      <span className="mg-foot-grow" />
      {ws?.claude && phase && (
        <Item
          tip="Claude のセッション。押すと、このセッションのファイルを出す"
          onClick={() => {
            setFace("claude");
            setSideOpen(true);
          }}
        >
          <span className="mg-foot-dot" style={{ background: PHASE_COLOR[phase] }} />
          Claude {PHASE_LABEL[phase]}
        </Item>
      )}
      <span className="mg-foot-grow" />
      {path && (
        <>
          <Item
            tip={canRail ? "目次" : `目次（${why}）`}
            keys="⌘⇧O"
            on={canRail && rail === "toc"}
            onClick={canRail ? () => setRail(rail === "toc" ? "none" : "toc") : undefined}
          >
            目次
          </Item>
          <Item
            tip={canRail ? "コメント" : `コメント（${why}）`}
            keys="⌘⇧K"
            on={canRail && rail === "comments"}
            onClick={canRail ? () => setRail(rail === "comments" ? "none" : "comments") : undefined}
          >
            コメント {open > 0 && <span className="mg-foot-num">{open}</span>}
          </Item>
          <span className="mg-foot-sep" />
          <Item
            tip="本文の幅。押すと順に切り替える"
            onClick={() => setWidth(WIDTHS[(WIDTHS.indexOf(width) + 1) % WIDTHS.length])}
          >
            幅 {WIDTH_LABEL[width]}
          </Item>
          {count && (
            <>
              <Item tip="字数（空白と改行を除く）">
                <span className="mg-foot-num">{count.chars.toLocaleString()}</span> 字
              </Item>
              <Item tip="行数">
                <span className="mg-foot-num">L {count.lines.toLocaleString()}</span>
              </Item>
            </>
          )}
        </>
      )}
    </footer>
  );
}
