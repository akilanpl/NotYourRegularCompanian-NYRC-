import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import CharacterRenderer from "./CharacterRenderer.svelte";
import AssistantInput from "./AssistantInput.svelte";
import Startup from "./Startup.svelte";
import SavedSetups from "./SavedSetups.svelte";
import PocketTray from "./PocketTray.svelte";
import { AssistantRuntime } from "../assistant/runtime";
import { TimerService } from "../tasks/timerService";
import { COMPANION_EXPRESSIONS } from "../character";
describe("product surfaces", () => {
  it.each(COMPANION_EXPRESSIONS)(
    "exposes %s to assistive technology",
    (expression) => {
      const { body } = render(CharacterRenderer, { props: { expression } });
      expect(body).toContain(`Companion: ${expression}`);
      expect(body).toContain("<svg");
      expect(body).not.toContain("<img");
    },
  );
  it("renders a labeled command form and concise hints", () => {
    const { body } = render(AssistantInput, {
      props: {
        runtime: new AssistantRuntime(new TimerService()),
        entities: () => ({}),
        onResult: () => {},
        onThinking: () => {},
      },
    });
    expect(body).toContain("nyrc-command");
    expect(body).toContain('type="submit"');
    expect(body).toContain('aria-live="polite"');
    expect(body).toContain("what’s tomorrow");
  });
  it("renders searchable Pocket without requiring clipboard access", () => {
    const { body } = render(PocketTray);
    expect(body).toContain("Search Pocket");
    expect(body).toContain("Your tray is empty");
    expect(body).toContain("Save clipboard");
    expect(body).not.toContain('type="password"');
  });
});

it("pauses clipboard access with equal named choices and no internal IDs", async () => {
  const runtime = new AssistantRuntime(new TimerService(), async () => null, [
    {
      canExecute: () => true,
      execute: async () => ({ ok: true, data: { content: "fixture" } }),
    },
  ]);
  const task = await runtime.execute(
    { id: "clipboard.read", payload: {}, permission: "sensitive" },
    "Read clipboard",
  );
  const { body } = render(AssistantInput, {
    props: {
      runtime,
      entities: () => ({}),
      onResult: () => {},
      onThinking: () => {},
    },
  });
  expect(body).toContain("Read clipboard once?");
  expect(body).toContain("Allow once");
  expect(body).toContain("Deny");
  expect(body).not.toContain(task.id);
  expect((await runtime.permission(task.id, true)).result).toEqual({
    content: "fixture",
  });
});
it("renders readable recent completed and denied task states", async () => {
  const runtime = new AssistantRuntime(new TimerService());
  await runtime.submit("what time is it");
  const task = await runtime.execute(
    { id: "clipboard.read", payload: {}, permission: "sensitive" },
    "Read clipboard",
  );
  await runtime.permission(task.id, false);
  const { body } = render(AssistantInput, {
    props: {
      runtime,
      entities: () => ({}),
      onResult: () => {},
      onThinking: () => {},
    },
  });
  expect(body).toContain("Complete");
  expect(body).toContain("Couldn’t complete");
  expect(body).not.toContain(task.id);
});

it("keeps alias and mode configuration available without exposing protocol syntax", () => {
  const { body } = render(SavedSetups);
  expect(body).toContain("Aliases &amp; modes");
  expect(body).toContain("Destination type");
  expect(body).toContain("Mode name");
  expect(body).not.toContain("bodyId");
});

it("shows migration preparation without prematurely mounting services", () => {
  const { body } = render(Startup, { props: { phase: "preparing" } });
  expect(body).toContain("Checking storage");
  expect(body).toContain("migrating existing data");
  expect(body).not.toContain("nyrc-command");
});
it("shows storage failure without sensitive diagnostic payloads", () => {
  const { body } = render(Startup, { props: { phase: "failed" } });
  expect(body).toContain("Existing data has been retained");
  expect(body).not.toContain("storagePath");
});

it("escapes model and external text through normal Svelte text rendering",async()=>{
 const {default:ChatBubble}=await import("./ChatBubble.svelte");
 const {body}=render(ChatBubble,{props:{text:'<script>alert("x")</script><img src=x onerror=alert(1)>',mood:"happy",side:"above"}});
 expect(body).not.toContain('<script>alert');expect(body).toContain('&lt;script');
});
