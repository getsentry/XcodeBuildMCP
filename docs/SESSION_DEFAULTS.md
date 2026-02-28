# Session Defaults

By default, XcodeBuildMCP uses a session-aware mode. The client sets shared defaults once (simulator, device, project/workspace, scheme, etc.) and all tools reuse them. This reduces schema size and repeated payloads and ensures a more deterministic experience.

## How it works
- Agent calls `session_set_defaults` once at the start of a workflow.
- Tools reuse those defaults automatically.
- Agent can call `session_show_defaults` to inspect current values.
- Agent can call `session_clear_defaults` to clear values when switching contexts.
- Defaults can be seeded from `.xcodebuildmcp/config.yaml` at server startup.

See the session-management tools in [TOOLS.md](TOOLS.md).

## Opting out
If you prefer explicit parameters on every tool call, set `disableSessionDefaults: true` in your `.xcodebuildmcp/config.yaml` file.

This restores the legacy schemas with per-call parameters while still honoring any defaults you choose to set.

See [CONFIGURATION.md](CONFIGURATION.md) for more information.

## Persisting defaults
Session defaults can be persisted between sessions by setting the `persist` flag to `true` on `session_set_defaults`. This writes to `.xcodebuildmcp/config.yaml` at the root of your workspace.

The persistence is patch-only: only keys provided in that call are written (plus any removals needed for mutual exclusivity).

You can also manually create the config file to essentially seed the defaults at startup; see [CONFIGURATION.md](CONFIGURATION.md) for more information.

## Namespaced profiles
Session defaults support named profiles so one workspace can keep separate defaults for iOS/watchOS/macOS (or any custom profile names).

- Use `session_use_defaults_profile` to switch the active profile (existing profiles only).
- Existing tools (`session_set_defaults`, `session_show_defaults`, build/test tools) use the active profile automatically.
- `session_set_defaults` can also accept `profile` to switch and set in one call; use `createIfNotExists: true` to create a new profile intentionally.
- Profiles are strictly isolated: values are not inherited from global defaults or other profiles.
- The unnamed global defaults profile exists for backwards compatibility and is the default active profile when no named profile is selected.
- There is always an active profile context: either a named profile or `global`.
- Use `global: true` to switch back to the unnamed global profile.
- Set `persist: true` on `session_use_defaults_profile` to write `activeSessionDefaultsProfile` in `.xcodebuildmcp/config.yaml`.

## Recommended startup flow (monorepo / multi-target)
Copy/paste this sequence when starting a new session:

```json
{"name":"session_use_defaults_profile","arguments":{"profile":"ios","persist":true}}
{"name":"session_set_defaults","arguments":{
  "workspacePath":"/repo/MyApp.xcworkspace",
  "scheme":"MyApp-iOS",
  "simulatorName":"iPhone 17 Pro",
  "persist":true
}}
{"name":"session_show_defaults","arguments":{}}
```

Switch targets later in the same session:

```json
{"name":"session_use_defaults_profile","arguments":{"profile":"watch","persist":true}}
{"name":"session_set_defaults","arguments":{
  "workspacePath":"/repo/MyApp.xcworkspace",
  "scheme":"MyApp-watchOS",
  "simulatorName":"Apple Watch Series 10 (45mm)",
  "persist":true
}}
```

Isolation example:
- Global profile has `workspacePath: /repo/MyApp.xcworkspace`
- Active profile is `watch` with only `scheme` set
- Result: `watch` does not see global `workspacePath` until you set it on `watch` or switch back to `global`

## Related docs
- Configuration options: [CONFIGURATION.md](CONFIGURATION.md)
- Tools reference: [TOOLS.md](TOOLS.md)
