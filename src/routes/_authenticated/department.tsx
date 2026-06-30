import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/notifications.functions";
import { AttachmentGallery } from "@/components/AttachmentGallery";
import {
  listDepartmentComplaints,
  departmentUpdateComplaint,
  redirectComplaint,
  listDepartments,
  getMyDepartment,
  listRoutingHistory,
} from "@/lib/departments.functions";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE, STATUSES } from "@/lib/i18n";
import { Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/department")({
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login", search: { redirect: location.href } });
    const role = await getMyRole();
    if (!role.isDepartmentAdmin && !role.isAdmin) {
      throw new Error("Access denied: department admin only");
    }
  },
  head: () => ({ meta: [{ title: "لوحة القسم | منصة الشكاوى" }] }),
  component: DepartmentPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">
      {error.message.includes("department admin") || error.message.includes("Access denied")
        ? "غير مصرح: هذه الصفحة لمسؤولي الأقسام فقط"
        : `خطأ: ${error.message}`}
    </div>
  ),
});

function DepartmentPage() {
  const listFn = useServerFn(listDepartmentComplaints);
  const myDeptFn = useServerFn(getMyDepartment);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search: search || null, status: status === "all" ? null : (status as any) }),
    [search, status],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dept-complaints", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const { data: myDept } = useQuery({ queryKey: ["my-dept"], queryFn: () => myDeptFn() });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">لوحة القسم</h1>
          <p className="text-sm text-muted-foreground">
            {myDept ? `قسم: ${myDept.name_ar}` : "الإدارة العامة"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pr-9"
            placeholder="ابحث بالعنوان أو الوصف أو رقم الشكوى"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-right">
            <tr>
              <th className="p-3">رقم الشكوى</th>
              <th className="p-3">العنوان</th>
              <th className="p-3">الفئة</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  جارٍ التحميل...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  لا توجد شكاوى في قسمك.
                </td>
              </tr>
            ) : (
              rows.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 text-xs font-mono">{r.complaint_number}</td>
                  <td className="p-3">
                    <button onClick={() => setOpenId(r.id)} className="font-medium hover:underline">
                      {r.title}
                    </button>
                  </td>
                  <td className="p-3">
                    <Badge variant="secondary">{CATEGORY_LABELS[r.category]}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={STATUS_BADGE[r.status]}>
                      {STATUS_LABELS[r.status]}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("ar")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DeptDetail
        id={openId}
        row={rows.find((r: any) => r.id === openId)}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function DeptDetail({ id, row, onClose }: { id: string | null; row: any; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(departmentUpdateComplaint);
  const [status, setStatus] = useState<string>(row?.status ?? "pending");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (row) {
      setStatus(row.status);
    }
  }, [row]);

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateFn({ data: { id, status: status as any } });
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["dept-complaints"] });
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>تفاصيل الشكوى</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-3">
            <h3 className="text-lg font-bold">{row.title}</h3>
            <p>
              <strong>الفئة:</strong> {CATEGORY_LABELS[row.category]}
            </p>
            <p>
              <strong>العنوان:</strong> {row.address}
            </p>
            <p className="whitespace-pre-wrap">
              <strong>الوصف:</strong> {row.description}
            </p>
            <AttachmentGallery attachments={row.attachments} />

            <div>
              <label className="text-sm font-medium">الحالة</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات داخلية</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </Button>

            <RedirectSection
              complaintId={id!}
              currentDeptId={row.assigned_department_id}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["dept-complaints"] });
                onClose();
              }}
            />
            <RoutingHistoryList complaintId={id!} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RedirectSection({
  complaintId,
  currentDeptId,
  onDone,
}: {
  complaintId: string;
  currentDeptId: string | null;
  onDone: () => void;
}) {
  const listDeptsFn = useServerFn(listDepartments);
  const redirectFn = useServerFn(redirectComplaint);
  const { data: depts = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => listDeptsFn(),
  });
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) {
      toast.error("اختر القسم المستهدف");
      return;
    }
    setBusy(true);
    try {
      await redirectFn({
        data: { complaint_id: complaintId, to_department_id: target, reason: reason || undefined },
      });
      toast.success("تمت إحالة الشكوى");
      setTarget("");
      setReason("");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="font-semibold text-sm">إحالة الشكوى</div>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger>
          <SelectValue placeholder="اختر القسم المستهدف" />
        </SelectTrigger>
        <SelectContent>
          {(depts as any[])
            .filter((d) => d.id !== currentDeptId)
            .map((d: any) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name_ar}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب الإحالة (اختياري)"
        rows={2}
      />
      <Button onClick={submit} disabled={busy || !target} variant="secondary" className="w-full">
        {busy ? "جارٍ الإحالة..." : "إحالة"}
      </Button>
    </div>
  );
}

export function RoutingHistoryList({ complaintId }: { complaintId: string }) {
  const fn = useServerFn(listRoutingHistory);
  const { data = [] } = useQuery({
    queryKey: ["routing-history", complaintId],
    queryFn: () => fn({ data: { complaint_id: complaintId } }),
  });
  if (!data.length) return null;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="font-semibold text-sm mb-2">سجل الإحالات</div>
      <ul className="space-y-1 text-xs">
        {(data as any[]).map((h) => (
          <li key={h.id} className="border-r-2 border-primary/40 pr-2">
            <div>
              {h.from_department_name ?? "—"} → <strong>{h.to_department_name}</strong>
            </div>
            <div className="text-muted-foreground">
              بواسطة {h.actor_name} • {new Date(h.created_at).toLocaleString("ar")}
            </div>
            {h.reason && <div className="italic">{h.reason}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
