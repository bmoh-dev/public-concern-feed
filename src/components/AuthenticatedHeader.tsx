import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Bell,
  LogOut,
  ShieldCheck,
  Plus,
  ListChecks,
  LayoutDashboard,
  Building2,
  Check,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listNotifications,
  markNotificationsRead,
  deleteNotifications,
  getMyRole,
} from "@/lib/notifications.functions";
import { getPlatformBootstrapState } from "@/lib/platform.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export function AuthenticatedHeader() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [user, setUser] = useState<{ email?: string; name?: string; avatar?: string }>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (u) {
        setUser({
          email: u.email ?? undefined,
          name: (u.user_metadata?.full_name || u.user_metadata?.name) as string | undefined,
          avatar: u.user_metadata?.avatar_url as string | undefined,
        });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") qc.invalidateQueries();
      if (!session) navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, router, qc]);

  const logout = async () => {
    try {
      const { clearAllComplaintDrafts } = await import("@/routes/_authenticated/submit");
      clearAllComplaintDrafts();
    } catch {}
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };


  const roleFn = useServerFn(getMyRole);
  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const bootstrapFn = useServerFn(getPlatformBootstrapState);
  const { data: bootstrapState } = useQuery({
    queryKey: ["platform-bootstrap-state"],
    queryFn: () => bootstrapFn(),
  });
  const needsBootstrap = bootstrapState ? !bootstrapState.hasGlobalAdmin : false;
  const showPlatformLink = role?.isGlobalAdmin || needsBootstrap;

  return (
    <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur">
      <div className="container mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-bold">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="hidden sm:inline">منصة الشكاوى البلدية</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/submit">
              <Plus className="ms-1 h-4 w-4" /> شكوى جديدة
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/my-complaints">
              <ListChecks className="ms-1 h-4 w-4" /> شكاواي
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/feed">الشكاوى العامة</Link>
          </Button>
          {(role?.municipalities ?? []).some(
            (m: any) => m.role === "admin" || m.role === "super_admin",
          ) && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin">
                <LayoutDashboard className="ms-1 h-4 w-4" /> إدارة البلدية
              </Link>
            </Button>
          )}
          {role?.isDepartmentAdmin && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/department">
                <Building2 className="ms-1 h-4 w-4" /> القسم
              </Link>
            </Button>
          )}
          {showPlatformLink && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/platform-admin">إدارة المنصّة</Link>
            </Button>
          )}


          <NotificationsMenu />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-primary/15" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{user.name ?? "مستخدم"}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut className="ms-2 h-4 w-4" /> تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  );
}

function NotificationsMenu() {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationsRead);
  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn(),
    refetchInterval: 15000,
  });

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const topic = `user:${uid}`;
      for (const c of supabase.getChannels()) {
        if (c.topic === `realtime:${topic}` || c.topic === topic) {
          supabase.removeChannel(c);
        }
      }
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
            qc.invalidateQueries({ queryKey: ["my-complaints"] });
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  const unread = notifs.filter((n) => !n.read).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>الإشعارات</span>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await markFn({ data: {} });
                qc.invalidateQueries({ queryKey: ["notifications"] });
              }}
            >
              تعليم الكل كمقروء
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifs.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">لا توجد إشعارات</div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {notifs.map((n) => (
            <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                {!n.read && (
                  <Badge variant="default" className="text-[10px]">
                    جديد
                  </Badge>
                )}
              </div>
              {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
              <div className="text-[10px] text-muted-foreground">
                {new Date(n.created_at).toLocaleString("ar")}
              </div>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
