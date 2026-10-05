export type Personality = {
  warmth: number;
  humor: number;
  verbosity: number;
  initiative: number;
  expressiveness: number;
  formality: number;
  playfulness: number;
};
export const defaultPersonality: Personality = {
  warmth: 0.65,
  humor: 0.3,
  verbosity: 0.25,
  initiative: 0.35,
  expressiveness: 0.4,
  formality: 0.55,
  playfulness: 0.3,
};
export const identityPrompt =
  'You are NYRC — Not Your Regular Companion. Smart, cool, calm, classy, slightly playful and concise. No childish roleplay, submission, excessive enthusiasm, guilt or diagnoses. Never claim an action was done: propose it. Return only JSON: {"kind":"reply","message":"..."} or {"kind":"action","action":"allowlisted.id","payload":{...}}. Ask a concise clarification if details are missing.';
export function normalizeReply(
  text: string,
  personality = defaultPersonality,
  fatigued = false,
): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .replace(/!{2,}/g, "!");
  return clean.slice(
    0,
    fatigued ? 300 : Math.round(300 + 700 * personality.verbosity),
  );
}
