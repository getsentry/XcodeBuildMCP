import SwiftUI

struct PrecipitationDetailView: View {
    @Environment(\.dismiss) private var dismiss

    let current: CurrentWeather
    let rainyCurrent: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        ZStack {
            AtmosBackground(current: rainyCurrent, animationsEnabled: units.animationsEnabled, forcedParticle: .rain)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header

                    Text("PRECIPITATION")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(visualTheme.foregroundMuted)

                    Text("\(current.precipChance)%")
                        .font(.system(size: 48, weight: .thin))
                        .tracking(-1.5)
                        .monospacedDigit()

                    Text("chance over the next 24 hours")
                        .font(.system(size: 16))
                        .foregroundStyle(visualTheme.foregroundMuted)
                        .padding(.bottom, 8)

                    AtmosGlassCard(theme: visualTheme, padding: 16) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("NEXT 24 HOURS")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(1.4)
                                .foregroundStyle(visualTheme.foregroundMuted)
                            precipChart
                            HStack {
                                Text("Now")
                                Spacer()
                                Text("6h")
                                Spacer()
                                Text("12h")
                                Spacer()
                                Text("18h")
                                Spacer()
                                Text("24h")
                            }
                            .font(.system(size: 11))
                            .monospacedDigit()
                            .foregroundStyle(visualTheme.foregroundMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    AtmosGlassCard(theme: visualTheme, padding: 16) {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                            Stat(label: "Total expected", value: totalExpected)
                            Stat(label: "Hours of rain", value: "6 hrs")
                            Stat(label: "Storm distance", value: "\(WeatherUnitFormatter.distance(14, units: units).value) \(WeatherUnitFormatter.distance(14, units: units).unit)")
                            Stat(label: "Lightning", value: "None")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    AtmosGlassCard(theme: visualTheme, padding: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("ABOUT")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(1.4)
                                .foregroundStyle(visualTheme.foregroundMuted)
                            Text("Light rain is expected to begin around 2 PM and continue intermittently through the evening. Total rainfall is forecast to be modest, with the heaviest period between 4 and 6 PM. No thunderstorm activity is expected.")
                                .font(.system(size: 14))
                                .lineSpacing(4)
                                .foregroundStyle(visualTheme.foreground.opacity(0.92))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.top, 54)
                .padding(.horizontal, 16)
                .padding(.bottom, 60)
            }
        }
        .foregroundStyle(visualTheme.foreground)
        .preferredColorScheme(visualTheme.statusDark ? .dark : .light)
        .accessibilityIdentifier("weather.precipitationDetail")
    }

    private var header: some View {
        HStack {
            AtmosGlassPill(theme: visualTheme, cornerRadius: 20, padding: 0, action: dismiss.callAsFunction) {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.left")
                    Text("Back")
                }
                .font(.system(size: 14, weight: .medium))
                .padding(.leading, 10)
                .padding(.trailing, 14)
                .padding(.vertical, 8)
            }
            Spacer()
            AtmosGlassPill(theme: visualTheme, cornerRadius: 16, padding: 0, action: dismiss.callAsFunction) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Close")
        }
        .padding(.bottom, 10)
    }

    private var precipChart: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(precipValues.enumerated()), id: \.offset) { _, value in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [visualTheme.accent.opacity(0.93), visualTheme.accent.opacity(0.40)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(maxWidth: .infinity)
                    .frame(height: max(3, 120 * CGFloat(value) / 100))
            }
        }
        .frame(height: 120, alignment: .bottom)
    }

    private var precipValues: [Int] {
        (0..<24).map { index in
            let x = Double(index) / 23
            let noise = WeatherMetricHelpers.deterministicPercent(seed: current.precipChance * 97, index: index) * 0.2
            let value = Double(current.precipChance) * (0.4 + sin(x * .pi * 2.2) * 0.4 + noise)
            return Int(max(0, min(100, value)).rounded())
        }
    }

    private var visualTheme: WeatherTheme {
        rainyCurrent.theme
    }

    private var totalExpected: String {
        if units.distance == .kilometers {
            return String(format: "%.1f mm", 0.42 * 25.4)
        }
        return "0.42″"
    }

    private struct Stat: View {
        let label: String
        let value: String

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(size: 22, weight: .light))
                    .tracking(-0.4)
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
