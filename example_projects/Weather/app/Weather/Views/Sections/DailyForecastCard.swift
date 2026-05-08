import SwiftUI

struct DailyForecastCard: View {
    let forecasts: [DailyForecast]
    let current: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        AtmosGlassCard(theme: current.theme, padding: 0) {
            VStack(spacing: 0) {
                Text("7-DAY FORECAST")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(current.theme.foregroundMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 10)

                Divider().overlay(current.theme.cardBorder)

                ForEach(Array(forecasts.enumerated()), id: \.element.id) { index, forecast in
                    DailyRow(forecast: forecast, current: current, units: units)
                    if index < forecasts.count - 1 {
                        Divider().overlay(current.theme.cardBorder).padding(.leading, 16)
                    }
                }
            }
        }
    }
}

private struct DailyRow: View {
    let forecast: DailyForecast
    let current: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 0) {
            GridRow {
                Text(forecast.dayLabel)
                    .font(.system(size: 17, weight: forecast.isToday ? .semibold : .regular))
                    .frame(width: 50, alignment: .leading)

                WeatherIconView(
                    kind: forecast.iconKind,
                    size: 26,
                    foreground: current.theme.foreground,
                    accent: current.theme.accent
                )
                .frame(width: 32)

                Text(WeatherUnitFormatter.temperatureString(forecast.lowC, units: units))
                    .font(.system(size: 16))
                    .monospacedDigit()
                    .foregroundStyle(current.theme.foregroundMuted)
                    .frame(width: 38, alignment: .trailing)

                RangeBar(forecast: forecast, currentTemperatureC: current.temperatureC, theme: current.theme)

                Text(WeatherUnitFormatter.temperatureString(forecast.highC, units: units))
                    .font(.system(size: 16))
                    .monospacedDigit()
                    .frame(width: 38, alignment: .trailing)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

private struct RangeBar: View {
    let forecast: DailyForecast
    let currentTemperatureC: Int
    let theme: WeatherTheme

    var body: some View {
        GeometryReader { proxy in
            let range = Double(max(forecast.weekHighC - forecast.weekLowC, 1))
            let left = Double(forecast.lowC - forecast.weekLowC) / range
            let width = Double(forecast.highC - forecast.lowC) / range

            ZStack(alignment: .leading) {
                Capsule().fill(theme.cardBorder)
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "#6BB6FF"), theme.accent, Color(hex: "#FF8A6B")],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(6, proxy.size.width * width))
                    .offset(x: proxy.size.width * left)

                if forecast.isToday {
                    let currentPosition = Double(currentTemperatureC - forecast.weekLowC) / range
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(theme.foreground)
                        .frame(width: 8, height: 12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(theme.backgroundStops[safe: 1]?.color ?? .clear, lineWidth: 2)
                        )
                        .shadow(color: .black.opacity(0.15), radius: 1)
                        .offset(x: proxy.size.width * currentPosition - 4)
                }
            }
        }
        .frame(height: 12)
    }
}

