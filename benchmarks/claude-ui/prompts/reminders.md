# Reminders UI benchmark

Task:
1. Launch Reminders on the configured simulator.
2. Create a new list named `MCP Benchmark List`.
3. Add exactly these reminders to `MCP Benchmark List`:
   - `Buy milk benchmark`
   - `File report benchmark`
   - `Call team benchmark`
4. Mark exactly these reminders complete:
   - `Buy milk benchmark`
   - `Call team benchmark`
5. Leave exactly this reminder incomplete:
   - `File report benchmark`
6. Verify the final state of `MCP Benchmark List` by observing the list only: exactly two completed reminders (`Buy milk benchmark`, `Call team benchmark`) and one incomplete reminder (`File report benchmark`).

Verification rules:
- Do not edit, rename, delete, reorder, or clean up reminders or lists during verification.
- Do not create additional reminders or lists.
- Verification means reading the saved list state using UI snapshots and, only if needed, a screenshot.

Return a concise final summary of what you created and observed.
