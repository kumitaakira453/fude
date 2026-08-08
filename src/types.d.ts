// FileSystemObserver は TS の lib.dom にまだ含まれないため最小限を宣言する。
// 参照: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver

interface FileSystemObserverRecord {
  readonly changedHandle: FileSystemHandle;
  readonly relativePathComponents: ReadonlyArray<string>;
  readonly relativePathMovedFrom: ReadonlyArray<string> | null;
  readonly root: FileSystemHandle;
  readonly type: "appeared" | "disappeared" | "modified" | "moved" | "errored" | "unknown";
}

type FileSystemObserverCallback = (
  records: FileSystemObserverRecord[],
  observer: FileSystemObserver,
) => void;

interface FileSystemObserverObserveOptions {
  recursive?: boolean;
}

declare class FileSystemObserver {
  constructor(callback: FileSystemObserverCallback);
  observe(handle: FileSystemHandle, options?: FileSystemObserverObserveOptions): Promise<void>;
  unobserve(handle: FileSystemHandle): void;
  disconnect(): void;
}

interface Window {
  FileSystemObserver?: typeof FileSystemObserver;
}
