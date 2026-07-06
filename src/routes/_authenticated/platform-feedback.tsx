import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/notifications.functions";
import {
  listAllFeedback,
  getFeedbackDetail,
  updateFeedbackStatus,
  updateFeedbackAdminNotes,
  deleteFeedback,
} from "@/lib/feedback.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Bug, Lightbulb, ExternalLink, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/platform-feedback")({
  head: () => ({ meta: [{ title: "ملاحظات المستخدمين" }] }),
  beforeLoad: async () => {
    try {
      const role = await getMyRole();
      if (!role.isGlobalAdmin) throw redirect({ to: "/my-complaints" });
    } catch (e: any) {
      if (e?.isRedirect) throw e;
      throw redirect({ to: "/my-complaints" });
    }
  },
  component: PlatformFeedbackPage,
});

type StatusFilter = "all" | "open" | "fixed";
type TypeFilter = "all" | "bug" | "suggestion";

function typeBadge(t: string) {
  if (t === "bug")
    return (
      <Badge variant="destructive" className="gap-1">
        <Bug className="h-3 w-3" /> مشكلة
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Lightbulb className="h-3 w-3" /> اقتراح
    </Badge>
  );
}

function statusBadge(s: string) {
  return s === "fixed" ? (
    <Badge>تم الحل</Badge>
  ) : (
    <Badge variant="outline">مفتوحة</Badge>
  );
}

function PlatformFeedbackPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllFeedback);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const deleteFn = useServerFn(deleteFeedback);

  const { data, isLoading } = useQuery({
    queryKey: ["platform-feedback", status, type, q],
    queryFn: () => listFn({ data: { status, type, q, limit: 100, offset: 0 } }),
  });

  const rows = data?.rows ?? [];

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteFn({ data: { id: confirmDelete } });
      toast.success("تم الحذف");
      setConfirmDelete(null);
      if (openId === confirmDelete) setOpenId(null);
      qc.invalidateQueries({ queryKey: ["platform-feedback"] });
    } catch (e: any) {
      toast.error(e?.message || "تعذّر الحذف");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ملاحظات المستخدمين</h1>
        <p className="text-sm text-muted-foreground">
          مراجعة بلاغات المشاكل والاقتراحات المرسلة من المستخدمين.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">الحالة</label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="open">مفتوحة</SelectItem>
              <SelectItem value="fixed">تم الحل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">النوع</label>
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="bug">🐞 مشاكل</SelectItem>
              <SelectItem value="suggestion">💡 اقتراحات</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[220px] space-y-1">
          <label className="text-xs text-muted-foreground">
            بحث (العنوان / الوصف / بريد المُبلّغ)
          </label>
          <div className="flex gap-2">
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setQ(qInput.trim());
              }}
              placeholder="بحث..."
            />
            <Button variant="secondary" onClick={() => setQ(qInput.trim())}>
              بحث
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">لا توجد ملاحظات.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead>العنوان</TableHead>
                <TableHead>المُبلّغ</TableHead>
                <TableHead>الصفحة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{typeBadge(r.type)}</TableCell>
                  <TableCell className="font-medium max-w-[280px] truncate">{r.title}</TableCell>
                  <TableCell className="text-xs">
                    <div>{r.reporter_name || "—"}</div>
                    <div className="text-muted-foreground">{r.reporter_email || "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {r.page || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("ar")}
                  </TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenId(r.id)}
                      >
                        <ExternalLink className="ms-1 h-3 w-3" /> عرض
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(r.id)}
                      >
                        <Trash2 className="ms-1 h-3 w-3" /> حذف
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <FeedbackDetailDialog
        id={openId}
        onClose={() => setOpenId(null)}
        onDelete={(id) => setConfirmDelete(id)}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملاحظة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف هذه الملاحظة نهائياً. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FeedbackDetailDialog({
  id,
  onClose,
  onDelete,
}: {
  id: string | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getFeedbackDetail);
  const statusFn = useServerFn(updateFeedbackStatus);
  const notesFn = useServerFn(updateFeedbackAdminNotes);

  const { data, isLoading } = useQuery({
    queryKey: ["platform-feedback-detail", id],
    queryFn: () => detailFn({ data: { id: id! } }),
    enabled: !!id,
  });

  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"open" | "fixed">("open");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (data) {
      setNotes((data as any).admin_notes ?? "");
      setStatus(((data as any).status ?? "open") as "open" | "fixed");
    }
  }, [data]);

  const save = async () => {
    if (!id || !data) return;
    setSaving(true);
    try {
      const d: any = data;
      if (status !== d.status) await statusFn({ data: { id, status } });
      const oldNotes = d.admin_notes ?? "";
      const newNotes = notes.trim() === "" ? null : notes;
      if ((oldNotes ?? "") !== (newNotes ?? "")) {
        await notesFn({ data: { id, admin_notes: newNotes } });
      }
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["platform-feedback"] });
      qc.invalidateQueries({ queryKey: ["platform-feedback-detail", id] });
    } catch (e: any) {
      toast.error(e?.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>تفاصيل الملاحظة</DialogTitle>
          <DialogDescription>مراجعة وتحديث حالة الملاحظة وإضافة ملاحظات داخلية.</DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {typeBadge((data as any).type)}
              {statusBadge((data as any).status)}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">العنوان</div>
              <div className="font-medium">{(data as any).title}</div>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <div className="text-muted-foreground">المُبلّغ</div>
                <div>{(data as any).reporter_name || "—"}</div>
                <div className="text-muted-foreground">
                  {(data as any).reporter_email || "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">تاريخ الإرسال</div>
                <div>{new Date((data as any).created_at).toLocaleString("ar")}</div>
                <div className="text-muted-foreground mt-2">الصفحة</div>
                <div className="break-all">{(data as any).page || "—"}</div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">الوصف</div>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {(data as any).description}
              </div>
            </div>
            {(data as any).signed_url && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">لقطة الشاشة</div>
                <a
                  href={(data as any).signed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block"
                >
                  <img
                    src={(data as any).signed_url}
                    alt=""
                    className="max-h-64 rounded-md border object-contain"
                  />
                </a>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">الحالة</label>
                <Select value={status} onValueChange={(v) => setStatus(v as "open" | "fixed")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">مفتوحة</SelectItem>
                    <SelectItem value="fixed">تم الحل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">ملاحظات داخلية (خاصة بالمسؤولين)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="ملاحظات داخلية..."
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="destructive"
            onClick={() => id && onDelete(id)}
            disabled={!id || saving}
          >
            حذف
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إغلاق
          </Button>
          <Button onClick={save} disabled={saving || !data}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
