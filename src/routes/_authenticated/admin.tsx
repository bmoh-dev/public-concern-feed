import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListComplaints, adminMetrics, adminUpdate } from "@/lib/complaints.functions";
import { requireAdminRoute } from "@/lib/admin-route-guard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE, CATEGORIES, STATUSES } from "@/lib/i18n";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { RedirectSection, RoutingHistoryList } from "./department";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ location }) => requireAdminRoute(location),
  head: () => ({ meta: [{ title: "لوحة الإدارة | منصة الشكاوى" }] }),
  component: AdminRouteShell,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message.includes("admin only") ? "غير مصرح: هذه الصفحة متاحة للمسؤولين فقط" : `خطأ: ${error.message}`}</div>,
});

function AdminRouteShell() {
  const location = useLocation();
  return location.pathname === "/admin" ? <AdminPage /> : <Outlet />;
}

function AdminPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListComplaints);
  const metricsFn = useServerFn(adminMetrics);
  const updateFn = useServerFn(adminUpdate);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      search: search || null,
      status: status === "all" ? null : (status as any),
      category: category === "all" ? null : (category as any),
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to + "T23:59:59").toISOString() : null,
    }),
    [search, status, category, from, to],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-complaints", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const { data: metrics } = useQuery({ queryKey: ["admin-metrics"], queryFn: () => metricsFn() });

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((r: any) => r.id)) : new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    checked ? next.add(id) : next.delete(id);
    setSelected(next);
  };

  const applyBulk = async () => {
    if (selected.size === 0 || !bulkStatus) return;
    try {
      const r = await updateFn({ data: { ids: Array.from(selected), status: bulkStatus as any } });
      toast.success(`تم تحديث ${r.updated} شكوى`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin-complaints"] });
      qc.invalidateQueries({ queryKey: ["admin-metrics"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const exportXlsx = () => {
    const data = (rows as any[]).map((r) => ({
      "رقم الشكوى": r.id,
      "العنوان": r.title,
      "الوصف": r.description,
      "الفئة": CATEGORY_LABELS[r.category] ?? r.category,
      "الحالة": STATUS_LABELS[r.status] ?? r.status,
      "العنوان الجغرافي": r.address,
      "اسم المواطن": r.profiles?.full_name ?? "",
      "البريد الإلكتروني": r.profiles?.email ?? "",
      "ملاحظات داخلية": r.internal_notes ?? "",
      "تاريخ الإنشاء": new Date(r.created_at).toLocaleString("ar"),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Complaints");
    XLSX.writeFile(wb, `complaints-${Date.now()}.xlsx`);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
          <p className="text-sm text-muted-foreground">إدارة شكاوى المواطنين وتحديث حالاتها.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/users">إدارة المستخدمين</Link>
        </Button>
      </div>


      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Stat label="إجمالي الشكاوى" value={metrics?.total ?? "—"} />
        <Stat label="قيد الانتظار" value={metrics?.pending ?? "—"} tone="warning" />
        <Stat label="قيد المعالجة" value={metrics?.in_progress ?? "—"} tone="info" />
        <Stat label="تم الحل" value={metrics?.resolved ?? "—"} tone="success" />
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
          <Input className="pr-9" placeholder="ابحث بالعنوان، الوصف، أو رقم الشكوى" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue placeholder="الفئة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفئات</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <span className="text-sm text-muted-foreground">{selected.size} محدّد</span>
        <Select value={bulkStatus} onValueChange={setBulkStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="تحديث الحالة لـ..." /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={applyBulk} disabled={selected.size === 0 || !bulkStatus}>تطبيق</Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={exportXlsx}><Download className="ms-1 h-4 w-4" /> تصدير Excel</Button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-right">
            <tr>
              <th className="p-3"><Checkbox checked={rows.length > 0 && selected.size === rows.length} onCheckedChange={(c) => toggleAll(!!c)} /></th>
              <th className="p-3">العنوان</th>
              <th className="p-3">المواطن</th>
              <th className="p-3">الفئة</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">جارٍ التحميل...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد شكاوى.</td></tr>
            ) : rows.map((r: any) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="p-3"><Checkbox checked={selected.has(r.id)} onCheckedChange={(c) => toggleOne(r.id, !!c)} /></td>
                <td className="p-3">
                  <button onClick={() => setOpenId(r.id)} className="font-medium hover:underline">{r.title}</button>
                  <div className="text-xs text-muted-foreground">{r.id.slice(0, 8)}…</div>
                </td>
                <td className="p-3">
                  <div className="font-medium">{r.profiles?.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.profiles?.email ?? ""}</div>
                </td>
                <td className="p-3"><Badge variant="secondary">{CATEGORY_LABELS[r.category]}</Badge></td>
                <td className="p-3"><Badge variant="outline" className={STATUS_BADGE[r.status]}>{STATUS_LABELS[r.status]}</Badge></td>
                <td className="p-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AdminDetail id={openId} row={rows.find((r: any) => r.id === openId)} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warning" | "info" | "success" }) {
  const toneCls = tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${toneCls}`}>{value}</div>
    </div>
  );
}

function AdminDetail({ id, row, onClose }: { id: string | null; row: any; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(adminUpdate);
  const [status, setStatus] = useState<string>(row?.status ?? "pending");
  const [notes, setNotes] = useState<string>(row?.internal_notes ?? "");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (row) {
      setStatus(row.status);
      setNotes(row.internal_notes ?? "");
    }
  }, [row]);

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: { ids: [id!], status: status as any, internal_notes: notes } });
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["admin-complaints"] });
      qc.invalidateQueries({ queryKey: ["admin-metrics"] });
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
        <DialogHeader><DialogTitle>تفاصيل الشكوى</DialogTitle></DialogHeader>
        {row && (
          <div className="space-y-3">
            <h3 className="text-lg font-bold">{row.title}</h3>
            <div className="text-xs text-muted-foreground">
              المُقدِّم: {row.profiles?.full_name} ({row.profiles?.email})
            </div>
            <p><strong>الفئة:</strong> {CATEGORY_LABELS[row.category]}</p>
            <p><strong>العنوان:</strong> {row.address}</p>
            <p className="whitespace-pre-wrap"><strong>الوصف:</strong> {row.description}</p>

            <div>
              <label className="text-sm font-medium">الحالة</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات داخلية (غير منشورة)</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
            <Button onClick={save} disabled={saving} className="w-full">{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>

            <RedirectSection complaintId={id!} currentDeptId={row.assigned_department_id ?? null} onDone={() => { qc.invalidateQueries({ queryKey: ["admin-complaints"] }); onClose(); }} />
            <RoutingHistoryList complaintId={id!} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
