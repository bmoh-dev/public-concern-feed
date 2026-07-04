export const CATEGORY_LABELS: Record<string, string> = {
  infrastructure: "البنية التحتية",
  public_lighting: "الإنارة العامة",
  roads: "الطرقات",
  water_sewage: "المياه والصرف الصحي",
  cleanliness: "النفايات والنظافة",
  parks_green: "الحدائق والمساحات الخضراء",
  markets: "الأسواق",
  traffic_transport: "المرور والنقل",
  environment: "البيئة",
  public_health: "الصحة العامة",
  public_buildings: "المباني والمرافق العامة",
  other: "عامة",
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

export const CATEGORIES = [
  "infrastructure",
  "public_lighting",
  "roads",
  "water_sewage",
  "cleanliness",
  "parks_green",
  "markets",
  "traffic_transport",
  "environment",
  "public_health",
  "public_buildings",
  "other",
] as const;
export const STATUSES = ["pending", "in_progress", "resolved"] as const;
