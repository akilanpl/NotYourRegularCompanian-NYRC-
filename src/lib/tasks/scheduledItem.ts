export const SCHEDULED_ITEM_KINDS = [
  "reminder",
  "alarm",
  "important_date",
] as const;
export type ScheduledItemKind = (typeof SCHEDULED_ITEM_KINDS)[number];

export const SCHEDULED_ITEM_STATUSES = [
  "scheduled",
  "triggered",
  "dismissed",
  "cancelled",
] as const;
export type ScheduledItemStatus = (typeof SCHEDULED_ITEM_STATUSES)[number];

export const SCHEDULED_RECURRENCES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;
export type ScheduledRecurrence = (typeof SCHEDULED_RECURRENCES)[number];

export type ScheduledItem = Readonly<{
  id: string;
  kind: ScheduledItemKind;
  title: string;
  message: string | null;
  scheduledAt: string;
  timezone: string | null;
  status: ScheduledItemStatus;
  recurrence: ScheduledRecurrence | null;
  metadata: unknown | null;
  createdAt: string;
  updatedAt: string;
  triggeredAt: string | null;
  dismissedAt: string | null;
}>;

export type CreateScheduledItemInput = Readonly<{
  kind: ScheduledItemKind;
  title: string;
  message?: string;
  scheduledAt: string;
  timezone?: string;
  recurrence?: ScheduledRecurrence;
  metadata?: unknown;
}>;

export type UpdateScheduledItemInput = Readonly<
  Omit<CreateScheduledItemInput, "kind">
>;

export type UserAlias = Readonly<{
  id: string;
  phrase: string;
  normalizedPhrase: string;
  targetType: "website" | "application" | "mode";
  target: string;
  createdAt: string;
  updatedAt: string;
}>;

export type UserAliasInput = Readonly<{
  phrase: string;
  targetType: UserAlias["targetType"];
  target: string;
}>;

export type AssistantMode = Readonly<{
  id: string;
  name: string;
  actions: unknown[];
  createdAt: string;
  updatedAt: string;
}>;

export type AssistantModeInput = Readonly<{
  name: string;
  actions: unknown[];
}>;
