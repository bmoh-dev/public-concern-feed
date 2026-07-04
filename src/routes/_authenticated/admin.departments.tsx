import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listDepartmentsWithStats,
  createDepartment,
  renameDepartment,
  setDepartmentActive,
  deleteDepartment,
} from "@/lib/departments.functions";
import { getMyRole } from "@/lib/notifications.functions";
import { requireAdminRoute } from "@/lib/admin-route-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Plus, Pencil, Power, Trash2 } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/departments")({
  beforeLoad: ({ location }) => requireAdminRoute(location),
  head: () => ({ meta: [{ title: "إدارة الأقسام | لوحة الإدارة" }] }),
  component: AdminDepartmentsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">
      {error.message.includes("ليس لديك")
        ? "ليس لديك صلاحية إدارة هذه البلدية"
        : `خطأ: ${error.message}`}
    </div>
  ),
});

// Departments map 1:1 to platform complaint categories. Each slug is a
// category enum value; the label comes from CATEGORY_LABELS.
const AVAILABLE_SLUGS: { slug: string; label: string }[] = CATEGORIES.map((c) => ({
  slug: c,
  label: CATEGORY_LABELS[c] ?? c,
}));

type Row = {
  id: string;
  slug: string;
  name_ar: string;
  is_active: boolean;
  admin_count: number;
  complaint_count: number;
};

function AdminDepartmentsPage() {
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const listFn = useServerFn(listDepartmentsWithStats);
  const createFn = useServerFn(createDepartment);
  const renameFn = useServerFn(renameDepartment);
  const toggleFn = useServerFn(setDepartmentActive);
  const deleteFn = useServerFn(deleteDepartment);

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const myMuni = (role?.municipalities ?? []).find(
    (m: any) => m.role === "super_admin",
  );

  const municipalityId = myMuni?.id ?? "";

  const { data: rows, isLoading } = useQuery({
    queryKey: ["muni-departments-stats", municipalityId],
    enabled: !!municipalityId,
    queryFn: () => listFn({ data: { municipality_id: municipalityId } }) as Promise<Row[]>,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const [renameRow, setRenameRow] = useState<Row | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const usedSlugs = useMemo(
    () => new Set((rows ?? []).map((r) => r.slug)),
    [rows],
  );
  const remainingSlugs = AVAILABLE_SLUGS.filter((s) => !usedSlugs.has(s.slug));

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["muni-departments-stats", municipalityId] });

  if (!role) {
    return <div className="p-6 text-sm text-muted-foreground">جارٍ التحميل...</div>;
  }
  if (!myMuni) {
    return (
      <div className="p-6 text-destructive">
        هذه الصفحة متاحة للمسؤول العام للبلدية فقط.
      </div>
    );
  }

  const onCreate = async () => {
    if (!newSlug || !newName.trim()) {
      toast.error("يرجى اختيار الفئة وإدخال الاسم");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: { municipality_id: municipalityId, slug: newSlug, name_ar: newName.trim() },
      });
      toast.success("تم إنشاء القسم");
      setCreateOpen(false);
      setNewSlug("");
      setNewName("");
      await invalidate();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر إنشاء القسم");
    } finally {
      setBusy(false);
    }
  };

  const onRename = async () => {
    if (!renameRow || !renameValue.trim()) return;
    setBusy(true);
    try {
      await renameFn({
        data: { department_id: renameRow.id, name_ar: renameValue.trim() },
      });
      toast.success("تم تحديث الاسم");
      setRenameRow(null);
      await invalidate();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر التحديث");
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (r: Row) => {
    try {
      await toggleFn({ data: { department_id: r.id, is_active: !r.is_active } });
      toast.success(r.is_active ? "تم تعطيل القسم" : "تم تفعيل القسم");
      await invalidate();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر التحديث");
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteFn({ data: { department_id: confirmDelete.id } });
      toast.success("تم حذف القسم");
      setConfirmDelete(null);
      await invalidate();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر الحذف");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">إدارة الأقسام</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            بلدية <strong>{myMuni.name}</strong> — {myMuni.wilaya}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/admin">رجوع للوحة الإدارة</Link>
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={remainingSlugs.length === 0}
          >
            <Plus className="ml-1 h-4 w-4" /> إنشاء قسم
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            لا توجد أقسام بعد. ابدأ بإنشاء قسم لاستقبال الشكاوى.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم القسم</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>عدد المسؤولين</TableHead>
                <TableHead>عدد الشكاوى</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name_ar}</div>
                    <div className="text-xs text-muted-foreground">{r.slug}</div>
                  </TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge>مُفعّل</Badge>
                    ) : (
                      <Badge variant="secondary">مُعطّل</Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.admin_count}</TableCell>
                  <TableCell>{r.complaint_count}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRenameRow(r);
                          setRenameValue(r.name_ar);
                        }}
                      >
                        <Pencil className="ml-1 h-3.5 w-3.5" /> تعديل الاسم
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onToggle(r)}>
                        <Power className="ml-1 h-3.5 w-3.5" />
                        {r.is_active ? "تعطيل" : "تفعيل"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmDelete(r)}
                      >
                        <Trash2 className="ml-1 h-3.5 w-3.5" /> حذف
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        تعطيل القسم يمنع ظهوره في نموذج الشكاوى دون التأثير على الشكاوى الحالية.
        حذف القسم يُلغي إسناد شكاواه (تبقى الشكاوى محفوظة) ويُعيد مسؤوليه إلى وضع مواطن.
      </p>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء قسم جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الفئة</Label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              >
                <option value="">— اختر —</option>
                {remainingSlugs.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                لكل قسم فئة واحدة من فئات الشكاوى المعتمدة.
              </p>
            </div>
            <div>
              <Label htmlFor="new-name">اسم القسم</Label>
              <Input
                id="new-name"
                value={newName}
                maxLength={120}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: قسم البنية التحتية"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              إلغاء
            </Button>
            <Button onClick={onCreate} disabled={busy}>
              {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameRow} onOpenChange={(o) => !o && setRenameRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل اسم القسم</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="rename">الاسم</Label>
            <Input
              id="rename"
              value={renameValue}
              maxLength={120}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameRow(null)} disabled={busy}>
              إلغاء
            </Button>
            <Button onClick={onRename} disabled={busy}>
              {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف القسم؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف قسم <strong>{confirmDelete?.name_ar}</strong>. ستبقى الشكاوى
              المرتبطة محفوظة ولكن دون قسم مُسنَد، وسيتم إعادة مسؤولي القسم إلى وضع مواطن.
              لا يمكن التراجع عن هذه العملية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={busy}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
