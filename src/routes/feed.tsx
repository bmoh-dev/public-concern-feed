import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicComplaints } from "@/lib/complaints.functions";
import { listVerifiedMunicipalities } from "@/lib/municipalities.functions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE, CATEGORIES } from "@/lib/i18n";
import { AttachmentThumb } from "./_authenticated/my-complaints";
import { Search, List, Map as MapIcon } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const MapViewLazy = lazy(() =>
  import("@/components/MapPicker").then((m) => ({ default: m.MapView })),
);

export const Route = createFileRoute("/feed")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ m: z.string().uuid().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "الشكاوى العامة | منصة الشكاوى" },
      { name: "description", content: "تصفح شكاوى المواطنين العامة بشكل شفّاف وعلني." },
    ],
  }),
  component: FeedPage,
});

const PAGE_SIZE = 12;

type ComplaintPage = { rows: any[]; rateLimitMessage: string | null };

function normalizeComplaintPage(page: ComplaintPage | any[]): ComplaintPage {
  return Array.isArray(page) ? { rows: page, rateLimitMessage: null } : page;
}

function FeedPage() {
  const { m: searchMunicipality } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [tab, setTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [committed, setCommitted] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setIsAuthed(!!s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);
  const listFn = useServerFn(listPublicComplaints);
  const munFn = useServerFn(listVerifiedMunicipalities);

  const { data: municipalities = [] } = useQuery({
    queryKey: ["verified-municipalities"],
    queryFn: () => munFn(),
  });

  const municipalityId = searchMunicipality || municipalities[0]?.id || "";

  const category = tab === "all" ? null : (tab as any);

  const query = useInfiniteQuery({
    queryKey: ["public-complaints", municipalityId, category, committed],
    enabled: !!municipalityId,
    queryFn: ({ pageParam = 0 }) =>
      listFn({
        data: {
          municipality_id: municipalityId,
          category,
          search: committed || null,
          limit: PAGE_SIZE,
          offset: pageParam,
        },
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      normalizeComplaintPage(last).rows.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });


  const normalizedPages = query.data?.pages.map(normalizeComplaintPage) ?? [];
  const items = normalizedPages.flatMap((page) => page.rows);
  const rateLimitMessage =
    normalizedPages.find((page) => page.rateLimitMessage)?.rateLimitMessage ?? null;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinel.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    });
    obs.observe(sentinel.current);
    return () => obs.disconnect();
  }, [query]);

  return (
    <div className="min-h-screen bg-background">
      {isAuthed ? <AuthenticatedHeader /> : <PublicHeader />}

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold">الشكاوى العامة</h1>
        <p className="text-sm text-muted-foreground">
          للمشاركة والتعليق يجب تسجيل الدخول بحساب Google.
        </p>

        <div className="mt-4 max-w-md">
          <label className="text-sm font-medium">البلدية</label>
          <Select
            value={municipalityId}
            onValueChange={(v) => navigate({ search: { m: v }, replace: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="اختر بلدية للعرض" />
            </SelectTrigger>
            <SelectContent>
              {municipalities.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name} — {m.wilaya}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!municipalityId && (
          <div className="mt-6 rounded-xl border bg-card p-6 text-center text-muted-foreground">
            اختر بلدية لعرض الشكاوى.
          </div>
        )}


        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setCommitted(search);
            }}
          >
            <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pr-9"
              placeholder="ابحث بعنوان الشكوى"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="inline-flex rounded-md border bg-card p-1">
            <Button
              type="button"
              variant={view === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("list")}
            >
              <List className="ms-1 h-4 w-4" /> قائمة
            </Button>
            <Button
              type="button"
              variant={view === "map" ? "default" : "ghost"}
              size="sm"
              onClick={() => setView("map")}
            >
              <MapIcon className="ms-1 h-4 w-4" /> خريطة
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-4" dir="rtl">
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="all">الكل</TabsTrigger>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {rateLimitMessage && (
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {rateLimitMessage}
          </div>
        )}

        {query.isLoading ? (
          <div className="mt-8 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-xl border bg-card p-10 text-center text-muted-foreground">
            لا توجد شكاوى.
          </div>
        ) : view === "map" ? (
          <div className="mt-4">
            <Suspense
              fallback={
                <div className="text-center text-sm text-muted-foreground">
                  جارٍ تحميل الخريطة...
                </div>
              }
            >
              <MapViewLazy
                items={items.map((c: any) => ({
                  id: c.id,
                  complaint_number: c.complaint_number ?? null,
                  title: c.title,
                  status: STATUS_LABELS[c.status] ?? c.status,
                  latitude: c.latitude ?? null,
                  longitude: c.longitude ?? null,
                }))}

                onSelect={(id) => setSelectedId(id)}
              />
            </Suspense>
            {selectedId &&
              (() => {
                const c: any = items.find((x: any) => x.id === selectedId);
                if (!c) return null;
                return (
                  <article className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {c.complaint_number}
                        </div>
                        <h2 className="font-bold">{c.title}</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={STATUS_BADGE[c.status]}>
                          {STATUS_LABELS[c.status]}
                        </Badge>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                          إغلاق
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{CATEGORY_LABELS[c.category]}</Badge>
                      <span>مواطن • {new Date(c.created_at).toLocaleDateString("ar")}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      <strong>الموقع:</strong> {c.address}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>
                    {c.attachments?.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {c.attachments.map((a: any) => (
                          <AttachmentThumb key={a.id} a={a} />
                        ))}
                      </div>
                    )}
                  </article>

                );
              })()}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {items.map((c: any) => (
              <article key={c.id} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {c.complaint_number}
                    </div>
                    <h2 className="font-bold">{c.title}</h2>
                  </div>
                  <Badge variant="outline" className={STATUS_BADGE[c.status]}>
                    {STATUS_LABELS[c.status]}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{CATEGORY_LABELS[c.category]}</Badge>
                  <span>مواطن • {new Date(c.created_at).toLocaleDateString("ar")}</span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">
                  <strong>الموقع:</strong> {c.address}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>
                {c.attachments?.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {c.attachments.map((a: any) => (
                      <AttachmentThumb key={a.id} a={a} />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {view === "list" && <div ref={sentinel} className="h-10" />}
        {view === "list" && query.isFetchingNextPage && (
          <div className="text-center text-sm text-muted-foreground">تحميل المزيد...</div>
        )}
      </main>
    </div>
  );
}
