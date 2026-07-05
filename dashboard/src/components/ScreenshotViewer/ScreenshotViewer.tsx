import { useEffect, useState } from "react";
import type { CropBox } from "../../types/report";
import "./ScreenshotViewer.css";

export function ScreenshotViewer({
  alt,
  cropBox,
  src
}: {
  alt: string;
  cropBox?: CropBox;
  src?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="screenshot-placeholder" role="img" aria-label="Screenshot unavailable">
        <strong>Screenshot unavailable</strong>
        <span>The report did not include a usable image for this finding.</span>
      </div>
    );
  }

  return (
    <figure className="screenshot-viewer">
      <div className="screenshot-frame" tabIndex={0}>
        <img src={src} alt={alt} onError={() => setFailed(true)} />
        {cropBox ? (
          <span
            className="crop-highlight"
            aria-hidden="true"
            style={{
              left: cropBox.x,
              top: cropBox.y,
              width: cropBox.width,
              height: cropBox.height
            }}
          />
        ) : null}
      </div>
      <figcaption>
        {cropBox ? "Crop highlight from scan evidence" : "Full screenshot evidence"}
      </figcaption>
    </figure>
  );
}
