import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicComplaints } from "@/lib/complaints.functions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE, CATEGORIES } from "@/lib/i18n";
import { AttachmentThumb } from "./_authenticated/my-complaints";
import { Search, List, Map as MapIcon } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

const MapViewLazy = lazy(() => import("@/components/MapPicker").then((m) => ({ default: m.MapView })));

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "الشكاوى العامة | منصة الشكاوى" },
      { name: "description", content: "تصفح شكاوى المواطنين العامة بشكل شفّاف وعلني." },
    ],
  }),
  component: FeedPage,
});

const PAGE_SIZE = 12;

function FeedPage() {
  const [tab, setTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [committed, setCommitted] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listFn = useServerFn(listPublicComplaints);

  const category = tab === "all" ? null : (tab as any);

  const query = useInfiniteQuery({
    queryKey: ["public-complaints", category, committed],
    queryFn: ({ pageParam = 0 }) =>
      listFn({ data: { category, search: committed || null, limit: PAGE_SIZE, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE),
  });

  const items = query.data?.pages.flat() ?? [];

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
      <PublicHeader />

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold">الشكاوى العامة</h1>
        <p className="text-sm text-muted-foreground">للمشاركة والتعليق يجب تسجيل الدخول بحساب Google.</p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <form
            className="relative flex-1"
            onSubmit={(e) => { e.preventDefault(); setCommitted(search); }}
          >
            <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
            <Input className="pr-9" placeholder="ابحث بعنوان الشكوى" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="all">الكل</TabsTrigger>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>{CATEGORY_LABELS[c]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {query.isLoading ? (
          <div className="mt-8 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-xl border bg-card p-10 text-center text-muted-foreground">لا توجد شكاوى.</div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {items.map((c: any) => (
              <article key={c.id} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold">{c.title}</h2>
                  <Badge variant="outline" className={STATUS_BADGE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{CATEGORY_LABELS[c.category]}</Badge>
                  <span>مواطن • {new Date(c.created_at).toLocaleDateString("ar")}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground"><strong>الموقع:</strong> {c.address}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>
                {c.attachments?.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {c.attachments.map((a: any) => <AttachmentThumb key={a.id} a={a} />)}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <div ref={sentinel} className="h-10" />
        {query.isFetchingNextPage && <div className="text-center text-sm text-muted-foreground">تحميل المزيد...</div>}
      </main>
    </div>
  );
}
