import { createFileRoute, redirect, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
import { FeedbackButton } from "@/components/FeedbackButton";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      router.invalidate();
      qc.invalidateQueries();
      if (!session) navigate({ to: "/login", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, router, qc]);

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedHeader />
      <main className="container mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <FeedbackButton />
    </div>
  );
}
