import SwiftUI

struct WeatherTopBar: View {
    let locationName: String
    let current: CurrentWeather
    let onOpenLocations: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        AtmosGlassContainer {
            HStack {
                AtmosGlassPill(theme: current.theme, cornerRadius: 20, padding: 0, action: onOpenLocations) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(current.theme.accent)
                            .frame(width: 7, height: 7)
                            .shadow(color: current.theme.accent.opacity(0.35), radius: 3)

                        Image(systemName: "mappin")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(current.theme.foreground.opacity(0.85))

                        Text(locationName)
                            .font(.system(size: 14.5, weight: .medium))
                            .tracking(-0.1)

                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(current.theme.foregroundMuted)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
                .accessibilityIdentifier("weather.locationButton")

                Spacer()

                AtmosGlassPill(theme: current.theme, cornerRadius: 19, padding: 0, action: onOpenSettings) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 20, weight: .medium))
                        .frame(width: 38, height: 38)
                }
                .accessibilityIdentifier("weather.settingsButton")
                .accessibilityLabel("Settings")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
    }
}
