import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" && search.redirect.startsWith("/")
      ? search.redirect
      : "/my-complaints",
  }),
  head: () => ({ meta: [{ title: "تسجيل الدخول | منصة الشكاوى" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const redirectAfterAuth = () => {
      supabase.auth.getUser().then(({ data, error }) => {
        if (!error && data.user) navigate({ to: redirect as any, replace: true });
      });
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) redirectAfterAuth();
    });
    redirectAfterAuth();
    return () => sub.subscription.unsubscribe();
  }, [navigate, redirect]);

  const signIn = async () => {
    setLoading(true);
    const callbackUrl = new URL("/login", window.location.origin);
    callbackUrl.searchParams.set("redirect", redirect);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: callbackUrl.toString(),
    });
    if (result.error) {
      toast.error("تعذّر تسجيل الدخول");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-accent/40 to-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <ShieldCheck className="h-10 w-10 text-primary" />
          <h1 className="mt-3 text-2xl font-bold">تسجيل الدخول</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            استخدم حسابك في Google للمتابعة. سيتم توثيق هويتك تلقائياً لضمان مصداقية الشكاوى.
          </p>
        </div>
        <Button onClick={signIn} disabled={loading} size="lg" className="mt-6 w-full" variant="outline">
          <GoogleIcon /> <span className="ms-2">المتابعة باستخدام Google</span>
        </Button>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          بالعودة إلى <Link to="/" className="underline">الصفحة الرئيسية</Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5 44.5 36.3 44.5 25c0-1.5-.2-3-.9-4.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.6 8.9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.4 41 16.1 45.5 24 45.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C40.9 36 44.5 30.9 44.5 25c0-1.5-.2-3-.9-4.5z"/>
    </svg>
  );
}
