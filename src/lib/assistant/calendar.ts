import { invoke } from "../bridge/tauri";
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  allDay?: boolean;
  description?: string;
  location?: string;
};
export type CalendarQuery = { start: string; end: string };
export type CalendarCreateInput = Omit<CalendarEvent, "id">;
export type CalendarUpdateInput = CalendarCreateInput & { id: string };
export interface CalendarProvider {
  list(q: CalendarQuery): Promise<CalendarEvent[]>;
  get(id: string): Promise<CalendarEvent>;
  create(i: CalendarCreateInput): Promise<CalendarEvent>;
  update(i: CalendarUpdateInput): Promise<CalendarEvent>;
  delete(id: string): Promise<void>;
}
export function validateCalendar(i: CalendarCreateInput) {
  if (
    !i.title.trim() ||
    i.title.length > 200 ||
    !Number.isFinite(Date.parse(i.start)) ||
    !Number.isFinite(Date.parse(i.end)) ||
    Date.parse(i.end) <= Date.parse(i.start)
  )
    throw Error("Invalid calendar event");
  new Intl.DateTimeFormat("en", { timeZone: i.timezone });
}
export class MockCalendarProvider implements CalendarProvider {
  private events = new Map<string, CalendarEvent>();
  private n = 0;
  async list(q: CalendarQuery) {
    return [...this.events.values()].filter(
      (e) =>
        Date.parse(e.start) < Date.parse(q.end) &&
        Date.parse(e.end) > Date.parse(q.start),
    );
  }
  async get(id: string) {
    const e = this.events.get(id);
    if (!e) throw Error("Event not found");
    return { ...e };
  }
  async create(i: CalendarCreateInput) {
    validateCalendar(i);
    const e = { ...i, id: `event-${++this.n}` };
    this.events.set(e.id, e);
    return { ...e };
  }
  async update(i: CalendarUpdateInput) {
    await this.get(i.id);
    validateCalendar(i);
    this.events.set(i.id, { ...i });
    return { ...i };
  }
  async delete(id: string) {
    await this.get(id);
    this.events.delete(id);
  }
}
/** Schedules deterministic notifications from an explicit calendar fetch. No AI polling. */
export class CalendarProactivity {
  private handles: ReturnType<typeof setTimeout>[] = [];
  private announced = new Set<string>();
  constructor(private notify: (message: string) => void) {}
  load(events: CalendarEvent[], now = Date.now()) {
    this.dispose();
    for (const e of events) {
      const delay = Date.parse(e.start) - now - 300000;
      if (delay >= 0 && delay < 2147000000)
        this.handles.push(
          setTimeout(() => this.notify(`Upcoming: ${e.title}`), delay),
        );
    }
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (
          Date.parse(events[i].start) < Date.parse(events[j].end) &&
          Date.parse(events[j].start) < Date.parse(events[i].end)
        ) {
          const key = [events[i], events[j]]
            .map((e) => `${e.id}:${e.start}:${e.end}`)
            .sort()
            .join("|");
          if (this.announced.has(key)) continue;
          this.announced.add(key);
          if (this.announced.size > 1000)
            this.announced.delete(this.announced.values().next().value!);
          this.notify(
            `Calendar overlap: ${events[i].title} and ${events[j].title}`,
          );
        }
      }
    }
  }
  dispose() {
    for (const h of this.handles) clearTimeout(h);
    this.handles = [];
  }
}

export class GoogleCalendarProvider implements CalendarProvider {
  private request<T>(action: string, payload: unknown): Promise<T> {
    return invoke<T>("assistant_service", { action, payload });
  }
  list(q: CalendarQuery) {
    return this.request<CalendarEvent[]>("calendar.list", q);
  }
  get(id: string) {
    return this.request<CalendarEvent>("calendar.get", { id });
  }
  create(i: CalendarCreateInput) {
    validateCalendar(i);
    return this.request<CalendarEvent>("calendar.create", i);
  }
  update(i: CalendarUpdateInput) {
    validateCalendar(i);
    return this.request<CalendarEvent>("calendar.update", i);
  }
  async delete(id: string) {
    await this.request("calendar.delete", { id });
  }
}
