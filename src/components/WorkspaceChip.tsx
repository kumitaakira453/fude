import { useAtomValue } from "jotai";
import { initialOf } from "../lib/railGroups";
import { colorVar, type Workspace } from "../lib/workspaces";
import { phaseForAtom } from "../state/claude";
import { StatusMark } from "./StatusMark";

// ワークスペースの札（色の地に頭文字、右上に Claude のセッションの状態の印）。
// 左端の帯と同じ顔を、一覧（⌘J・⌃Tab）や手入れのメニューでも使う。
export function WorkspaceChip({ ws, size = 20 }: { ws: Workspace; size?: number }) {
  const phase = useAtomValue(phaseForAtom)(ws);
  return (
    <span
      className="mg-ws-chip"
      style={{ background: colorVar(ws.color), width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {initialOf(ws.name)}
      <StatusMark phase={phase} />
    </span>
  );
}
