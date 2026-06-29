import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  searchUsers,
  changeUserRole,
  muniListSuperAdmins,
  muniPromoteSuperAdminByEmail,
  muniDemoteToCitizen,
  muniTransferSuperAdminByEmail,
  muniAbandonSuperAdmin,
} from "@/lib/users.functions";
import { listDepartments, setDepartmentAdmin } from "@/lib/departments.functions";
import { getMyRole } from "@/lib/notifications.functions";
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
  municipality_role: "super_admin" | "admin" | "citizen";
  department_id: string | null;
  department_name: string | null;
};

function AdminUsersPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const changeFn = useServerFn(changeUserRole);
  const setDeptFn = useServerFn(setDepartmentAdmin);
  const deptsFn = useServerFn(listDepartments);
  const roleFn = useServerFn(getMyRole);

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const myMunicipalities = (role?.municipalities ?? []).filter(
    (m: any) => m.role === "admin" || m.role === "super_admin",
  );
  const activeMuni = myMunicipalities[0] ?? null;
  const isSuperHere = activeMuni?.role === "super_admin";

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
    <div className="container mx-auto p-4 md:p-6 space-y-8" dir="rtl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">إدارة المستخدمين</h1>
          <p className="text-muted-foreground text-sm">
            {activeMuni
              ? `بلدية ${activeMuni.name} — ${activeMuni.wilaya}`
              : "إدارة مسؤولي البلدية ومسؤولي الأقسام"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin">العودة إلى لوحة الإدارة</Link>
        </Button>
      </div>

      {isSuperHere && activeMuni && (
        <MunicipalitySuperAdminSection
          municipalityId={activeMuni.id}
          municipalityName={`${activeMuni.name} — ${activeMuni.wilaya}`}
        />
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">المستخدمون في البلدية</h2>
          <p className="text-xs text-muted-foreground">
            البحث يقتصر على المستخدمين المسجّلين في بلديتك فقط.
          </p>
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
                    <td colSpan={5} className="p-10 text-center text-muted-foreground">
                      {q
                        ? "لا توجد نتائج مطابقة لبحثك."
                        : "ابحث ببريد إلكتروني لعرض المستخدمين."}
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => {
                    const isDeptAdmin = !!u.department_id;
                    const isGlobalAdmin = u.role === "global_admin";
                    const isSuperAdmin =
                      u.role === "super_admin" || u.municipality_role === "super_admin";
                    const isGeneral = u.role === "admin";
                    return (
                      <tr key={u.id} className="border-t">
                        <td className="p-3">{u.full_name || "—"}</td>
                        <td className="p-3" dir="ltr">
                          {u.email || "—"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={
                              isGlobalAdmin || isSuperAdmin || isGeneral
                                ? "default"
                                : isDeptAdmin
                                  ? "secondary"
                                  : "outline"
                            }
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
                          {isGeneral || isSuperAdmin || isGlobalAdmin ? (
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
                            <span className="text-xs text-muted-foreground">
                              يُدار من القسم العلوي
                            </span>
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
      </section>

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

function MunicipalitySuperAdminSection({
  municipalityId,
  municipalityName,
}: {
  municipalityId: string;
  municipalityName: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(muniListSuperAdmins);
  const promoteFn = useServerFn(muniPromoteSuperAdminByEmail);
  const demoteFn = useServerFn(muniDemoteToCitizen);
  const transferFn = useServerFn(muniTransferSuperAdminByEmail);
  const abandonFn = useServerFn(muniAbandonSuperAdmin);

  const { data, isLoading } = useQuery({
    queryKey: ["muni-super-admins", municipalityId],
    queryFn: () => listFn({ data: { municipality_id: municipalityId } }),
  });

  const admins = data?.admins ?? [];
  const selfIsLast = admins.length === 1 && admins[0]?.is_self;

  const [promoteEmail, setPromoteEmail] = useState("");
  const [busyPromote, setBusyPromote] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [busyTransfer, setBusyTransfer] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [busyAbandon, setBusyAbandon] = useState(false);
  const [demoteTarget, setDemoteTarget] = useState<{ user_id: string; email: string | null } | null>(
    null,
  );
  const [busyDemote, setBusyDemote] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["muni-super-admins", municipalityId] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["my-role"] });
  };

  const handlePromote = async () => {
    const email = promoteEmail.trim();
    if (!email) return toast.error("أدخل بريداً إلكترونياً");
    setBusyPromote(true);
    try {
      await promoteFn({ data: { municipality_id: municipalityId, email } });
      toast.success("تمت الترقية إلى مسؤول بلدية أعلى");
      setPromoteEmail("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "فشلت الترقية");
    } finally {
      setBusyPromote(false);
    }
  };

  const handleDemote = async () => {
    if (!demoteTarget) return;
    setBusyDemote(true);
    try {
      await demoteFn({
        data: { municipality_id: municipalityId, target_user_id: demoteTarget.user_id },
      });
      toast.success("تم تخفيض المسؤول إلى مواطن");
      setDemoteTarget(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التخفيض");
    } finally {
      setBusyDemote(false);
    }
  };

  const handleTransfer = async () => {
    const email = transferEmail.trim();
    if (!email) return toast.error("أدخل بريداً إلكترونياً");
    setBusyTransfer(true);
    try {
      await transferFn({ data: { municipality_id: municipalityId, email } });
      toast.success("تم نقل المسؤولية");
      setConfirmTransfer(false);
      setTransferEmail("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر نقل المسؤولية");
    } finally {
      setBusyTransfer(false);
    }
  };

  const handleAbandon = async () => {
    setBusyAbandon(true);
    try {
      await abandonFn({ data: { municipality_id: municipalityId } });
      toast.success("تم التخلي عن دور المسؤول الأعلى");
      setConfirmAbandon(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر التخلي");
    } finally {
      setBusyAbandon(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">مسؤولو البلدية الأعلى</h2>
          <p className="text-xs text-muted-foreground mt-1">{municipalityName}</p>
        </div>
        <Badge variant="outline">{admins.length} مسؤول</Badge>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : admins.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا يوجد مسؤولون أعلى مسجّلون.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {admins.map((a: { user_id: string; full_name: string | null; email: string | null; is_self: boolean }) => {
            const displayName = a.full_name || a.email || "مستخدم";
            const showEmail = a.email && a.email !== displayName;
            return (
              <li
                key={a.user_id}
                className="flex items-center justify-between gap-3 p-3 flex-wrap"
              >
                <div>
                  <div className="font-medium">
                    {displayName}
                    {a.is_self && (
                      <Badge variant="secondary" className="ms-2 text-[10px]">
                        أنت
                      </Badge>
                    )}
                  </div>
                  {showEmail && (
                    <div className="text-xs text-muted-foreground mt-0.5" dir="ltr">
                      {a.email}
                    </div>
                  )}
                </div>
                {!a.is_self && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDemoteTarget({ user_id: a.user_id, email: a.email })}
                  >
                    تخفيض إلى مواطن
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-2">
          <h3 className="font-semibold">ترقية إلى مسؤول أعلى</h3>
          <p className="text-xs text-muted-foreground">
            يجب أن يكون المستخدم عضواً في هذه البلدية.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Input
              type="email"
              placeholder="user@example.com"
              value={promoteEmail}
              onChange={(e) => setPromoteEmail(e.target.value)}
              disabled={busyPromote}
              className="max-w-xs"
            />
            <Button onClick={handlePromote} disabled={busyPromote || !promoteEmail.trim()}>
              {busyPromote ? "جارٍ..." : "ترقية"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <h3 className="font-semibold">نقل المسؤولية</h3>
          <p className="text-xs text-muted-foreground">
            يرقي المستلم إلى مسؤول أعلى ثم يخفّضك تلقائياً.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Input
              type="email"
              placeholder="user@example.com"
              value={transferEmail}
              onChange={(e) => setTransferEmail(e.target.value)}
              disabled={busyTransfer}
              className="max-w-xs"
            />
            <Button
              variant="destructive"
              onClick={() => setConfirmTransfer(true)}
              disabled={busyTransfer || !transferEmail.trim()}
            >
              نقل
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-destructive/30 p-4 space-y-2">
        <h3 className="font-semibold">التخلي عن المسؤولية</h3>
        <p className="text-xs text-muted-foreground">
          متاح فقط إذا كان هناك مسؤول أعلى آخر للبلدية.
        </p>
        <Button
          variant="destructive"
          disabled={selfIsLast || busyAbandon}
          onClick={() => setConfirmAbandon(true)}
        >
          التخلي عن دور المسؤول الأعلى
        </Button>
        {selfIsLast && (
          <p className="text-xs text-destructive">
            لا يمكنك التخلي لأنك آخر مسؤول أعلى لهذه البلدية. قم بترقية مستخدم آخر أولاً.
          </p>
        )}
      </div>

      <AlertDialog open={!!demoteTarget} onOpenChange={(o) => !o && setDemoteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد التخفيض</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إزالة دور المسؤول الأعلى عن {demoteTarget?.email ?? "هذا المستخدم"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDemote}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDemote} disabled={busyDemote}>
              {busyDemote ? "جارٍ..." : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmTransfer} onOpenChange={setConfirmTransfer}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد نقل المسؤولية</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم ترقية {transferEmail || "المستلم"} إلى مسؤول أعلى وسحب صلاحياتك مباشرة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyTransfer}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyTransfer}
              onClick={(e) => {
                e.preventDefault();
                handleTransfer();
              }}
            >
              {busyTransfer ? "جارٍ..." : "تأكيد النقل"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد التخلي</AlertDialogTitle>
            <AlertDialogDescription>
              ستفقد صلاحيات المسؤول الأعلى لهذه البلدية. لا يمكن التراجع إلا بترقيتك من قِبل
              مسؤول آخر.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAbandon}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyAbandon}
              onClick={(e) => {
                e.preventDefault();
                handleAbandon();
              }}
            >
              {busyAbandon ? "جارٍ..." : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
