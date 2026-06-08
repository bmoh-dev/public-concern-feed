import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { submitComplaint } from "@/lib/complaints.functions";
import { getMyOnboardingState } from "@/lib/municipalities.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { CATEGORY_LABELS, CATEGORIES } from "@/lib/i18n";
import { toast } from "sonner";
import { X, Upload, MapPin } from "lucide-react";
import { MapPicker } from "@/components/MapPicker";

export const Route = createFileRoute("/_authenticated/submit")({
  head: () => ({ meta: [{ title: "شكوى جديدة | منصة الشكاوى" }] }),
  component: SubmitPage,
});

const MAX_FILES = 5;
const MAX_SIZE = 8 * 1024 * 1024;

type UploadItem = {
  file: File;
  preview?: string;
  progress: number;
  storage_path?: string;
  error?: string;
};

function SubmitPage() {
  const navigate = useNavigate();
  const submitFn = useServerFn(submitComplaint);
  const stateFn = useServerFn(getMyOnboardingState);
  const { data: state, isLoading: stateLoading } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => stateFn(),
  });
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("infrastructure");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>("");

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_FILES - uploads.length;
    const arr = Array.from(files).slice(0, remaining);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    for (const file of arr) {
      if (file.size > MAX_SIZE) {
        toast.error(`الملف ${file.name} يتجاوز 8MB`);
        continue;
      }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const item: UploadItem = { file, preview, progress: 0 };
      setUploads((prev) => [...prev, item]);

      const path = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
      const { error } = await supabase.storage
        .from("complaint-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      setUploads((prev) =>
        prev.map((it) =>
          it.file === file
            ? error
              ? { ...it, error: error.message, progress: 0 }
              : { ...it, storage_path: path, progress: 100 }
            : it,
        ),
      );
    }
  };

  const removeUpload = (file: File) => {
    setUploads((prev) => prev.filter((it) => it.file !== file));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !address.trim() || !description.trim()) {
      toast.error("يرجى تعبئة جميع الحقول");
      return;
    }
    setSubmitting(true);
    try {
      const attachments = uploads
        .filter((it) => it.storage_path)
        .map((it) => ({
          storage_path: it.storage_path!,
          file_name: it.file.name,
          mime_type: it.file.type || "application/octet-stream",
          size_bytes: it.file.size,
        }));
      const result = await submitFn({
        data: {
          title: title.trim(),
          category: category as any,
          address: address.trim(),
          description: description.trim(),
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          attachments,
        },
      });
      console.log("[submitComplaint] success", result);
      toast.success("تم استلام شكواك بنجاح");
      navigate({ to: "/my-complaints" });
    } catch (e: any) {
      console.error("[submitComplaint] failed", e);
      const msg =
        e?.message ||
        e?.error?.message ||
        (typeof e === "string" ? e : null) ||
        "تعذّر إرسال الشكوى. حاول مجدداً.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">تقديم شكوى جديدة</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        سيتم استخدام اسم وبريد حساب Google الموثّق تلقائياً.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <Label htmlFor="title">عنوان الشكوى *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="مثال: تسرب مياه كبير في الشارع الرئيسي"
            required
          />
        </div>

        <div>
          <Label>الفئة *</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="address">العنوان التفصيلي *</Label>
          <Input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={500}
            placeholder="الحي، الشارع، علامة مميزة"
            required
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowMap((s) => !s)}>
              <MapPin className="ms-1 h-4 w-4" />
              {showMap
                ? "إخفاء الخريطة"
                : coords
                  ? "تعديل الموقع على الخريطة"
                  : "📍 تحديد على الخريطة (اختياري)"}
            </Button>
            {coords && !showMap && (
              <span className="text-xs text-muted-foreground">
                تم تحديد موقع: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
              </span>
            )}
          </div>
          {showMap && (
            <div className="mt-3">
              <MapPicker value={coords} onChange={setCoords} />
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="desc">وصف الشكوى *</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={5000}
            required
          />
        </div>

        <div>
          <Label>المرفقات (حتى {MAX_FILES} ملفات، 8MB لكل ملف)</Label>
          <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground hover:bg-muted/60">
            <Upload className="h-4 w-4" />
            انقر لاختيار صور أو فيديوهات
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {uploads.length > 0 && (
            <ul className="mt-3 space-y-2">
              {uploads.map((it) => (
                <li
                  key={it.file.name + it.file.lastModified}
                  className="flex items-center gap-3 rounded-lg border p-2"
                >
                  {it.preview ? (
                    <img src={it.preview} alt="" className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted text-xs">
                      {it.file.type.split("/")[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.file.name}</div>
                    <Progress value={it.progress} className="mt-1 h-1.5" />
                    {it.error && <div className="text-xs text-destructive">{it.error}</div>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeUpload(it.file)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? "جارٍ الإرسال..." : "إرسال الشكوى"}
        </Button>
      </form>
    </div>
  );
}
