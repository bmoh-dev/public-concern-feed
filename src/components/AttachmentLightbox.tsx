import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export type LightboxItem = {
  id?: string;
  storage_path?: string;
  file_name: string;
  mime_type: string;
  signed_url?: string | null;
};

/**
 * Renders a grid of attachment thumbnails. Clicking an image opens an
 * in-page lightbox with prev/next/close/ESC support. Videos and other
 * file types remain inline and do not open the lightbox.
 */
export function AttachmentGroup({
  attachments,
  className,
  thumbClassName = "h-24 w-full object-cover",
}: {
  attachments: LightboxItem[];
  className?: string;
  thumbClassName?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const images = attachments
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.mime_type.startsWith("image/"));
  const imagePositions = images.map((x) => x.i);

  const goPrev = useCallback(() => {
    setOpenIndex((cur) => {
      if (cur === null) return cur;
      const idx = imagePositions.indexOf(cur);
      if (idx <= 0) return cur;
      return imagePositions[idx - 1];
    });
  }, [imagePositions]);

  const goNext = useCallback(() => {
    setOpenIndex((cur) => {
      if (cur === null) return cur;
      const idx = imagePositions.indexOf(cur);
      if (idx < 0 || idx >= imagePositions.length - 1) return cur;
      return imagePositions[idx + 1];
    });
  }, [imagePositions]);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex, goPrev, goNext]);

  const current = openIndex !== null ? attachments[openIndex] : null;
  const idxInImages = openIndex !== null ? imagePositions.indexOf(openIndex) : -1;
  const hasPrev = idxInImages > 0;
  const hasNext = idxInImages >= 0 && idxInImages < imagePositions.length - 1;

  return (
    <>
      <div className={className}>
        {attachments.map((a, i) => {
          const url = a.signed_url ?? "";
          const isImage = a.mime_type.startsWith("image/");
          const isVideo = a.mime_type.startsWith("video/");
          if (isImage) {
            return (
              <button
                key={a.id ?? a.storage_path ?? i}
                type="button"
                onClick={() => setOpenIndex(i)}
                className="block overflow-hidden rounded border bg-muted hover:opacity-90 transition"
                aria-label={a.file_name}
              >
                <img src={url} alt={a.file_name} className={thumbClassName} />
              </button>
            );
          }
          if (isVideo) {
            return (
              <div
                key={a.id ?? a.storage_path ?? i}
                className="overflow-hidden rounded border bg-muted"
              >
                <video src={url} controls className={thumbClassName} preload="metadata" />
              </div>
            );
          }
          return (
            <a
              key={a.id ?? a.storage_path ?? i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center rounded border bg-muted p-2 text-center text-xs"
            >
              {a.file_name}
            </a>
          );
        })}
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            aria-label="إغلاق"
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex(null);
            }}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {hasPrev && (
            <button
              type="button"
              aria-label="السابق"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              aria-label="التالي"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute right-16 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
          <img
            src={current.signed_url ?? ""}
            alt={current.file_name}
            className="max-h-full max-w-full rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
