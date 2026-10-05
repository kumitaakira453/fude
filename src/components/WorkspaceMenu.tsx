import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { colorVar, WORKSPACE_COLORS } from "../lib/workspaces";
import { workspaceAtom, workspaceMenuAtom, workspacesAtom } from "../state/atoms";
import { addToBar, barAtom, removeFromBar } from "../state/workspaceBar";
import { ClaudeMark } from "./ClaudeMark";
import { FolderChooser } from "./FolderChooser";
import { Icon } from "./Icon";

// ワークスペースの右押しのメニュー。ツールバーの札・⌘⇧P の行・サイドバー上部の
// どこで右押ししても、このメニューが出る（手入れの入口はここだけ）。
//
// 名前を変える・フォルダを足すは、別の画面を開かずにメニューの中で済ませる。

const EDGE = 8;

export function WorkspaceMenu() {
  const [at, setAt] = useAtom(workspaceMenuAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const [bar, setBar] = useAtom(barAtom);
  const ops = useWorkspaceOps();
  const ime = useImeSafeEnter();
  const [step, setStep] = useState<"menu" | "rename" | "folders">(at?.step ?? "menu");
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const ws =
    at && (current?.id === at.id ? current : (list.find((w) => w.id === at.id) ?? null));
  const close = () => setAt(null);

  useEffect(() => setStep(at?.step ?? "menu"), [at?.id, at?.x, at?.y, at?.step]);

  // 窓の端からはみ出さないよう、測ってから内側へ寄せる。
  useLayoutEffect(() => {
    if (!at || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(at.x, window.innerWidth - EDGE - width)),
      top: Math.max(EDGE, Math.min(at.y, window.innerHeight - EDGE - height)),
    });
  }, [at, step]);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAt(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, setAt]);

  if (!at || !ws) return null;

  const here = ws.id === current?.id;
  const inBar = bar.includes(ws.id);

  const askDelete = async () => {
    close();
    const ok = await confirm(
      `ワークスペース「${ws.name}」を削除しますか？\nフォルダとファイルは削除されません。`,
      { title: "ワークスペースの削除", kind: "warning" },
    );
    if (ok) await ops.deleteWorkspace(ws.id);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[55]"
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div
        ref={box}
        role="menu"
        aria-label={`ワークスペース「${ws.name}」`}
        style={pos}
        className={`mg-ws-menu fixed z-[56] ${step === "folders" ? "w-[440px]" : "w-[232px]"}`}
      >
        {step === "menu" && (
          <>
            <div className="mg-ws-menu-head">
              <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
              <span className="truncate">{ws.name}</span>
            </div>
            <MenuItem icon="edit" label="名前を変更" onClick={() => setStep("rename")} />
            <div className="mg-ws-menu-colors" role="group" aria-label="色">
              {WORKSPACE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-pressed={color === ws.color}
                  onClick={() => {
                    ops.recolorWorkspace(ws.id, color);
                    close();
                  }}
                  className={color === ws.color ? "is-on" : ""}
                >
                  <span
                    className="mg-ws-dot"
                    style={{ background: colorVar(color), color: colorVar(color) }}
                  />
                </button>
              ))}
            </div>
            <MenuItem icon="create_new_folder" label="フォルダを追加…" onClick={() => setStep("folders")} />
            <div className="mg-ws-menu-sep" />
            {!here && (
              <MenuItem
                icon="open_in_new"
                label="新しいウィンドウで開く"
                onClick={() => {
                  close();
                  void ops.openInNewWindow(ws);
                }}
              />
            )}
            <MenuItem
              icon={inBar ? "visibility_off" : "visibility"}
              label={inBar ? "ツールバーから外す" : "ツールバーに表示"}
              onClick={() => {
                setBar((was) => (inBar ? removeFromBar(was, ws.id) : addToBar(was, ws.id)));
                close();
              }}
            />
            {ws.claude && (
              <MenuItem
                icon=""
                mark={<ClaudeMark size={14} />}
                label="Claude のセッションとの連携を解除"
                onClick={() => {
                  ops.unlinkSession(ws.id);
                  close();
                }}
              />
            )}
            {!here && (
              <>
                <div className="mg-ws-menu-sep" />
                <MenuItem icon="delete" label="削除" danger onClick={() => void askDelete()} />
              </>
            )}
          </>
        )}

        {step === "rename" && (
          <div className="p-2">
            <input
              autoFocus
              defaultValue={ws.name}
              aria-label="ワークスペースの名前"
              onFocus={(e) => e.currentTarget.select()}
              onKeyUp={ime.onKeyUp}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(e) => {
                if (ime.isComposing(e)) return;
                if (e.key === "Enter") {
                  ops.renameWorkspace(ws.id, e.currentTarget.value);
                  close();
                }
              }}
              className="mg-ws-menu-input"
            />
          </div>
        )}

        {step === "folders" && (
          <FolderChooser
            mode="add"
            initial={[]}
            hidden={ws.roots}
            pickOther={ops.pickOtherFolder}
            onBack={() => setStep("menu")}
            onDone={(roots) => {
              close();
              void ops.addRoots(roots, ws.id);
            }}
          />
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  mark,
  label,
  danger = false,
  onClick,
}: {
  icon: string;
  mark?: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`mg-ws-menu-item${danger ? " is-danger" : ""}`}
    >
      {mark ?? <Icon name={icon} size={16} />}
      {label}
    </button>
  );
}
