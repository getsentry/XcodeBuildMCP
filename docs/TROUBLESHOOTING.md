# Troubleshooting

## Quick triage
- Run the doctor tool and include output when filing issues.
- Confirm Xcode and Command Line Tools are installed.
- Verify required workflows are enabled in configuration.
- Check simulator/device availability and permissions.

## Doctor tool
The doctor tool checks system configuration and reports dependency/capability status for key XcodeBuildMCP workflows and runtime features.

```bash
npx --package xcodebuildmcp@latest xcodebuildmcp-doctor
```

It reports on:
- System and Node.js environment
- Xcode installation and configuration
- Dependency and capability status (xcodebuild, AXe, debugger/backend requirements, etc.)
- Environment variables affecting XcodeBuildMCP
- Feature availability status

> [!NOTE]
> You can also ask you agent to run the doctor tool which will provide a more representative output.

## Common issues

### UI automation reports missing AXe
UI automation (describe/tap/swipe/type) and simulator video capture require the AXe binary. If you see a missing AXe error:
- Ensure `bundled/` artifacts exist in your installation.
- Or set `XCODEBUILDMCP_AXE_PATH` to a known AXe binary path (preferred), or `AXE_PATH`.
- Re-run the doctor tool to confirm AXe is detected.

### Tool timeouts
Some clients have short tool timeouts. If you see timeouts, increase the client timeout (for example, `tool_timeout_sec = 600` in Codex).

### Missing tools
If tools do not appear, verify `XCODEBUILDMCP_ENABLED_WORKFLOWS` includes the required workflow groups.

## Related docs
- Configuration options: [CONFIGURATION.md](CONFIGURATION.md)
- Tools reference: [TOOLS.md](TOOLS.md)
- Privacy and telemetry: [PRIVACY.md](PRIVACY.md)
