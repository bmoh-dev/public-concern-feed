import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyOnboardingState,
  listVerifiedMunicipalities,
  createMunicipality,
  joinMunicipality,
} from "@/lib/municipalities.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Building2, Plus, Check, Clock, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "اختر بلديتك | منصة الشكاوى" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "create" ? ("create" as const) : undefined,
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const stateFn = useServerFn(getMyOnboardingState);
  const listFn = useServerFn(listVerifiedMunicipalities);
  const createFn = useServerFn(createMunicipality);
  const joinFn = useServerFn(joinMunicipality);

  const { data: state } = useQuery({ queryKey: ["onboarding"], queryFn: () => stateFn() });
  const { data: verified = [] } = useQuery({
    queryKey: ["verified-municipalities"],
    queryFn: () => listFn(),
  });

  const search = Route.useSearch();
  const [mode, setMode] = useState<"choose" | "create">(
    search.mode === "create" ? "create" : "choose",
  );
  const [name, setName] = useState("");
  const [wilaya, setWilaya] = useState("");
  const [busy, setBusy] = useState(false);

  // If user already has a membership, kick to home
  if (state && state.municipalities.length > 0) {
    navigate({ to: "/my-complaints", replace: true });
    return null;
  }


  const handleJoin = async (id: string) => {
    setBusy(true);
    try {
      await joinFn({ data: { municipality_id: id } });
      toast.success("تم الانضمام بنجاح");
      await qc.invalidateQueries();
      navigate({ to: "/my-complaints" });
    } catch (e: any) {
      toast.error(e?.message || "فشل الانضمام");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFn({ data: { name: name.trim(), wilaya: wilaya.trim() } });
      toast.success("تم إرسال الطلب — بانتظار اعتماد الإدارة");
      setName("");
      setWilaya("");
      setMode("choose");
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
    } catch (e: any) {
      toast.error(e?.message || "فشل الإنشاء");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">أهلاً بك</h1>
        <p className="text-sm text-muted-foreground">
          اختر بلديتك للمتابعة، أو سجّل بلدية جديدة (تحتاج اعتماد الإدارة).
        </p>
      </div>

      {state?.pendingOwned.map((p: any) => (
        <div key={p.id} className="rounded-xl border bg-card p-5">
          <div className="flex items-start gap-3">
            {p.status === "pending" ? (
              <Clock className="h-5 w-5 text-amber-500" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            <div className="flex-1">
              <div className="font-medium">
                {p.name} — {p.wilaya}
              </div>
              <div className="text-sm text-muted-foreground">
                {p.status === "pending"
                  ? "طلبك قيد المراجعة من إدارة المنصة."
                  : `تم رفض الطلب${p.rejection_reason ? `: ${p.rejection_reason}` : ""}`}
              </div>
            </div>
          </div>
        </div>
      ))}

      {mode === "choose" ? (
        <>
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">الانضمام إلى بلدية موثّقة</h2>
            {verified.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد بلديات موثّقة حالياً.</p>
            ) : (
              <ul className="space-y-2">
                {verified.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <div className="font-medium">
                        <Building2 className="me-1 inline h-4 w-4" />
                        {m.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.wilaya}</div>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => handleJoin(m.id)}>
                      <Check className="ms-1 h-4 w-4" /> انضمام
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button variant="outline" className="w-full" onClick={() => setMode("create")}>
            <Plus className="ms-1 h-4 w-4" /> تسجيل بلدية جديدة
          </Button>
        </>
      ) : (
        <form onSubmit={handleCreate} className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">تسجيل بلدية جديدة</h2>
          <div>
            <Label>اسم البلدية</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div>
            <Label>الولاية</Label>
            <Input
              value={wilaya}
              onChange={(e) => setWilaya(e.target.value)}
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              إرسال الطلب
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
              إلغاء
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            بعد إرسال الطلب، تتم مراجعته من إدارة المنصة قبل النشر للعامة.
          </p>
        </form>
      )}
    </div>
  );
}
