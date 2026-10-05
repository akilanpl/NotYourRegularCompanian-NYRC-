import { describe, expect, it } from "vitest";
import { DesktopAssistantExecutor, type DesktopAssistantBackend } from "./desktopAssistantExecutor";
import type { AssistantMode, AssistantModeInput, UserAlias, UserAliasInput } from "./scheduledItem";

const mode: AssistantMode = {
  id: "mode-1",
  name: "Study",
  actions: [
    { id: "system.volume.set", payload: { volume: 30 }, permission: "none" },
    { id: "web.open", payload: { url: "https://chatgpt.com" }, permission: "none" },
    { id: "app.open", payload: { application: "Antigravity" }, permission: "none" },
  ],
  createdAt: "",
  updatedAt: "",
};

const alias: UserAlias = {
  id: "alias-1",
  phrase: "youtube",
  normalizedPhrase: "youtube",
  targetType: "website",
  target: "https://youtube.com",
  createdAt: "",
  updatedAt: "",
};

function action(id: Parameters<DesktopAssistantExecutor["execute"]>[0]["id"], payload: unknown = {}) {
  return { id, payload, permission: "none" as const };
}

function backend(
  overrides: Partial<DesktopAssistantBackend> = {},
): DesktopAssistantBackend & { calls: string[] } {
  const calls: string[] = [];
  const base = {
    openWebsite: async (url: string) => { calls.push(`web:${url}`); },
    openApplication: async (app: string) => { calls.push(`app:${app}`); },
    getSystemVolume: async () => 40,
    setSystemVolume: async (volume: number) => {
      calls.push(`volume:${volume}`);
      return Math.max(0, Math.min(100, volume));
    },
    setSystemMute: async (muted: boolean) => {
      calls.push(`mute:${muted}`);
      return muted;
    },
    unsupportedDesktopCapability: async (capability: string) => {
      throw { code: "unsupported_on_current_platform", message: `${capability} unsupported` };
    },
    createAlias: async (input: UserAliasInput) => {
      calls.push(`alias:create:${input.phrase}`);
      return { ...alias, ...input };
    },
    listAliases: async () => [alias],
    updateAlias: async (_id: string, input: UserAliasInput) => {
      calls.push(`alias:update:${input.phrase}`);
      return { ...alias, ...input };
    },
    deleteAlias: async (id: string) => { calls.push(`alias:delete:${id}`); },
    listModes: async () => [mode],
    createMode: async (input: AssistantModeInput) => {
      calls.push(`mode:create:${input.name}`);
      return { ...mode, ...input };
    },
    updateMode: async (_id: string, input: AssistantModeInput) => {
      calls.push(`mode:update:${input.name}`);
      return { ...mode, ...input };
    },
    deleteMode: async (id: string) => { calls.push(`mode:delete:${id}`); },
    calls,
  };
  return { ...base, ...overrides };
}

describe("DesktopAssistantExecutor", () => {
  it("opens supported website and application through typed bridge operations", async () => {
    const backendStub = backend();
    const executor = new DesktopAssistantExecutor(backendStub);
    expect(await executor.execute(action("web.open", { url: "https://example.com" })))
      .toMatchObject({ ok: true });
    expect(await executor.execute(action("app.open", { application: "Safari" })))
      .toMatchObject({ ok: true });
    expect(backendStub.calls).toEqual([
      "web:https://example.com",
      "app:Safari",
    ]);
  });

  it("clamps volume operations and handles mute state correctly", async () => {
    const backendStub = backend();
    const executor = new DesktopAssistantExecutor(backendStub);
    expect(await executor.execute(action("system.volume.set", { volume: 150 })))
      .toMatchObject({ ok: true, data: { volume: 100 } });
    expect(await executor.execute(action("system.volume.decrease", { amount: 80 })))
      .toMatchObject({ ok: true, data: { volume: 0 } });
    expect(await executor.execute(action("system.volume.mute")))
      .toMatchObject({ ok: true, data: { muted: true } });
    expect(await executor.execute(action("system.volume.unmute")))
      .toMatchObject({ ok: true, data: { muted: false } });
    expect(await executor.execute(action("system.volume.set", { volume: Number.POSITIVE_INFINITY })))
      .toMatchObject({ ok: false, error: { code: "invalid_volume" } });
    expect(await executor.execute(action("system.volume.increase", { amount: -5 })))
      .toMatchObject({ ok: false, error: { code: "invalid_volume" } });
  });

  it("creates, updates, lists and deletes aliases and modes", async () => {
    const backendStub = backend();
    const executor = new DesktopAssistantExecutor(backendStub);
    expect(await executor.execute(action("alias.create", {
      phrase: "open docs",
      targetType: "website",
      target: "https://example.com",
    }))).toMatchObject({ ok: true });
    expect(await executor.execute(action("alias.update", {
      id: alias.id,
      phrase: "open updated docs",
      targetType: "website",
      target: "https://example.com",
    }))).toMatchObject({ ok: true });
    expect(await executor.execute(action("alias.list"))).toMatchObject({ ok: true });
    expect(await executor.execute(action("alias.delete", { id: alias.id })))
      .toMatchObject({ ok: true });
    expect(await executor.execute(action("mode.create", {
      name: "Quiet",
      actions: [],
    }))).toMatchObject({ ok: true });
    expect(await executor.execute(action("mode.update", {
      id: mode.id,
      name: "Quiet",
      actions: [],
    }))).toMatchObject({ ok: true });
    expect(await executor.execute(action("mode.delete", { id: mode.id })))
      .toMatchObject({ ok: true });
    expect(backendStub.calls).toEqual([
      "alias:create:open docs",
      "alias:update:open updated docs",
      `alias:delete:${alias.id}`,
      "mode:create:Quiet",
      "mode:update:Quiet",
      `mode:delete:${mode.id}`,
    ]);
  });

  it("resolves aliases by exact normalized phrase and reports unknown aliases", async () => {
    const backendStub = backend();
    const executor = new DesktopAssistantExecutor(backendStub);
    expect(await executor.execute(action("alias.execute", { phrase: "  YouTube " })))
      .toMatchObject({ ok: true, data: { opened: true } });
    expect(backendStub.calls).toEqual(["web:https://youtube.com"]);
    const missing = new DesktopAssistantExecutor({
      ...backendStub,
      listAliases: async () => [],
    });
    expect(await missing.execute(action("alias.execute", { phrase: "unknown" })))
      .toMatchObject({ ok: false, error: { code: "alias_not_found" } });
  });

  it("runs mode actions sequentially and preserves partial-success results", async () => {
    const calls: string[] = [];
    const backendStub = backend({
      setSystemVolume: async (value: number) => {
        calls.push(`volume:${value}`);
        return value;
      },
      unsupportedDesktopCapability: async (capability: string) => {
        calls.push(capability);
        throw { code: "unsupported_on_current_platform", message: "Not available" };
      },
      openWebsite: async (url: string) => { calls.push(`web:${url}`); },
      listModes: async () => [{
        ...mode,
        actions: [
          { id: "system.focus.enable", payload: {}, permission: "none" },
          { id: "system.volume.set", payload: { volume: 30 }, permission: "none" },
          { id: "web.open", payload: { url: "https://chatgpt.com" }, permission: "none" },
        ],
      }],
    });
    const result = await new DesktopAssistantExecutor(backendStub)
      .execute(action("mode.activate", { name: "study" }));
    expect(calls).toEqual([
      "system.focus.enable",
      "volume:30",
      "web:https://chatgpt.com",
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "partial_success", steps: [{ ok: false }, { ok: true }, { ok: true }] },
    });
  });

  it("fails a mode task when every configured step fails", async () => {
    const executor = new DesktopAssistantExecutor(backend({
      listModes: async () => [{
        ...mode,
        actions: [{ id: "system.focus.enable", payload: {}, permission: "none" }],
      }],
    }));
    expect(await executor.execute(action("mode.activate", { name: "Study" })))
      .toMatchObject({ ok: false, error: { code: "unsupported_on_current_platform" } });
  });

  it("reports media and Focus/DND as explicit unsupported capabilities", async () => {
    const executor = new DesktopAssistantExecutor(backend());
    expect(await executor.execute(action("media.next")))
      .toMatchObject({ ok: false, error: { code: "unsupported_on_current_platform" } });
    expect(await executor.execute(action("system.dnd.enable")))
      .toMatchObject({ ok: false, error: { code: "unsupported_on_current_platform" } });
    expect(executor.canExecute(action("calendar.create"))).toBe(false);
  });

  it("preserves plain-text persistence errors as structured task failures", async () => {
    const executor = new DesktopAssistantExecutor(backend({
      createAlias: async () => { throw "Alias phrase already exists"; },
    }));
    expect(await executor.execute(action("alias.create", {
      phrase: "already used",
      targetType: "website",
      target: "https://example.com",
    }))).toMatchObject({
      ok: false,
      error: { code: "assistant_action_failed", message: "Alias phrase already exists" },
    });
  });
});
