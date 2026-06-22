import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/notifications.functions";
import {
  getPlatformBootstrapState,
  bootstrapGlobalAdmin,
  listGlobalAdmins,
  promoteGlobalAdminByEmail,
  abandonGlobalAdmin,
  transferGlobalAdminByEmail,
} from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/_authenticated/platform-admin")({
  head: () => ({ meta: [{ title: "إدارة المنصّة" }] }),
  beforeLoad: async () => {
    try {
      const role = await getMyRole();
      if (role.isGlobalAdmin) return;
      const state = await getPlatformBootstrapState();
      if (!state.hasGlobalAdmin) return;
      throw redirect({ to: "/my-complaints" });
    } catch (e: any) {
      if (e?.isRedirect) throw e;
      throw redirect({ to: "/my-complaints" });
    }
  },
  component: PlatformAdminPage,
});

function PlatformAdminPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const bootstrapStateFn = useServerFn(getPlatformBootstrapState);
  const bootstrapFn = useServerFn(bootstrapGlobalAdmin);
  const listAdminsFn = useServerFn(listGlobalAdmins);
  const promoteFn = useServerFn(promoteGlobalAdminByEmail);
  const abandonFn = useServerFn(abandonGlobalAdmin);
  const transferFn = useServerFn(transferGlobalAdminByEmail);

  const { data: bootstrapState } = useQuery({
    queryKey: ["platform-bootstrap-state"],
    queryFn: () => bootstrapStateFn(),
  });
  const needsBootstrap = bootstrapState ? !bootstrapState.hasGlobalAdmin : false;

  const [confirmBootstrap, setConfirmBootstrap] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  const { data: adminsData, isLoading: adminsLoading } = useQuery({
    queryKey: ["platform-global-admins"],
    queryFn: () => listAdminsFn(),
    enabled: !needsBootstrap && bootstrapState !== undefined,
  });

  const [email, setEmail] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);

  if (needsBootstrap) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">إدارة المنصّة</h1>
        <div className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="text-xl font-semibold">تهيئة إدارة المنصّة</h2>
          <p className="text-sm text-muted-foreground">
            يمكن تنفيذ هذه العملية لمرة واحدة فقط.
          </p>
          <Button onClick={() => setConfirmBootstrap(true)}>بدء التهيئة</Button>
        </div>
        <AlertDialog open={confirmBootstrap} onOpenChange={setConfirmBootstrap}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد التهيئة</AlertDialogTitle>
              <AlertDialogDescription>
                أنت على وشك أن تصبح مسؤول المنصّة. يمكن تنفيذ هذه العملية لمرة واحدة فقط.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bootstrapping}>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                disabled={bootstrapping}
                onClick={async (e) => {
                  e.preventDefault();
                  setBootstrapping(true);
                  try {
                    await bootstrapFn();
                    toast.success("تمت التهيئة بنجاح");
                    setConfirmBootstrap(false);
                    await qc.invalidateQueries();
                  } catch (err: any) {
                    toast.error(err?.message || "فشلت التهيئة");
                  } finally {
                    setBootstrapping(false);
                  }
                }}
              >
                {bootstrapping ? "جارٍ التنفيذ..." : "تأكيد"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  const admins = adminsData?.admins ?? [];
  const selfIsLast = admins.length === 1 && admins[0]?.is_self;

  const handlePromote = async () => {
    const value = email.trim();
    if (!value) return toast.error("أدخل بريداً إلكترونياً");
    setPromoting(true);
    try {
      await promoteFn({ data: { email: value } });
      toast.success("تمت الترقية");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["platform-global-admins"] });
    } catch (e: any) {
      toast.error(e?.message || "فشلت الترقية");
    } finally {
      setPromoting(false);
    }
  };

  const handleAbandon = async () => {
    setAbandoning(true);
    try {
      await abandonFn();
      toast.success("تم التخلي عن المسؤولية");
      setConfirmAbandon(false);
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر التخلي");
    } finally {
      setAbandoning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">إدارة المنصّة</h1>
          <p className="text-sm text-muted-foreground">
            إدارة مسؤولي المنصّة فقط. إدارة البلديات تتم من صفحاتها الخاصة.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/platform-municipalities">طلبات اعتماد البلديات</Link>
        </Button>
      </div>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">مسؤولو المنصّة</h2>
            {adminsData?.initialized_at && (
              <p className="text-xs text-muted-foreground mt-1">
                تمت التهيئة في {new Date(adminsData.initialized_at).toLocaleString("ar")}
                {adminsData.initializer && (
                  <>
                    {" "}
                    بواسطة{" "}
                    {adminsData.initializer.full_name ||
                      adminsData.initializer.email ||
                      "—"}
                  </>
                )}
              </p>
            )}
          </div>
          <Badge variant="outline">{admins.length} مسؤول</Badge>
        </div>

        {adminsLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {admins.map((a: any) => (
              <li key={a.user_id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <div className="font-medium">
                    {a.full_name || a.email || a.user_id}
                    {a.is_self && (
                      <Badge variant="secondary" className="ms-2 text-[10px]">
                        أنت
                      </Badge>
                    )}
                  </div>
                  {a.email && a.full_name && (
                    <div className="text-xs text-muted-foreground">{a.email}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    منذ {new Date(a.created_at).toLocaleDateString("ar")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">ترقية مستخدم</h2>
        <p className="text-sm text-muted-foreground">
          أدخل البريد الإلكتروني لمستخدم مسجّل لترقيته إلى مسؤول منصّة.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Input
            className="max-w-sm"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={promoting}
          />
          <Button onClick={handlePromote} disabled={promoting || !email.trim()}>
            {promoting ? "جارٍ..." : "ترقية"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">التخلي عن المسؤولية</h2>
        <p className="text-sm text-muted-foreground">
          ستفقد صلاحيات مسؤول المنصّة. لا يمكن لآخر مسؤول التخلي عن دوره.
        </p>
        <Button
          variant="destructive"
          disabled={selfIsLast || abandoning}
          onClick={() => setConfirmAbandon(true)}
        >
          التخلي عن المسؤولية
        </Button>
        {selfIsLast && (
          <p className="text-xs text-destructive">
            لا يمكنك التخلي لأنك آخر مسؤول. قم بترقية مستخدم آخر أولاً.
          </p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">نقل المسؤولية (اختياري)</summary>
          <ol className="mt-2 list-decimal ps-5 space-y-1">
            <li>قم بترقية المستخدم الهدف عبر بريده الإلكتروني.</li>
            <li>ثم تخلَّ عن مسؤوليتك.</li>
          </ol>
        </details>
      </section>

      <AlertDialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد التخلي</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم سحب صلاحياتك كمسؤول منصّة. لن تتمكن من الدخول إلى هذه الصفحة بعد ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={abandoning}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={abandoning}
              onClick={(e) => {
                e.preventDefault();
                handleAbandon();
              }}
            >
              {abandoning ? "جارٍ..." : "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
