import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { searchUsers, changeUserRole } from "@/lib/users.functions";
import { requireAdminRoute } from "@/lib/admin-route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
      {error.message.includes("admin only") ? "غير مصرح: هذه الصفحة متاحة للمسؤولين فقط" : `خطأ: ${error.message}`}
    </div>
  ),
});

type Row = { id: string; full_name: string | null; email: string | null; role: "admin" | "citizen" };

function AdminUsersPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const changeFn = useServerFn(changeUserRole);

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => searchFn({ data: { q } }) as Promise<Row[]>,
  });

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
      toast.success(action === "promote" ? "تمت ترقية المستخدم إلى مسؤول" : "تم تخفيض المستخدم إلى مواطن");
      setPending(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err: any) {
      toast.error(err?.message ?? "فشل تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">إدارة المستخدمين</h1>
          <p className="text-muted-foreground text-sm">البحث وإدارة أدوار المستخدمين</p>
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
                <th className="p-3 font-medium">الاسم الكامل</th>
                <th className="p-3 font-medium">البريد الإلكتروني</th>
                <th className="p-3 font-medium">الدور</th>
                <th className="p-3 font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline ml-2" />
                    جارٍ التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    لا توجد نتائج
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="p-3">{u.full_name || "—"}</td>
                    <td className="p-3 ltr-text" dir="ltr">{u.email || "—"}</td>
                    <td className="p-3">
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {u.role === "admin" ? "مسؤول" : "مواطن"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant={u.role === "admin" ? "outline" : "default"}
                        onClick={() => setPending(u)}
                      >
                        {u.role === "admin" ? "تخفيض إلى مواطن" : "ترقية إلى مسؤول"}
                      </Button>
                    </td>
                  </tr>
                ))
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
                ? `هل أنت متأكد من تخفيض ${pending?.email} إلى مواطن؟`
                : `هل أنت متأكد من ترقية ${pending?.email} إلى مسؤول؟`}
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
