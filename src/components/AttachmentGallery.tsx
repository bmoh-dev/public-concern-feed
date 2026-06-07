import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AttachmentItem = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
};

export function AttachmentGallery({
  attachments,
  emptyText = "لا توجد مرفقات مرفوعة",
}: {
  attachments?: AttachmentItem[];
  emptyText?: string;
}) {
  const items = attachments ?? [];
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">المرفقات</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {items.map((a) => (
          <MediaCard key={a.id} attachment={a} />
        ))}
      </div>
    </div>
  );
}

function MediaCard({ attachment }: { attachment: AttachmentItem }) {
  const url = supabase.storage.from("complaint-attachments").getPublicUrl(attachment.storage_path)
    .data.publicUrl;
  const isImage = attachment.mime_type.startsWith("image/");
  const isVideo = attachment.mime_type.startsWith("video/");
  const [lightbox, setLightbox] = useState(false);

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="relative block overflow-hidden rounded-lg border bg-muted hover:opacity-90 transition"
        >
          <div className="aspect-[4/3]">
            <img src={url} alt={attachment.file_name} className="h-full w-full object-cover" />
          </div>
        </button>
        {lightbox && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
            onClick={() => setLightbox(false)}
          >
            <img
              src={url}
              alt={attachment.file_name}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>
        )}
      </>
    );
  }

  if (isVideo) {
    return (
      <div className="relative overflow-hidden rounded-lg border bg-muted">
        <div className="aspect-[4/3]">
          <VideoPlayer url={url} />
        </div>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted p-2 text-center text-xs"
    >
      {attachment.file_name}
    </a>
  );
}

function VideoPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<string>("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMeta = () => {
      const d = el.duration;
      if (!isFinite(d) || d < 0) return;
      const m = Math.floor(d / 60);
      const s = Math.floor(d % 60)
        .toString()
        .padStart(2, "0");
      setDuration(`${m}:${s}`);
    };
    if (el.readyState >= 1) onMeta();
    else el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [url]);

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        src={url}
        controls
        className="h-full w-full object-cover"
        preload="metadata"
      />
      {duration && (
        <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {duration}
        </div>
      )}
    </div>
  );
}
