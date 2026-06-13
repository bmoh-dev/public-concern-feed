import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  platformAdminListMunicipalities,
  platformAdminApprove,
  platformAdminReject,
} from "@/lib/municipalities.functions";
import { getMyRole } from "@/lib/notifications.functions";
import {
  getPlatformBootstrapState,
  bootstrapGlobalAdmin,
} from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  head: () => ({ meta: [{ title: "إدارة البلديات" }] }),
  beforeLoad: async () => {
    try {
      const role = await getMyRole();
      if (role.isGlobalAdmin) return;
      // Allow access if platform has not been initialized yet (bootstrap path)
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
  const listFn = useServerFn(platformAdminListMunicipalities);
  const approveFn = useServerFn(platformAdminApprove);
  const rejectFn = useServerFn(platformAdminReject);
  const bootstrapStateFn = useServerFn(getPlatformBootstrapState);
  const bootstrapFn = useServerFn(bootstrapGlobalAdmin);

  const { data: bootstrapState } = useQuery({
    queryKey: ["platform-bootstrap-state"],
    queryFn: () => bootstrapStateFn(),
  });
  const needsBootstrap = bootstrapState ? !bootstrapState.hasGlobalAdmin : false;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["platform-admin-municipalities"],
    queryFn: () => listFn(),
    enabled: !needsBootstrap && bootstrapState !== undefined,
  });

  if (needsBootstrap) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">إدارة المنصّة</h1>
        <div className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="text-xl font-semibold">تهيئة إدارة المنصّة</h2>
          <p className="text-sm text-muted-foreground">
            يمكن تنفيذ هذه العملية لمرة واحدة فقط.
          </p>
          <Button onClick={() => setConfirmOpen(true)}>بدء التهيئة</Button>
        </div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
                    setConfirmOpen(false);
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

  const [filter, setFilter] = useState<"all" | "pending" | "verified" | "rejected">("all");
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const filtered = data.filter((m: any) => filter === "all" || m.status === filter);

  const refresh = () => qc.invalidateQueries({ queryKey: ["platform-admin-municipalities"] });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">إدارة البلديات</h1>
      <div className="flex gap-2">
        {(["all", "pending", "verified", "rejected"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "الكل" : s === "pending" ? "قيد المراجعة" : s === "verified" ? "موثّقة" : "مرفوضة"}
          </Button>
        ))}
      </div>


      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد عناصر.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((m: any) => (
            <li key={m.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {m.name} <span className="text-muted-foreground">— {m.wilaya}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    المالك: {m.owner?.full_name || m.owner?.email || m.owner_user_id}
                  </div>
                  {m.rejection_reason && (
                    <div className="mt-1 text-xs text-destructive">سبب الرفض: {m.rejection_reason}</div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={
                    m.status === "verified"
                      ? "border-green-500 text-green-600"
                      : m.status === "rejected"
                        ? "border-destructive text-destructive"
                        : "border-amber-500 text-amber-600"
                  }
                >
                  {m.status}
                </Badge>
              </div>
              {m.status === "pending" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await approveFn({ data: { municipality_id: m.id } });
                        toast.success("تم الاعتماد");
                        refresh();
                      } catch (e: any) {
                        toast.error(e?.message || "فشل الاعتماد");
                      }
                    }}
                  >
                    اعتماد
                  </Button>
                  {reasonFor === m.id ? (
                    <>
                      <Input
                        className="max-w-xs"
                        placeholder="سبب الرفض"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          if (reason.trim().length < 3) return toast.error("اذكر سبباً واضحاً");
                          try {
                            await rejectFn({
                              data: { municipality_id: m.id, reason: reason.trim() },
                            });
                            toast.success("تم الرفض");
                            setReasonFor(null);
                            setReason("");
                            refresh();
                          } catch (e: any) {
                            toast.error(e?.message || "فشل الرفض");
                          }
                        }}
                      >
                        تأكيد الرفض
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReasonFor(null)}>
                        إلغاء
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setReasonFor(m.id)}>
                      رفض
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
