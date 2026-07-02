import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  searchUsers,
  muniPromoteSuperAdminByEmail,
  muniTransferSuperAdminByEmail,
  muniAbandonSuperAdmin,
  muniListSuperAdmins,
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
  municipality_id: string | null;
  department_id: string | null;
  department_name: string | null;
};

type SearchResponse = {
  rows: Row[];
  rateLimitMessage: string | null;
  rateLimitResetAt: string | null;
};

/** Municipality role only — ignore platform roles entirely. */
type MuniRole = "citizen" | "super_admin" | "department_admin";
function getMuniRole(u: Row): MuniRole {
  if (u.department_id) return "department_admin";
  if (u.municipality_role === "super_admin") return "super_admin";
  return "citizen";
}
function muniRoleLabel(r: MuniRole): string {
  return r === "super_admin" ? "مسؤول عام" : r === "department_admin" ? "مسؤول قسم" : "مواطن";
}

type PendingAction =
  | { kind: "promote-super"; user: Row }
  | { kind: "promote-dept"; user: Row; departmentId: string }
  | { kind: "demote-dept"; user: Row }
  | { kind: "transfer-super"; user: Row }
  | { kind: "abandon-super" };

function AdminUsersPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const setDeptFn = useServerFn(setDepartmentAdmin);
  const deptsFn = useServerFn(listDepartments);
  const roleFn = useServerFn(getMyRole);
  const promoteSuperFn = useServerFn(muniPromoteSuperAdminByEmail);
  const transferFn = useServerFn(muniTransferSuperAdminByEmail);
  const abandonFn = useServerFn(muniAbandonSuperAdmin);
  const listSupersFn = useServerFn(muniListSuperAdmins);

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const myMunicipalities = (role?.municipalities ?? []).filter(
    (m: any) => m.role === "admin" || m.role === "super_admin",
  );
  const activeMuni = myMunicipalities[0] ?? null;
  const isGeneralAdmin = activeMuni?.role === "super_admin";

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoteDialog, setPromoteDialog] = useState<
    | { user: Row; step: "choose" | "pick-dept"; dept: string }
    | null
  >(null);

  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);
  const cooling = !!(cooldownUntil && cooldownUntil > now);
  useEffect(() => {
    if (cooldownUntil && cooldownUntil <= now) setCooldownUntil(null);
  }, [cooldownUntil, now]);

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["admin-users", q],
    queryFn: () => searchFn({ data: { q } }) as Promise<SearchResponse>,
    enabled: !cooling,
  });
  const rows: Row[] = data?.rows ?? [];
  useEffect(() => {
    const resetAt = data?.rateLimitResetAt;
    if (resetAt) {
      const t = new Date(resetAt).getTime();
      if (t > Date.now()) setCooldownUntil(t);
    }
  }, [data?.rateLimitResetAt]);
  const rateLimitMessage = data?.rateLimitMessage ?? null;

  const { data: depts = [] } = useQuery({ queryKey: ["departments"], queryFn: () => deptsFn() });

  // Count of super_admins in the current municipality (to protect last-admin).
  const { data: superList } = useQuery({
    queryKey: ["muni-supers", activeMuni?.id],
    queryFn: () => listSupersFn({ data: { municipality_id: activeMuni!.id } }),
    enabled: !!activeMuni?.id,
  });
  const superAdminCount = (superList?.admins?.length ?? 0) as number;
  const isLastSuper = isGeneralAdmin && superAdminCount <= 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cooling) return;
    setQ(input.trim());
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["my-role"] });
    qc.invalidateQueries({ queryKey: ["muni-supers"] });
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "promote-super") {
        if (!pending.user.email) throw new Error("لا يوجد بريد إلكتروني");
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await promoteSuperFn({
          data: { municipality_id: activeMuni.id, email: pending.user.email },
        });
        toast.success("تمت الترقية إلى مسؤول عام");
      } else if (pending.kind === "promote-dept") {
        await setDeptFn({
          data: { target_user_id: pending.user.id, department_id: pending.departmentId },
        });
        toast.success("تمت الترقية إلى مسؤول قسم");
      } else if (pending.kind === "demote-dept") {
        await setDeptFn({ data: { target_user_id: pending.user.id, department_id: null } });
        toast.success("تم إلغاء ترقية مسؤول القسم");
      } else if (pending.kind === "transfer-super") {
        if (!pending.user.email) throw new Error("لا يوجد بريد إلكتروني");
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await transferFn({
          data: { municipality_id: activeMuni.id, email: pending.user.email },
        });
        toast.success("تم نقل المسؤولية");
      } else if (pending.kind === "abandon-super") {
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        const res: any = await abandonFn({ data: { municipality_id: activeMuni.id } });
        if (res && res.ok === false) {
          toast.error(res.message ?? "تعذّر تنفيذ الإجراء");
          setPending(null);
          return;
        }
        toast.success("تم التخلي عن المسؤولية");
      }
      setPending(null);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "فشل تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  };

  const dialogText = (() => {
    if (!pending) return { title: "", desc: "" };
    const email = "user" in pending ? pending.user.email ?? "هذا المستخدم" : "";
    switch (pending.kind) {
      case "promote-super":
        return { title: "ترقية إلى مسؤول عام", desc: `سيتم ترقية ${email} إلى مسؤول عام.` };
      case "promote-dept": {
        const dname = (depts as any[]).find((d) => d.id === pending.departmentId)?.name_ar ?? "";
        return {
          title: "ترقية إلى مسؤول قسم",
          desc: `سيتم تعيين ${email} كمسؤول قسم "${dname}".`,
        };
      }
      case "demote-dept":
        return {
          title: "إلغاء ترقية مسؤول القسم",
          desc: `سيعود ${email} إلى دور مواطن.`,
        };
      case "transfer-super":
        return {
          title: "نقل المسؤولية",
          desc: `سيتم ترقية ${email} إلى مسؤول عام وسحب صلاحياتك مباشرة.`,
        };
      case "abandon-super":
        return {
          title: "التخلي عن المسؤولية",
          desc: "ستفقد صلاحيات المسؤول العام لهذه البلدية. لا يمكن التراجع إلا بترقيتك من قِبل مسؤول آخر.",
        };
    }
  })();

  const selfId = superList?.self_user_id as string | undefined;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6" dir="rtl">
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

      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">
          البحث يقتصر على المستخدمين المسجّلين في بلديتك فقط.
        </p>
        <form onSubmit={submit} className="flex gap-2 max-w-xl">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ابحث بالبريد الإلكتروني..."
            maxLength={200}
            disabled={cooling}
          />
          <Button type="submit" disabled={cooling}>
            <Search className="h-4 w-4 ml-2" />
            بحث
          </Button>
        </form>

        {rateLimitMessage && (
          <div className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {rateLimitMessage}
          </div>
        )}

        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-right">
                  <th className="p-3 font-medium">الاسم</th>
                  <th className="p-3 font-medium">البريد</th>
                  <th className="p-3 font-medium">الدور</th>
                  <th className="p-3 font-medium">القسم</th>
                  <th className="p-3 font-medium">إجراء</th>
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
                        ? "لم يتم العثور على أي مستخدم بهذا البريد الإلكتروني داخل بلديتك."
                        : "ابحث ببريد إلكتروني لعرض المستخدمين."}
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => (
                    <UserRow
                      key={u.id}
                      u={u}
                      isSelf={selfId === u.id}
                      isGeneralAdmin={!!isGeneralAdmin}
                      isLastSuper={isLastSuper}
                      onPromoteClick={() =>
                        setPromoteDialog({ user: u, step: "choose", dept: "" })
                      }
                      onDemoteDept={() => setPending({ kind: "demote-dept", user: u })}
                      onTransfer={() => setPending({ kind: "transfer-super", user: u })}
                      onAbandon={() => setPending({ kind: "abandon-super" })}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Promote citizen — step 1 (choose) / step 2 (pick dept) */}
      <Dialog
        open={!!promoteDialog}
        onOpenChange={(o) => !o && setPromoteDialog(null)}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>ترقية المستخدم</DialogTitle>
            <DialogDescription>
              {promoteDialog?.user.email ?? ""}
            </DialogDescription>
          </DialogHeader>

          {promoteDialog?.step === "choose" && (
            <div className="grid gap-3">
              {isGeneralAdmin && (
                <Button
                  onClick={() => {
                    if (!promoteDialog) return;
                    setPending({ kind: "promote-super", user: promoteDialog.user });
                    setPromoteDialog(null);
                  }}
                >
                  ترقية إلى مسؤول عام
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  setPromoteDialog((d) => (d ? { ...d, step: "pick-dept" } : d))
                }
              >
                ترقية إلى مسؤول قسم
              </Button>
            </div>
          )}

          {promoteDialog?.step === "pick-dept" && (
            <div className="grid gap-3">
              <Select
                value={promoteDialog.dept}
                onValueChange={(v) =>
                  setPromoteDialog((d) => (d ? { ...d, dept: v } : d))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر القسم..." />
                </SelectTrigger>
                <SelectContent>
                  {(depts as any[]).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPromoteDialog(null)}>
                  إلغاء
                </Button>
                <Button
                  disabled={!promoteDialog.dept}
                  onClick={() => {
                    if (!promoteDialog?.dept) return;
                    setPending({
                      kind: "promote-dept",
                      user: promoteDialog.user,
                      departmentId: promoteDialog.dept,
                    });
                    setPromoteDialog(null);
                  }}
                >
                  تأكيد
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogText.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogText.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmPending();
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserRow({
  u,
  isSelf,
  isGeneralAdmin,
  isLastSuper,
  onPromoteClick,
  onDemoteDept,
  onTransfer,
  onAbandon,
}: {
  u: Row;
  isSelf: boolean;
  isGeneralAdmin: boolean;
  isLastSuper: boolean;
  onPromoteClick: () => void;
  onDemoteDept: () => void;
  onTransfer: () => void;
  onAbandon: () => void;
}) {
  const mrole = getMuniRole(u);
  const label = muniRoleLabel(mrole);

  return (
    <tr className="border-t">
      <td className="p-3">{u.full_name || "—"}</td>
      <td className="p-3" dir="ltr">
        {u.email || "—"}
      </td>
      <td className="p-3">
        <Badge
          variant={
            mrole === "super_admin"
              ? "default"
              : mrole === "department_admin"
                ? "secondary"
                : "outline"
          }
        >
          {label}
        </Badge>
      </td>
      <td className="p-3">
        {mrole === "department_admin" ? (
          <span className="text-xs">{u.department_name || "—"}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3">
        {mrole === "citizen" && isGeneralAdmin && (
          <Button size="sm" onClick={onPromoteClick}>
            ترقية
          </Button>
        )}
        {mrole === "department_admin" && isGeneralAdmin && (
          <Button size="sm" variant="destructive" onClick={onDemoteDept}>
            إلغاء الترقية
          </Button>
        )}
        {mrole === "super_admin" && isSelf && isGeneralAdmin && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onTransfer}>
              نقل المسؤولية
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onAbandon}
              disabled={isLastSuper}
              title={
                isLastSuper
                  ? "لا يمكن التخلي عن المسؤولية لعدم وجود مسؤول عام آخر."
                  : undefined
              }
            >
              التخلي عن المسؤولية
            </Button>
            {isLastSuper && (
              <p className="w-full text-xs text-muted-foreground">
                لا يمكن التخلي عن المسؤولية لعدم وجود مسؤول عام آخر.
              </p>
            )}
          </div>
        )}
        {mrole === "super_admin" && !isSelf && (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {!isGeneralAdmin && mrole !== "super_admin" && (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
