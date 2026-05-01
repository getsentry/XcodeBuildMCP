# Investigation: Orphaned simctl OSLog processes when MCP server exits abnormally

**Issue:** [#382](https://github.com/getsentry/XcodeBuildMCP/issues/382)
**Date:** 2026-05-01
**Status:** Confirmed and fixed for simulator OSLog helpers.

## Summary

The issue described orphaned simulator helper processes after abnormal server exits. The final fix is deliberately narrow:

- `simctl spawn … log stream …` OSLog helpers are registry-backed and now reconciled safely across MCP/daemon restarts.
- `simctl launch --console-pty …` remains intentionally unregistered. It is tied to the launched app lifecycle, and adding a durable registry for it would overreach the accepted design.
- The old `src/utils/log_capture.ts` path was dead production code and has been removed.

The fix does not change public tool schemas.

## Final design

### OSLog helpers are workspace-scoped

Durable OSLog registry records now store owner identity as:

```ts
owner: {
  instanceId: string;
  pid: number;
  workspaceKey: string;
}
```

The `workspaceKey` is configured during MCP, CLI, and daemon startup from the same workspace-root hashing used by daemon socket paths. Existing internal records without `owner.workspaceKey` are treated as invalid and pruned. No registry versioning or migration was added.

### Reconciliation only reaps safe orphans

Startup reconciliation runs for both MCP server startup and daemon startup. It scans durable OSLog records and only stops a helper when all of these are true:

1. The record belongs to the current workspace.
2. The owner PID is not the current process.
3. The owner PID is no longer alive.
4. The helper process still matches the expected `simctl spawn … log stream …` command.

Records from other workspaces are skipped. Records owned by live processes are skipped, including live foreign MCP/daemon sessions in the same workspace.

### App-scoped cleanup is no longer global

`stop_app_sim` and relaunch cleanup still clean OSLog helpers for the target simulator/bundle, but only when the record is:

- owned by the current runtime instance, or
- in the same workspace with a dead owner PID.

This prevents one active session from killing another active session’s OSLog helper.

### Last-chance cleanup covers local live helpers

MCP lifecycle and daemon lifecycle now install synchronous `exit` cleanup for in-process OSLog sessions. This only signals locally known child processes; it does not perform async registry deletion. If a helper survives, the next startup reconciliation can reap it from the durable registry.

Daemon crash handling was also brought closer to MCP parity with `uncaughtException` and `unhandledRejection` handling that requests shutdown with a non-zero exit code.

### Dead log-capture path removed

`src/utils/log_capture.ts` duplicated old simulator log-capture behavior, but there were no production callers. It also left misleading lifecycle/status fields such as `activeLogSessions` and `simulatorLogSessionCount`.

Removed:

- `src/utils/log_capture.ts`
- `src/utils/__tests__/log_capture.test.ts`
- `src/utils/__tests__/log_capture_escape.test.ts`
- legacy re-exports from `src/utils/log-capture/index.ts`
- legacy shutdown/status references to `stopAllLogCaptures`, `activeLogSessions`, and `simulatorLogSessionCount`

## Why console-PTY is not registered

`simctl launch --console-pty --terminate-running-process …` is app-lifecycle-bound. It exists to capture the launched app’s stdout/stderr while the app is running. The accepted fix avoids adding a console-PTY registry because that would create a second durable lifecycle model for a helper whose lifetime is already coupled to the app launch.

The strategic cleanup surface is the OSLog helper registry, because OSLog helpers are detached, long-lived, and already have durable records that can be reconciled after abnormal exits.

## Verification expectations

Automated coverage should verify:

- OSLog registry records require `owner.workspaceKey`.
- records without `owner.workspaceKey` are pruned.
- same-workspace dead-owner OSLog helpers are reconciled.
- other-workspace records are skipped.
- same-workspace live-owner records are skipped.
- app-scoped cleanup skips live foreign owners.
- lifecycle snapshots and session status do not expose deleted legacy log-capture fields.
- synchronous exit cleanup signals only live local OSLog helpers.

Manual smoke testing should verify:

1. Clean shutdown stops helpers owned by the current server.
2. After `SIGKILL` of an MCP server, restarting in the same workspace reaps the orphaned `simctl spawn … log stream …` helper.
3. Two live sessions in the same workspace do not kill each other’s OSLog helpers.
4. Startup from workspace A does not kill workspace B helpers.
5. `stop_app_sim` does not kill live foreign-owner OSLog helpers.

## Known boundary

This fix does not promise to kill every possible `simctl launch --console-pty` process. That helper is intentionally not part of the durable OSLog registry. The implemented production safety guarantee is: workspace-scoped OSLog helpers are cleaned up without killing helpers owned by other live sessions.
