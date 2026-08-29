// ドラッグ&ドロップで受け渡す内容。
//
// 運ぶ先は 3 つある。ファイルツリー → ペイン（開く）、タブ → ペイン（移す）、
// ファイルツリー → ディレクトリ行（ファイルを移動する）。
// パスだけだとタブを掴んだのかツリーから掴んだのか区別できないので、
// タブのときだけ掴んだ位置を添える。

export const DND_MIME = "application/x-mdglow-path";

export interface DragPayload {
  path: string;
  from?: { paneId: string; index: number }; // タブを掴んだときだけ付く
}

export function setDragPayload(data: DataTransfer, payload: DragPayload): void {
  data.setData(DND_MIME, JSON.stringify(payload));
}

export function readDragPayload(data: DataTransfer): DragPayload | null {
  const raw = data.getData(DND_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path) return null;
    const from = record.from as Record<string, unknown> | undefined;
    if (from && typeof from.paneId === "string" && typeof from.index === "number") {
      return { path: record.path, from: { paneId: from.paneId, index: from.index } };
    }
    return { path: record.path };
  } catch {
    return null;
  }
}
