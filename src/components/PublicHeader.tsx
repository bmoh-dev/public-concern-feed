import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, LayoutDashboard, ListChecks, Plus, Building2 } from "lucide-react";
import { getMyRole } from "@/lib/notifications.functions";

type AuthState = { ready: boolean; userId: string | null };

export function PublicHeader() {
  const [auth, setAuth] = useState<AuthState>({ ready: false, userId: null });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAuth({ ready: true, userId: data.session?.user?.id ?? null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuth({ ready: true, userId: session?.user?.id ?? null });
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const roleFn = useServerFn(getMyRole);
  const { data: role } = useQuery({
    queryKey: ["my-role"],
    queryFn: () => roleFn(),
    enabled: auth.ready && !!auth.userId,
    staleTime: 60_000,
  });

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span>منصة الشكاوى البلدية</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link to="/feed">الشكاوى العامة</Link></Button>
          {auth.ready && auth.userId ? (
            <>
              <Button asChild variant="ghost" size="sm"><Link to="/submit"><Plus className="ms-1 h-4 w-4" /> شكوى جديدة</Link></Button>
              <Button asChild variant="ghost" size="sm"><Link to="/my-complaints"><ListChecks className="ms-1 h-4 w-4" /> شكاواي</Link></Button>
              {role?.isAdmin && (
                <Button asChild variant="ghost" size="sm"><Link to="/admin"><LayoutDashboard className="ms-1 h-4 w-4" /> الإدارة</Link></Button>
              )}
              {role?.isDepartmentAdmin && (
                <Button asChild variant="ghost" size="sm"><Link to="/department"><Building2 className="ms-1 h-4 w-4" /> القسم</Link></Button>
              )}
            </>
          ) : auth.ready ? (
            <Button asChild><Link to="/login">دخول</Link></Button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
