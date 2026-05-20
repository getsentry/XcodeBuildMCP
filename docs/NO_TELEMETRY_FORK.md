# No-Telemetry Fork

This fork removes XcodeBuildMCP runtime telemetry and unsolicited third-party network behavior.

## Changes
- Sentry telemetry removed from runtime behavior.
- Online upgrade checks disabled.
- Automatic xcodemake download disabled.
- Project scaffolding no longer downloads templates; configure local template paths instead.

## Remaining expected data flow
- MCP tool and resource results continue to flow to your configured MCP client.
- Review what your AI/MCP client may send to external model providers.

This fork removes XcodeBuildMCP-originated unsolicited third-party runtime network behavior. It cannot control external MCP clients or model providers.
