import { ZOOM_STEP, type ZoomView } from "../hooks/useZoomView";
import { Icon } from "./Icon";

// 足元の帯に並べる、倍率の釦（縮小・倍率・拡大・枠に合わせる・原寸）。
export function ZoomControls({ zoom }: { zoom: ZoomView }) {
  const { shown, view } = zoom;
  return (
    <>
      <button
        type="button"
        className="mg-small"
        onClick={() => zoom.zoomTo(shown.scale / ZOOM_STEP)}
      >
        <Icon name="zoom_out" size={15} />
      </button>
      <span className="mg-imgdoc-scale">{Math.round(shown.scale * 100)}%</span>
      <button
        type="button"
        className="mg-small"
        onClick={() => zoom.zoomTo(shown.scale * ZOOM_STEP)}
      >
        <Icon name="zoom_in" size={15} />
      </button>
      <button
        type="button"
        className={`mg-small${view === null ? " is-on" : ""}`}
        onClick={zoom.fit}
      >
        枠に合わせる
      </button>
      <button type="button" className="mg-small" onClick={zoom.actual}>
        原寸
      </button>
    </>
  );
}
