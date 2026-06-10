import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyComplaints, getMyComplaint } from "@/lib/complaints.functions";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE, CATEGORIES, STATUSES } from "@/lib/i18n";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/my-complaints")({
  head: () => ({ meta: [{ title: "شكاواي | منصة الشكاوى" }] }),
  component: MyComplaintsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">خطأ: {error.message}</div>,
});

function MyComplaintsPage() {
  const listFn = useServerFn(listMyComplaints);
  const { data = [], isLoading } = useQuery({
    queryKey: ["my-complaints"],
    queryFn: () => listFn(),
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return data.filter((c: any) => {
      if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (status !== "all" && c.status !== status) return false;
      if (category !== "all" && c.category !== category) return false;
      if (from && new Date(c.created_at) < new Date(from)) return false;
      if (to && new Date(c.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [data, search, status, category, from, to]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">شكاواي</h1>
          <p className="text-sm text-muted-foreground">{data.length} شكوى مُقدّمة</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pr-9"
            placeholder="ابحث بالعنوان"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue placeholder="الفئة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفئات</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />

      </div>

      {isLoading ? (
        <div className="mt-6 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="mt-12 rounded-xl border bg-card p-10 text-center">
          <p className="text-muted-foreground">لا توجد شكاوى مطابقة.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="rounded-xl border bg-card p-4 text-right shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-muted-foreground">
                    {c.complaint_number}
                  </div>
                  <h3 className="line-clamp-1 font-semibold">{c.title}</h3>
                </div>
                <Badge variant="outline" className={STATUS_BADGE[c.status]}>
                  {STATUS_LABELS[c.status]}
                </Badge>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{CATEGORY_LABELS[c.category]}</Badge>
                <span>{new Date(c.created_at).toLocaleDateString("ar")}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <ComplaintDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ComplaintDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const getFn = useServerFn(getMyComplaint);
  const { data, isLoading } = useQuery({
    queryKey: ["my-complaint", id],
    queryFn: () => getFn({ data: { id: id! } }),
    enabled: !!id,
  });

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>تفاصيل الشكوى</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="p-4 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-muted-foreground">
                  {(data as any).complaint_number}
                </div>
                <h2 className="text-lg font-bold">{data.title}</h2>
              </div>
              <Badge variant="outline" className={STATUS_BADGE[data.status]}>
                {STATUS_LABELS[data.status]}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{CATEGORY_LABELS[data.category]}</Badge>
              <span className="text-muted-foreground">
                {new Date(data.created_at).toLocaleString("ar")}
              </span>
            </div>
            <Section title="العنوان">{data.address}</Section>
            <Section title="الوصف">{data.description}</Section>
            {data.attachments?.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">المرفقات</h4>
                <div className="grid grid-cols-3 gap-2">
                  {data.attachments.map((a: any) => (
                    <AttachmentThumb key={a.id} a={a} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>
      <div className="mt-1 whitespace-pre-wrap text-sm">{children}</div>
    </div>
  );
}

export function AttachmentThumb({
  a,
}: {
  a: { storage_path: string; mime_type: string; file_name: string };
}) {
  const url = supabase.storage.from("complaint-attachments").getPublicUrl(a.storage_path)
    .data.publicUrl;
  const isImage = a.mime_type.startsWith("image/");
  const isVideo = a.mime_type.startsWith("video/");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded border bg-muted"
    >
      {isImage ? (
        <img src={url} alt={a.file_name} className="h-24 w-full object-cover" />
      ) : isVideo ? (
        <video src={url} className="h-24 w-full object-cover" />
      ) : (
        <div className="flex h-24 items-center justify-center text-xs">{a.file_name}</div>
      )}
    </a>
  );
}
