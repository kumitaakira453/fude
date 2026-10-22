import { useAtomValue } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTalk } from "../hooks/useTalk";
import { PHASE_LABEL } from "../lib/claude";
import { groupKeyOf, initialOf, otherRoots } from "../lib/railGroups";
import { ago } from "../lib/when";
import { colorVar, type Workspace } from "../lib/workspaces";
import { claudeSessionsAtom } from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { openCountForAtom } from "../state/review";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { StatusMark } from "./StatusMark";

// 帯の札を指したときの中身の札。どの作業かを、名前を変えずに見分けられるように、
// 最後の依頼と返答、書いたファイル、未解決のコメントを出す。

const FILES_SHOWN = 3;
const baseName = (path: string): string => path.split("/").pop() ?? path;

export function WorkspaceCard({ ws, at, keys }: { ws: Workspace; at: DOMRect; keys: string | null }) {
  const phase = useAtomValue(phaseForAtom)(ws);
  const sessions = useAtomValue(claudeSessionsAtom);
  const comments = useAtomValue(openCountForAtom)(ws.roots);
  const session = sessions?.sessions.find((s) => s.sessionId === ws.claude?.sessionId);
  const transcript = session?.transcript ?? ws.claude?.transcript;
  const linked = !!transcript;
  const talk = useTalk(transcript, 0);
  const wrote = [...(ws.claude?.wrote ?? [])].sort((a, b) => b.at - a.at);
  const place = baseName(groupKeyOf(ws));
  const more = otherRoots(ws);
  const now = Date.now();

  // 帯の右に、指した札の高さに合わせて出す。下にはみ出すときは、出したあとの
  // 高さを測って上へずらす（中身の長さで高さが変わる）。
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(at.top - 6);
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(at.top - 6, window.innerHeight - h - 8)));
  }, [at.top, talk, wrote.length]);
  return createPortal(
    <div ref={box} className="mg-wscard" role="tooltip" style={{ left: at.right + 10, top }}>
      <div className="mg-wscard-head">
        <span className="mg-wscard-chip" style={{ background: colorVar(ws.color) }}>
          {initialOf(ws.name)}
        </span>
        <span className="mg-wscard-title">
          <b>{ws.name}</b>
          <span>
            {place}
            {more > 0 && ` ＋${more}`}
          </span>
        </span>
        {phase && PHASE_LABEL[phase] && (
          <span className={`mg-wscard-phase is-${phase}`}>
            <StatusMark phase={phase} />
            {PHASE_LABEL[phase]}
          </span>
        )}
      </div>
      {linked && !talk && (
        <div className="mg-wscard-talk is-loading">
          <p className="is-ask">　　　　　　</p>
          <p className="is-answer">会話を読み込んでいます…</p>
        </div>
      )}
      {talk && (talk.ask || talk.last) && (
        <div className="mg-wscard-talk">
          {talk.ask && (
            <p className="is-ask">
              <span className="mg-wscard-clamp">{talk.ask}</span>
            </p>
          )}
          {talk.last && (
            <p className="is-answer">
              <Icon name="claude" size={13} stroke={1.8} className="mg-wscard-claude" />
              <span className="mg-wscard-clamp">{talk.last}</span>
            </p>
          )}
          {wrote[0] && <span className="mg-wscard-when">{ago(wrote[0].at, now)}</span>}
        </div>
      )}
      {wrote.length > 0 && (
        <div className="mg-wscard-files">
          {wrote.slice(0, FILES_SHOWN).map((w) => (
            <span key={w.path} className="mg-wscard-file" title={w.path}>
              <FileIcon name={baseName(w.path)} size={12} />
              {baseName(w.path)}
            </span>
          ))}
          {wrote.length > FILES_SHOWN && (
            <span className="mg-wscard-more">ほか {wrote.length - FILES_SHOWN}</span>
          )}
        </div>
      )}
      <div className="mg-wscard-foot">
        <span>{comments > 0 ? `未解決のコメント ${comments}` : "未解決のコメントなし"}</span>
        <span className="mg-wscard-go">
          押して移る
          {keys && <kbd className="mg-key">⌘{keys}</kbd>}
        </span>
      </div>
    </div>,
    document.body,
  );
}
