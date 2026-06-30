import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  searchUsers,
  changeUserRole,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Search, Loader2, MoreHorizontal } from "lucide-react";

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

type PendingAction =
  | { kind: "promote-admin"; user: Row }
  | { kind: "demote-admin"; user: Row }
  | { kind: "promote-super"; user: Row }
  | { kind: "demote-super"; user: Row }
  | { kind: "transfer-super"; user: Row }
  | { kind: "abandon-super" };

function AdminUsersPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const changeFn = useServerFn(changeUserRole);
  const setDeptFn = useServerFn(setDepartmentAdmin);
  const deptsFn = useServerFn(listDepartments);
  const roleFn = useServerFn(getMyRole);
  const promoteSuperFn = useServerFn(muniPromoteSuperAdminByEmail);
  const demoteFn = useServerFn(muniDemoteToCitizen);
  const transferFn = useServerFn(muniTransferSuperAdminByEmail);
  const abandonFn = useServerFn(muniAbandonSuperAdmin);

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const myMunicipalities = (role?.municipalities ?? []).filter(
    (m: any) => m.role === "admin" || m.role === "super_admin",
  );
  const activeMuni = myMunicipalities[0] ?? null;
  const isSuperHere = activeMuni?.role === "super_admin";

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  // Cooldown UX driven by server-side rate-limit response.
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cooling) return;
    setQ(input.trim());
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["my-role"] });
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "promote-admin") {
        await changeFn({ data: { target_user_id: pending.user.id, action: "promote" } });
        toast.success("تمت ترقية المستخدم إلى مسؤول عام");
      } else if (pending.kind === "demote-admin") {
        await changeFn({ data: { target_user_id: pending.user.id, action: "demote" } });
        toast.success("تم تخفيض المستخدم إلى مواطن");
      } else if (pending.kind === "promote-super") {
        if (!pending.user.email) throw new Error("لا يوجد بريد إلكتروني");
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await promoteSuperFn({
          data: { municipality_id: activeMuni.id, email: pending.user.email },
        });
        toast.success("تمت الترقية إلى مسؤول بلدية أعلى");
      } else if (pending.kind === "demote-super") {
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await demoteFn({
          data: { municipality_id: activeMuni.id, target_user_id: pending.user.id },
        });
        toast.success("تم التخفيض");
      } else if (pending.kind === "transfer-super") {
        if (!pending.user.email) throw new Error("لا يوجد بريد إلكتروني");
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await transferFn({
          data: { municipality_id: activeMuni.id, email: pending.user.email },
        });
        toast.success("تم نقل المسؤولية");
      } else if (pending.kind === "abandon-super") {
        if (!activeMuni) throw new Error("لا توجد بلدية نشطة");
        await abandonFn({ data: { municipality_id: activeMuni.id } });
        toast.success("تم التخلي عن دور المسؤول الأعلى");
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
      case "promote-admin":
        return { title: "ترقية إلى مسؤول عام", desc: `هل أنت متأكد من ترقية ${email}؟` };
      case "demote-admin":
        return {
          title: "إزالة دور المسؤول العام",
          desc: `هل أنت متأكد من إزالة دور المسؤول العام عن ${email}؟`,
        };
      case "promote-super":
        return {
          title: "ترقية إلى مسؤول بلدية أعلى",
          desc: `سيتم ترقية ${email} إلى مسؤول بلدية أعلى.`,
        };
      case "demote-super":
        return {
          title: "تخفيض المسؤول الأعلى",
          desc: `سيتم إزالة دور المسؤول الأعلى عن ${email}.`,
        };
      case "transfer-super":
        return {
          title: "نقل المسؤولية",
          desc: `سيتم ترقية ${email} إلى مسؤول أعلى وسحب صلاحياتك مباشرة.`,
        };
      case "abandon-super":
        return {
          title: "التخلي عن المسؤولية",
          desc: "ستفقد صلاحيات المسؤول الأعلى لهذه البلدية. لا يمكن التراجع إلا بترقيتك من قِبل مسؤول آخر.",
        };
    }
  })();

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
                  <th className="p-3 font-medium">الإجراءات</th>
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
                      isSuperHere={isSuperHere}
                      depts={depts as any[]}
                      onDeptChange={onDeptChange}
                      onAction={setPending}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

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
  isSuperHere,
  depts,
  onDeptChange,
  onAction,
}: {
  u: Row;
  isSuperHere: boolean;
  depts: any[];
  onDeptChange: (u: Row, v: string) => void;
  onAction: (p: PendingAction) => void;
}) {
  const isDeptAdmin = !!u.department_id;
  const isGlobalAdmin = u.role === "global_admin";
  const isSuperAdmin = u.role === "super_admin" || u.municipality_role === "super_admin";
  const isGeneral = u.role === "admin";

  const roleLabel = isGlobalAdmin
    ? "مسؤول المنصة"
    : isSuperAdmin
      ? "مسؤول بلدية أعلى"
      : isGeneral
        ? "مسؤول عام"
        : isDeptAdmin
          ? "مسؤول قسم"
          : "مواطن";

  // Action availability:
  // - Only super-admins of this municipality can promote/demote super-admin role.
  // - Anyone (admin or super) can promote a citizen to general admin or set a department.
  // - Cannot touch global admins via this page.
  const canManage = !isGlobalAdmin;

  return (
    <tr className="border-t">
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
          {roleLabel}
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
              {depts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="p-3">
        {!canManage ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal className="h-4 w-4" />
                <span className="ms-1">إجراءات</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              {!isSuperAdmin && !isGeneral && (
                <DropdownMenuItem onClick={() => onAction({ kind: "promote-admin", user: u })}>
                  ترقية إلى مسؤول عام
                </DropdownMenuItem>
              )}
              {isGeneral && (
                <DropdownMenuItem onClick={() => onAction({ kind: "demote-admin", user: u })}>
                  إزالة الإدارة العامة
                </DropdownMenuItem>
              )}
              {isSuperHere && !isSuperAdmin && (
                <DropdownMenuItem onClick={() => onAction({ kind: "promote-super", user: u })}>
                  ترقية إلى مسؤول بلدية أعلى
                </DropdownMenuItem>
              )}
              {isSuperHere && isSuperAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onAction({ kind: "transfer-super", user: u })}
                  >
                    نقل المسؤولية إلى هذا المستخدم
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onAction({ kind: "demote-super", user: u })}
                  >
                    تخفيض من مسؤول أعلى
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onAction({ kind: "abandon-super" })}
                  >
                    التخلي عن دوري كمسؤول أعلى
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}
