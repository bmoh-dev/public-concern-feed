import { Input } from "@/components/ui/input";

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label className="text-xs text-muted-foreground">من</label>
        <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label className="text-xs text-muted-foreground">إلى</label>
        <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
      </div>
    </>
  );
}