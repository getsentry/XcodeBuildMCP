# Weather UI benchmark

Task:
1. Build and run the Weather example app on the configured simulator.
2. Open the settings sheet.
3. Change these settings:
   - Temperature: °C
   - Wind speed: m/s
   - Pressure: inHg
   - Distance: km
   - Atmospheric animations: off
   - Severe weather alerts: off
   - Reduce transparency: on
4. Search by typing exactly `London`, then select the London result.
5. Verify the main screen shows `London`, `11°`, precipitation `78%`, and visibility `9.7 km`.
6. Open the precipitation details and verify by observing the UI that it shows `78%` chance over the next 24 hours, `10.7 mm` total expected, `6 hrs` hours of rain, `14 km` storm distance, and lightning `None`.

Verification rules:
- Do not change settings, locations, or app data after reaching the precipitation details.
- Verification means reading the visible UI state using UI snapshots and, only if needed, a screenshot.

Return a concise final summary of what you observed.
