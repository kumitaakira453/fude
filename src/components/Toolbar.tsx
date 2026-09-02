import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { splitInto } from "../lib/ui";
import {
  activeFolderIdAtom,
  canBackAtom,
  canForwardAtom,
  paletteOpenAtom,
  panesAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  tocOpenAtom,
} from "../state/atoms";
import { openTotalAtom, reviewScreenAtom } from "../state/review";
import { Icon } from "./Icon";
import { SettingsButton } from "./SettingsButton";

function IconButton({
  onClick,
  title,
  active,
  disabled,
  icon,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      // 押した瞬間に縮める。押してから画面が変わるまでに間があるとき、
      // 手応えが無いと反応していないように見える。
      className={`grid h-8 w-8 place-items-center rounded-lg transition duration-100 active:scale-90 ${
        disabled
          ? "cursor-not-allowed text-[var(--mg-muted)] opacity-40"
          : active
            ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)] hover:bg-[var(--mg-hover)]"
            : "text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
      }`}
    >
      <Icon name={icon} size={20} fill={active} />
    </button>
  );
}

export function Toolbar() {
  const store = useStore();
  const openTotal = useAtomValue(openTotalAtom);
  const setReviewOpen = useSetAtom(reviewScreenAtom);
  const setActiveFolderId = useSetAtom(activeFolderIdAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [tocOpen, setTocOpen] = useAtom(tocOpenAtom);
  const [, setTab] = useAtom(sidebarTabAtom);
  const [, setPalette] = useAtom(paletteOpenAtom);
  const panes = useAtomValue(panesAtom);
  const canBack = useAtomValue(canBackAtom);
  const canForward = useAtomValue(canForwardAtom);
  const isSplit = panes.length > 1;
  const isLg = useMediaQuery("(min-width: 1024px)");
  // 目次は lg 以上かつ単一ペインのときのみ表示可能
  const canToc = isLg && !isSplit;

  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-[var(--mg-border)] bg-[var(--mg-panel)] px-2">
      <IconButton
        onClick={() => setSidebarOpen((v) => !v)}
        title="サイドバー (⌘B)"
        active={sidebarOpen}
        icon={sidebarOpen ? "left_panel_close" : "left_panel_open"}
      />
      <button
        onClick={() => setActiveFolderId(null)}
        title="スタート画面へ"
        className="mx-1 flex select-none items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-[var(--mg-hover)]"
      >
        <Icon
          name="auto_awesome"
          size={17}
          fill
          className="text-[var(--mg-accent)]"
        />
        <span className="text-[15px] font-bold tracking-tight text-[var(--mg-fg)]">
          mdglow
        </span>
      </button>

      <div className="mx-0.5 h-5 w-px bg-[var(--mg-border)]" />
      <IconButton
        onClick={() => history.back()}
        title="戻る (⌘[)"
        icon="arrow_back"
        disabled={!canBack}
      />
      <IconButton
        onClick={() => history.forward()}
        title="進む (⌘])"
        icon="arrow_forward"
        disabled={!canForward}
      />

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          onClick={() => {
            setSidebarOpen(true);
            setTab("search");
          }}
          title="全文検索 (⌘⇧F)"
          icon="search"
        />
        <IconButton
          onClick={() => setPalette(true)}
          title="クイックオープン (⌘P)"
          icon="bolt"
        />
        <IconButton
          onClick={() => splitInto(store, "row")}
          title="右に分割 (⌘\)"
          active={isSplit}
          icon="vertical_split"
        />
        <IconButton
          onClick={() => splitInto(store, "col")}
          title="下に分割"
          icon="horizontal_split"
        />
        <IconButton
          onClick={() => setTocOpen((v) => !v)}
          title={canToc ? "目次" : "目次（画面幅が狭い / 分割中は非表示）"}
          active={tocOpen && canToc}
          disabled={!canToc}
          icon="toc"
        />
        <div className="mx-1 h-5 w-px bg-[var(--mg-border)]" />
        <button
          onClick={() => setReviewOpen(true)}
          title="レビュー (⌘⇧R)"
          className="relative flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="rate_review" size={18} />
          {openTotal > 0 && (
            <span className="rounded-full bg-[var(--mg-accent-soft)] px-1.5 text-[10.5px] font-medium text-[var(--mg-accent)]">
              {openTotal}
            </span>
          )}
        </button>
        <div className="mx-1 h-5 w-px bg-[var(--mg-border)]" />
        <SettingsButton />
      </div>
    </div>
  );
}
