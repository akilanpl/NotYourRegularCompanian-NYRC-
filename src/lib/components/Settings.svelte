<script lang="ts">
  import { version } from "../../../package.json";
  const releaseChannel = import.meta.env.DEV ? "Development" : version.includes("-rc.") ? "Release candidate" : "Stable";
  import SavedSetups from "./SavedSetups.svelte";
  import PocketTray from "./PocketTray.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { api, type Settings } from "../bridge/api";
  import { invoke, emit, listen } from "../bridge/tauri";
  import BodyDiagnostics from "./BodyDiagnostics.svelte";
  import { bodyCore } from "../body/session";
  import type { BodyStatus } from "../body/core";
  import {
    presets,
    normalizeName,
    providerState,
  } from "../product/presentation";
  const sections = [
    "General",
    "Companion",
    "AI",
    "Calendar",
    "Permissions",
    "Notifications",
    "Pocket",
    "Devices",
    "Advanced",
    "About",
  ];
  let notices = $state<{ license: string; notices: string } | null>(null);
  let tab = $state("General");
  let settings = $state<Settings | null>(null);
  let message = $state("");
  let error = $state("");
  let key = $state("");
  let test = $state("");
  let busy = $state(false);
  let diagnostics = $state<unknown>(null);
  let bodies = $state<BodyStatus[]>([]);
  let localBodies = $state<BodyStatus[]>(bodyCore.diagnostics());
  let calendar = $state({
    calendarId: "primary",
    clientId: "",
    enabled: false,
  });
  let secret = $state("");
  let refresh = $state("");
  async function load() {
    try {
      settings = await api.getSettings();
      calendar = await invoke<typeof calendar>("get_calendar_config");
      diagnostics = await invoke("get_diagnostics");
    } catch {
      error = "Couldn’t load settings. Local commands remain available.";
    }
  }
  onMount(() => {
    document.body.classList.add("settings-page");
    void load();
    let disposed = false;
    const offLocal = bodyCore.subscribe(
      () => (localBodies = bodyCore.diagnostics()),
    );
    let off: (() => void) | undefined;
    void listen<BodyStatus[]>("body:diagnostics", (s) => (bodies = s)).then(
      (f) => {
        if (disposed) {
          f();
          return;
        }
        off = f;
        void emit("body:diagnostics-request", {});
      },
    );
    return () => {
      disposed = true;
      offLocal();
      off?.();
      document.body.classList.remove("settings-page");
    };
  });
  async function save() {
    if (!settings) return;
    busy = true;
    error = "";
    try {
      settings.petName = normalizeName(settings.petName);
      settings = await api.saveSettings(settings);
      await emit("settings:changed", settings);
      message = "Saved";
    } catch {
      error = "Couldn’t save settings.";
    } finally {
      busy = false;
    }
  }
  async function saveKey() {
    if (!settings) return;
    await save();
    try {
      settings.cloudApiKeySet = await api.setCloudApiKey(key || null);
      message = "Credential updated securely";
    } catch {
      error = "Couldn’t update the credential.";
    } finally {
      key = "";
    }
  }
  async function testProvider() {
    test = "Testing";
    await save();
    try {
      await invoke("test_provider");
      test = "Connected";
    } catch (e) {
      test = /auth|401|403/i.test(String(e))
        ? "Authentication failed"
        : "Offline";
    }
  }
  async function saveCalendar() {
    try {
      await invoke("save_calendar_config", {
        config: calendar,
        clientSecret: secret || null,
        refreshToken: refresh || null,
      });
      message = "Calendar configuration saved";
    } catch {
      error = "Couldn’t save Calendar configuration.";
    } finally {
      secret = "";
      refresh = "";
    }
  }
  async function disconnectCalendar() {
    error = "";
    try {
      await invoke("disconnect_calendar");
      calendar = { calendarId: "primary", clientId: "", enabled: false };
      secret = ""; refresh = "";
      message = "Calendar disconnected; saved credentials removed";
    } catch { error = "Calendar disconnect was denied or unavailable."; }
  }
  async function exportMemories() {
    error = "";
    try { message = "Memory export saved: " + await api.exportMemories("json"); }
    catch { error = "Memory export was denied or unavailable."; }
  }
  function close() {
    void getCurrentWindow().hide();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") close();
  }}
/>
<main class="settings">
  <header>
    <div>
      <small>NYRC</small>
      <h1>Settings</h1>
    </div>
    <button aria-label="Close settings" onclick={close}>Close</button>
  </header>
  <nav aria-label="Settings sections">
    {#each sections as section}<button
        aria-current={tab === section ? "page" : undefined}
        onclick={() => {
          tab = section;
          message = "";
          error = "";
        }}>{section}</button
      >{/each}
  </nav>
  {#if error}<p role="alert" class="card">{error}</p>{/if}
  {#if settings}<section class="card stack" aria-label={tab}>
      <h2>{tab}</h2>
      {#if tab === "General"}<p class="muted">
          Your companion stays nearby. Local commands work without a provider.
        </p>
        <label
          ><span>Keep above other windows</span><input
            type="checkbox"
            bind:checked={settings.alwaysOnTop}
          /></label
        ><label
          ><span>Remember interactions locally</span><input
            type="checkbox"
            bind:checked={settings.memoryEnabled}
          /></label
        >
        <SavedSetups />{:else if tab === "Companion"}<label
          >Instance name<input
            bind:value={settings.petName}
            maxlength="40"
          /></label
        ><label
          >Personality<select
            value={settings.personalityPreset}
            onchange={(e) => {
              const name = e.currentTarget.value as keyof typeof presets;
              settings!.personalityPreset = name;
              settings!.personality = { ...presets[name] };
            }}
            >{#each Object.keys(presets) as name}<option>{name}</option
              >{/each}</select
          ></label
        >
        <p class="muted">
          Balanced is measured and helpful. Quiet reduces initiative. Playful
          adds wit. Professional keeps things direct.
        </p>
        <details>
          <summary>Fine tune personality</summary
          >{#if settings.personality}{#each ["warmth", "humor", "verbosity", "initiative", "expressiveness"] as dimension}<label
                >{dimension}<input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.personality[
                    dimension as keyof typeof settings.personality
                  ]}
                  oninput={(e) => {
                    settings!.personality![
                      dimension as keyof NonNullable<Settings["personality"]>
                    ] = Number(e.currentTarget.value);
                  }}
                /></label
              >{/each}{/if}
        </details>
      {:else if tab === "AI"}<p>
          <strong
            >{providerState(
              settings.localOnlyMode,
              settings.cloudApiKeySet,
              settings.llmProvider,
              test,
            )}</strong
          >
        </p>
        <label
          >AI mode<select
            value={settings.localOnlyMode ? "local" : settings.llmProvider}
            onchange={(e) => {
              settings!.localOnlyMode = e.currentTarget.value === "local";
              settings!.llmProvider = settings!.localOnlyMode
                ? "none"
                : e.currentTarget.value;
              if (e.currentTarget.value === "gemini")
                settings!.cloudEndpoint =
                  "https://generativelanguage.googleapis.com/v1beta";
              else if (
                e.currentTarget.value === "openai" &&
                settings!.cloudEndpoint.includes("googleapis")
              )
                settings!.cloudEndpoint = "https://api.openai.com/v1";
              test = "";
            }}
            ><option value="local">Local only</option><option value="ollama"
              >Ollama</option
            ><option value="openai">OpenAI-compatible</option><option
              value="gemini">Gemini</option
            ></select
          ></label
        >
        {#if settings.localOnlyMode}<p class="muted">
            No AI provider needed. Timers, reminders, volume, aliases, modes and
            Pocket remain available.
          </p>{:else if settings.llmProvider === "ollama"}<label
            >Endpoint<input bind:value={settings.ollamaEndpoint} /></label
          ><label>Model<input bind:value={settings.ollamaModel} /></label
          >{:else}<label
            >Endpoint<input bind:value={settings.cloudEndpoint} /></label
          ><label>Model<input bind:value={settings.cloudModel} /></label>
          <p class="muted">
            Credential: {settings.cloudApiKeySet
              ? "Stored in macOS Keychain"
              : "Not configured"}
          </p>
          <label
            >New API key<input
              type="password"
              autocomplete="new-password"
              bind:value={key}
              placeholder="Never shown after saving"
            /></label
          >
          <div class="row">
            <button disabled={!key} onclick={saveKey}>Save key</button><button
              onclick={() => {
                key = "";
                void saveKey();
              }}>Remove key</button
            >
          </div>{/if}
        {#if !settings.localOnlyMode}<button
            disabled={test === "Testing"}
            onclick={testProvider}
            >{test === "Testing" ? "Testing…" : "Test connection"}</button
          >{/if}
      {:else if tab === "Calendar"}<p>
          <strong
            >{calendar.enabled
              ? "Configured · connection requires a successful query"
              : "Calendar isn’t connected."}</strong
          >
        </p>
        <p class="muted">
          Google Calendar is optional. Add your OAuth client and refresh token;
          nothing is sent until you enable Calendar.
        </p>
        <label
          >Enable Calendar<input
            type="checkbox"
            bind:checked={calendar.enabled}
          /></label
        ><label>Calendar ID<input bind:value={calendar.calendarId} /></label
        ><label>OAuth client ID<input bind:value={calendar.clientId} /></label
        ><label
          >New client secret<input
            type="password"
            bind:value={secret}
            autocomplete="new-password"
          /></label
        ><label
          >New refresh token<input
            type="password"
            bind:value={refresh}
            autocomplete="new-password"
          /></label
        ><button onclick={saveCalendar}>Save Calendar setup</button>
        <button onclick={disconnectCalendar}>Disconnect and remove credentials</button>
        <p class="muted">
          Ask “what’s tomorrow?” to retrieve events. Use Calendar actions in the
          assistant to review and confirm changes.
        </p>
      {:else if tab === "Permissions"}<p>
          Clipboard reads ask each time. Calendar changes and AI-proposed
          application opens pause for approval.
        </p>
        <p class="muted">
          Allow once applies to that action only. Deny cancels it. No background
          clipboard monitoring.
        </p>
      {:else if tab === "Notifications"}<label
          >Desktop notifications<input
            type="checkbox"
            bind:checked={settings.desktopNotifications}
          /></label
        ><label
          >Interaction sounds<input
            type="checkbox"
            bind:checked={settings.soundEffects}
          /></label
        ><label
          >Occasional autonomous replies<input
            type="checkbox"
            bind:checked={settings.autonomousSpeech}
          /></label
        >
        <p class="muted">
          Critical reminders take priority. Quiet personality reduces
          initiative.
        </p>
      {:else if tab === "Pocket"}<p class="muted">
          Saved locally. Clipboard reads ask permission.
        </p>
        <PocketTray />
      {:else if tab === "Devices"}<p>
          <strong>Desktop body</strong> · Connected
        </p>
        {#each [...bodies, ...localBodies].filter((b) => b.bodyId !== "desktop") as body}<div
          >
            <strong
              >{body.bodyId === "virtual"
                ? "Virtual body"
                : "External device"}</strong
            >
            · {body.connected ? "Connected" : "Disconnected"}<small>
              · v{body.version}{body.batteryPercent !== undefined
                ? " · " + body.batteryPercent + "% battery"
                : ""}</small
            >
          </div>{/each}
        <p class="muted">
          Device disconnection doesn’t interrupt local features. Simulator and
          pairing tools are in Advanced.
        </p>
      {:else if tab === "Advanced"}<label
          >Allow desktop roaming<input
            type="checkbox"
            bind:checked={settings.desktopRoaming}
          /></label
        ><label
          >Developer event bridge<input
            type="checkbox"
            bind:checked={settings.developerEventLog}
          /></label
        >
        <button onclick={exportMemories}>Export memories as JSON</button>
        <p class="muted">For a full reset, remove AI keys and disconnect Calendar, quit NYRC, then back up and move the storage folder shown below.</p>
        <details>
          <summary>Storage and capabilities</summary>
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>
      {:else}<h1>NYRC</h1>
        <p>Not Your Regular Companion</p>
        <p>Version {version} · {releaseChannel} · MIT License</p>
        <p class="muted">
          Settings, memories and Pocket live in your local application data
          folder. Cloud requests use your selected provider. Credentials stay in
          the operating system keychain.
        </p>
        <details>
          <summary
            onclick={() => {
              void invoke<{ license: string; notices: string }>(
                "get_product_notices",
              ).then((v) => (notices = v)).catch(() => { notices = {license:"License unavailable. See bundled Resources.",notices:"Third-party notices unavailable."}; });
            }}>License & third-party notices</summary
          >
          <p>
            MIT © 2026 cskwork. Portions derive from an MIT-licensed desktop
            companion. The full LICENSE and THIRD_PARTY_NOTICES.md are included
            in the app Resources folder.
          </p>
          {#if notices}<pre>{notices.license}
{notices.notices}</pre>{/if}
        </details>{/if}
      {#if !["About", "Devices", "Permissions", "Pocket", "Calendar"].includes(tab)}<button
          class="primary"
          disabled={busy}
          onclick={save}>{busy ? "Saving…" : "Save settings"}</button
        >{/if}
      <div hidden={tab !== "Advanced"}><BodyDiagnostics /></div>
      {#if message}<p role="status">{message}</p>{/if}
    </section>{:else if !error}<p class="card" role="status">
      Loading local settings…
    </p>{/if}
</main>

<style>
  .settings {
    padding: 22px;
    max-width: 680px;
    margin: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  header h1 {
    margin: 0;
  }
  nav {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  nav button {
    font-size: 12px;
  }
  nav [aria-current="page"] {
    background: #a9c6de;
    color: #111820;
  }
  input[type="checkbox"] {
    width: 20px;
    min-height: 20px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 11px;
    max-height: 300px;
    overflow: auto;
  }
  @media (max-width: 400px) {
    .settings {
      padding: 12px;
    }
  }
</style>
