export const CATEGORY_LABELS: Record<string, string> = {
  infrastructure: "البنية التحتية",
  public_lighting: "الإنارة العامة",
  cleanliness: "النظافة",
  other: "أخرى",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  in_progress: "قيد المعالجة",
  resolved: "تم الحل",
};

export const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  in_progress: "bg-info/15 text-info border-info/30",
  resolved: "bg-success/15 text-success border-success/30",
};

export const CATEGORIES = ["infrastructure", "public_lighting", "cleanliness", "other"] as const;
export const STATUSES = ["pending", "in_progress", "resolved"] as const;
