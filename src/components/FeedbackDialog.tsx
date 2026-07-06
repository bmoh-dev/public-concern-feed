import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { submitFeedback } from "@/lib/feedback.functions";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  validateSingleFile,
} from "@/lib/upload-validation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { X, Upload } from "lucide-react";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function FeedbackDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const submitFn = useServerFn(submitFeedback);
  const [type, setType] = useState<"bug" | "suggestion">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setType("bug");
      setTitle("");
      setDescription("");
      setFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setUploading(false);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickFile = (f: File | null) => {
    if (!f) {
      if (preview) URL.revokeObjectURL(preview);
      setFile(null);
      setPreview(null);
      return;
    }
    const err = validateSingleFile({
      mime_type: f.type,
      size_bytes: f.size,
      file_name: f.name,
    });
    if (err) {
      toast.error(err);
      return;
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(f.type)) {
      toast.error("يجب أن تكون لقطة الشاشة صورة");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("العنوان والوصف مطلوبان");
      return;
    }
    setSubmitting(true);
    try {
      let screenshot_path: string | null = null;
      if (file) {
        setUploading(true);
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) {
          toast.error("يجب تسجيل الدخول");
          setSubmitting(false);
          setUploading(false);
          return;
        }
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${uid}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("feedback-screenshots")
          .upload(path, file, { contentType: file.type, upsert: false });
        setUploading(false);
        if (upErr) {
          toast.error("تعذّر رفع الصورة");
          setSubmitting(false);
          return;
        }
        screenshot_path = path;
      }

      const page =
        typeof window !== "undefined"
          ? router.state.location.pathname + (router.state.location.searchStr ?? "")
          : null;

      const result = await submitFn({
        data: {
          type,
          title: title.trim(),
          description: description.trim(),
          page,
          screenshot_path,
        },
      });
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        setSubmitting(false);
        return;
      }
      toast.success("شكراً لك. تم استلام ملاحظتك وسيتم مراجعتها.");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر إرسال الملاحظة");
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إرسال ملاحظات</DialogTitle>
          <DialogDescription>
            ساعدنا في تحسين المنصّة بالإبلاغ عن المشاكل أو اقتراح التحسينات.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>نوع الملاحظة</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as "bug" | "suggestion")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="bug" id="fb-type-bug" />
                <Label htmlFor="fb-type-bug" className="cursor-pointer">
                  🐞 الإبلاغ عن مشكلة
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="suggestion" id="fb-type-sug" />
                <Label htmlFor="fb-type-sug" className="cursor-pointer">
                  💡 اقتراح تحسين
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-title">العنوان</Label>
            <Input
              id="fb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="ملخّص قصير"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-desc">الوصف</Label>
            <Textarea
              id="fb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="اشرح المشكلة أو الاقتراح بتفصيل مفيد"
            />
          </div>

          <div className="space-y-2">
            <Label>لقطة شاشة (اختياري)</Label>
            {!file ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50">
                <Upload className="h-4 w-4" />
                <span>اختر صورة (بحد أقصى {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB)</span>
                <input
                  type="file"
                  accept={ALLOWED_IMAGE_MIME.join(",")}
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <div className="relative w-fit">
                <img
                  src={preview ?? undefined}
                  alt=""
                  className="max-h-40 rounded-md border object-cover"
                />
                <button
                  type="button"
                  className="absolute -top-2 -end-2 rounded-full bg-destructive p-1 text-destructive-foreground"
                  onClick={() => pickFile(null)}
                  aria-label="حذف الصورة"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {uploading ? "جارٍ رفع الصورة..." : submitting ? "جارٍ الإرسال..." : "إرسال"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
