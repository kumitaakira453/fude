import { getVersion } from "@tauri-apps/api/app";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useOptimisticSetting } from "../hooks/useOptimisticSetting";
import { FONTS } from "../lib/fonts";
import { THEMES } from "../lib/themes";
import {
  editorialAtom,
  fontAtom,
  readingWidthAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { Icon } from "./Icon";

export function ThemeSwitcher() {
  const [themeValue, setThemeValue] = useAtom(themeAtom);
  const [fontValue, setFontValue] = useAtom(fontAtom);
  const [widthValue, setWidthValue] = useAtom(readingWidthAtom);
  const [editorialValue, setEditorialValue] = useAtom(editorialAtom);
  // 押した瞬間に選択状態を切り替える（反映に伴う再描画を待たせない）
  const [theme, setTheme] = useOptimisticSetting(themeValue, setThemeValue);
  const [font, setFont] = useOptimisticSetting(fontValue, setFontValue);
  const [width, setWidth] = useOptimisticSetting(widthValue, setWidthValue);
  const [editorial, setEditorial] = useOptimisticSetting(
    editorialValue,
    setEditorialValue,
  );
  const setUpdateNonce = useSetAtom(updateCheckNonceAtom);
  const updateStatus = useAtomValue(updateStatusAtom);
  const [version, setVersion] = useState("");
  // メニューから「更新を確認」を押したか。起動時の自動チェック結果は出さず、
  // 押したときだけ結果（確認中/最新/更新あり）を表示する。
  const [manualChecked, setManualChecked] = useState(false);
  const isTauri = "__TAURI_INTERNALS__" in window;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return;
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, [isTauri]);

  // パネルを閉じたら手動チェック表示をリセット（次回開いた時はバージョン表示）
  useEffect(() => {
    if (!open) setManualChecked(false);
  }, [open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="表示設定"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[var(--mg-hover)]"
      >
        <Icon name="palette" size={19} className="text-[var(--mg-accent)]" />
        <span className="hidden text-[13px] text-[var(--mg-fg-dim)] sm:inline">
          {current.label}
        </span>
        <Icon name="expand_more" size={16} className="text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-2 shadow-2xl">
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            テーマ
          </div>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto pr-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition ${
                  t.id === theme
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                <span className="shrink-0">{t.emoji}</span>
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-[var(--mg-border)]" />
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            書体
          </div>
          <div className="grid grid-cols-2 gap-1">
            {FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFont(f.id)}
                style={{ fontFamily: f.stack }}
                className={`rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                  f.id === font
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-[var(--mg-border)]" />
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            本文幅
          </div>
          <div className="flex gap-1">
            {(
              [
                ["cozy", "標準"],
                ["wide", "広め"],
                ["full", "最大"],
              ] as const
            ).map(([w, label]) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={`flex-1 rounded-lg px-2 py-1 text-[13px] transition ${
                  w === width
                    ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                    : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-[var(--mg-border)]" />
          <button
            onClick={() => setEditorial(!editorial)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
          >
            <Icon
              name="auto_awesome"
              size={17}
              fill={editorial}
              className={
                editorial ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"
              }
            />
            <span className="flex-1 text-[13px] text-[var(--mg-fg-dim)]">
              エディトリアル組版
            </span>
            <span className="rounded bg-[var(--mg-accent-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--mg-accent)]">
              Beta
            </span>
            <span
              className={`relative h-4 w-7 shrink-0 rounded-full transition ${
                editorial ? "bg-[var(--mg-accent)]" : "bg-[var(--mg-border)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                  editorial ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
          </button>

          {isTauri && (
            <>
              <div className="my-2 h-px bg-[var(--mg-border)]" />
              <button
                onClick={() => {
                  setManualChecked(true);
                  setUpdateNonce((n) => n + 1);
                }}
                disabled={updateStatus === "checking"}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)] disabled:opacity-60"
              >
                <Icon
                  name="system_update_alt"
                  size={17}
                  className="text-[var(--mg-muted)]"
                />
                <span className="flex-1 text-[13px] text-[var(--mg-fg-dim)]">
                  更新を確認
                </span>
                <span className="text-[11px] text-[var(--mg-muted)]">
                  {/* 押す前は現在バージョン、押したら結果を表示 */}
                  {!manualChecked
                    ? version
                      ? `v${version}`
                      : ""
                    : updateStatus === "checking"
                      ? "確認中…"
                      : updateStatus === "uptodate"
                        ? "最新です"
                        : updateStatus === "available"
                          ? "更新あり"
                          : updateStatus === "error"
                            ? "確認できず"
                            : version
                              ? `v${version}`
                              : ""}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
