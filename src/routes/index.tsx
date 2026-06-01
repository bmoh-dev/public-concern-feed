import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ListChecks, FileText, Bell } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "بلدية - منصة الشكاوى" },
      { name: "description", content: "منصة بلدية لتقديم وتتبع الشكاوى وعرض الشفافية العامة." },
      { property: "og:title", content: "بلدية - منصة الشكاوى" },
      { property: "og:description", content: "منصة بلدية لتقديم وتتبع الشكاوى وعرض الشفافية العامة." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="border-b bg-gradient-to-b from-accent/40 to-background">
          <div className="container mx-auto max-w-6xl px-6 py-20 text-center">
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              صوتك مسموع — قدّم شكواك بشفافية ومسؤولية
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              منصة رسمية تتيح للمواطنين تقديم الشكاوى البلدية، متابعتها، ومشاهدة شكاوى المدينة بشكل علني.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/login">قدّم شكوى الآن</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/feed">تصفّح الشكاوى العامة</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 md:grid-cols-4">
            {[
              { icon: ShieldCheck, title: "هوية موثّقة", desc: "تسجيل آمن عبر حساب Google لضمان المساءلة." },
              { icon: FileText, title: "تقديم سريع", desc: "نموذج مبسّط مع إمكانية إرفاق صور وفيديوهات." },
              { icon: ListChecks, title: "تتبّع مباشر", desc: "تابع حالة شكواك من لوحة تحكّمك الخاصة." },
              { icon: Bell, title: "إشعارات فورية", desc: "تلقَّ إشعارات عند تحديث حالة الشكوى." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} منصة الشكاوى البلدية
      </footer>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b bg-card">
      <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span>منصة الشكاوى البلدية</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost"><Link to="/feed">الشكاوى العامة</Link></Button>
          <Button asChild><Link to="/login">دخول</Link></Button>
        </nav>
      </div>
    </header>
  );
}

// helper to avoid unused import warning during build dev redirects
void redirect;
