import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchUsers, changeUserRole } from "@/lib/users.functions";
import { listDepartments, setDepartmentAdmin } from "@/lib/departments.functions";
import { requireAdminRoute } from "@/lib/admin-route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  beforeLoad: ({ location }) => requireAdminRoute(location),
  head: () => ({ meta: [{ title: "إدارة المستخدمين | لوحة الإدارة" }] }),
  component: AdminUsersPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">
      {error.message.includes("admin only")
        ? "غير مصرح: هذه الصفحة متاحة للمسؤولين فقط"
        : `خطأ: ${error.message}`}
    </div>
  ),
});

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "global_admin" | "super_admin" | "admin" | "citizen";
  department_id: string | null;
  department_name: string | null;
};

function AdminUsersPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const changeFn = useServerFn(changeUserRole);
  const setDeptFn = useServerFn(setDepartmentAdmin);
  const deptsFn = useServerFn(listDepartments);

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => searchFn({ data: { q } }) as Promise<Row[]>,
  });
  const { data: depts = [] } = useQuery({ queryKey: ["departments"], queryFn: () => deptsFn() });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(input.trim());
  };

  const confirmChange = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const action = pending.role === "admin" ? "demote" : "promote";
      await changeFn({ data: { target_user_id: pending.id, action } });
      toast.success(
        action === "promote" ? "تمت ترقية المستخدم إلى مسؤول عام" : "تم تخفيض المستخدم إلى مواطن",
      );
      setPending(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "فشل تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  };

  const onDeptChange = async (user: Row, value: string) => {
    try {
      const deptId = value === "none" ? null : value;
      await setDeptFn({ data: { target_user_id: user.id, department_id: deptId } });
      toast.success(deptId ? "تم تعيين مسؤول قسم" : "تم إزالة دور مسؤول القسم");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "فشل التعيين");
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">إدارة المستخدمين</h1>
          <p className="text-muted-foreground text-sm">إدارة المسؤولين العامين ومسؤولي الأقسام</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin">العودة إلى لوحة الإدارة</Link>
        </Button>
      </div>

      <form onSubmit={submit} className="flex gap-2 max-w-xl">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ابحث بالبريد الإلكتروني..."
          maxLength={200}
        />
        <Button type="submit">
          <Search className="h-4 w-4 ml-2" />
          بحث
        </Button>
      </form>

      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-right">
                <th className="p-3 font-medium">الاسم</th>
                <th className="p-3 font-medium">البريد</th>
                <th className="p-3 font-medium">الدور</th>
                <th className="p-3 font-medium">القسم</th>
                <th className="p-3 font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline ml-2" />
                    جارٍ التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    لا توجد نتائج
                  </td>
                </tr>
              ) : (
                rows.map((u) => {
                  const isDeptAdmin = !!u.department_id;
                  const isGlobalAdmin = u.role === "global_admin";
                  const isSuperAdmin = u.role === "super_admin";
                  const isGeneral = u.role === "admin";
                  return (
                    <tr key={u.id} className="border-t">
                      <td className="p-3">{u.full_name || "—"}</td>
                      <td className="p-3" dir="ltr">
                        {u.email || "—"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={isGlobalAdmin || isSuperAdmin || isGeneral ? "default" : isDeptAdmin ? "secondary" : "outline"}
                        >
                          {isGlobalAdmin
                            ? "مسؤول المنصة"
                            : isSuperAdmin
                              ? "مسؤول بلدية أعلى"
                              : isGeneral
                                ? "مسؤول عام"
                                : isDeptAdmin
                                  ? "مسؤول قسم"
                                  : "مواطن"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {isGeneral ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Select
                            value={u.department_id ?? "none"}
                            onValueChange={(v) => onDeptChange(u, v)}
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— بدون —</SelectItem>
                              {(depts as any[]).map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.name_ar}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-3">
                        {isGlobalAdmin || isSuperAdmin ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Button
                            size="sm"
                            variant={isGeneral ? "outline" : "default"}
                            onClick={() => setPending(u)}
                          >
                            {isGeneral ? "إزالة الإدارة العامة" : "ترقية إلى مسؤول عام"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تغيير الدور</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.role === "admin"
                ? `هل أنت متأكد من إزالة دور المسؤول العام عن ${pending?.email}؟`
                : `هل أنت متأكد من ترقية ${pending?.email} إلى مسؤول عام؟`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
