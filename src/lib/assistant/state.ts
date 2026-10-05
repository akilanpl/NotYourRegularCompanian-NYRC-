export type StateSignals = {
  hour: number;
  successes?: number;
  failures?: number;
  activeReminders?: number;
  dismissed?: number;
  focusMode?: boolean;
  interactions?: number;
  repeatedInteractions?: number;
  calendarHours?: number;
  manual?: Partial<Dimensions>;
};
export type Dimensions = {
  valence: number;
  arousal: number;
  stress: number;
  focus: number;
  fatigue: number;
  engagement: number;
};
export function estimateState(s: StateSignals) {
  const factors: string[] = [];
  const d: Dimensions = {
    valence: 0.5,
    arousal: 0.4,
    stress: 0.2,
    focus: 0.35,
    fatigue: 0.2,
    engagement: 0.4,
  };
  if (s.hour >= 22 || s.hour < 6) {
    d.fatigue += 0.4;
    d.arousal -= 0.15;
    factors.push("late local hour");
  }
  if (s.focusMode) {
    d.focus += 0.45;
    factors.push("focus session active");
  }
  if (s.successes) {
    d.valence += Math.min(0.25, s.successes * 0.05);
    factors.push("recent tasks succeeded");
  }
  if (s.failures) {
    d.stress += Math.min(0.4, s.failures * 0.1);
    d.valence -= 0.15;
    factors.push("recent tasks failed");
  }
  if ((s.activeReminders ?? 0) > 5) {
    d.stress += 0.15;
    factors.push("several active reminders");
  }
  if ((s.dismissed ?? 0) > 3) {
    d.fatigue += 0.1;
    factors.push("several reminders dismissed");
  }
  if (s.interactions) {
    d.engagement += Math.min(0.4, s.interactions * 0.03);
    factors.push("recent interactions");
  }
  if ((s.repeatedInteractions ?? 0) > 3) {
    d.arousal += 0.1;
    factors.push("repeated recent interactions");
  }
  if ((s.calendarHours ?? 0) > 4) {
    d.stress += 0.15;
    d.fatigue += 0.1;
    factors.push("calendar workload");
  }
  for (const k of Object.keys(d) as (keyof Dimensions)[]) {
    const manual = s.manual?.[k];
    if (manual !== undefined && Number.isFinite(manual)) {
      d[k] = manual;
      factors.push(`manual ${k}`);
    }
    d[k] = Math.max(0, Math.min(1, d[k]));
  }
  const label =
    d.focus > 0.65
      ? "focused"
      : d.fatigue > 0.55
        ? "possibly tired"
        : d.stress > 0.5
          ? "possibly busy"
          : d.valence > 0.6
            ? "settled"
            : "neutral";
  return {
    label,
    confidence: Math.min(0.85, 0.35 + factors.length * 0.08),
    dimensions: d,
    factors,
  };
}
export function adaptation(s: ReturnType<typeof estimateState>) {
  return {
    quiet: s.dimensions.focus > 0.65,
    shortReplies: s.dimensions.fatigue > 0.55,
    reminderIntensity: s.factors.includes("several reminders dismissed")
      ? 0.65
      : 0.5,
  };
}
