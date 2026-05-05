import SwiftUI

struct HourlyForecastCard: View {
    let forecasts: [HourlyForecast]
    let current: CurrentWeather
    let units: WeatherUnits

    private let cellWidth: CGFloat = 56

    var body: some View {
        AtmosGlassCard(theme: current.theme, padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel("HOURLY FORECAST")
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 6)

                ScrollView(.horizontal) {
                    ZStack(alignment: .topLeading) {
                        HourlyCurve(forecasts: forecasts, theme: current.theme)
                            .frame(width: totalWidth, height: 56)
                            .offset(y: 26)

                        HStack(spacing: 0) {
                            ForEach(forecasts) { forecast in
                                VStack(spacing: 4) {
                                    Text(forecast.hourLabel)
                                        .font(.system(size: 13))
                                        .tracking(-0.1)
                                        .foregroundStyle(current.theme.foregroundMuted)
                                        .monospacedDigit()
                                    Spacer()
                                    WeatherIconView(
                                        kind: forecast.iconKind,
                                        size: 22,
                                        foreground: current.theme.foreground,
                                        accent: current.theme.accent
                                    )
                                    Spacer()
                                    Text(WeatherUnitFormatter.temperatureString(forecast.temperatureC, units: units))
                                        .font(.system(size: 17, weight: .medium))
                                        .monospacedDigit()
                                }
                                .frame(width: cellWidth, height: 116)
                                .padding(.top, 6)
                                .padding(.bottom, 8)
                            }
                        }
                    }
                    .frame(width: totalWidth, height: 116)
                }
                .scrollIndicators(.hidden)
                .padding(.bottom, 4)
            }
        }
    }

    private var totalWidth: CGFloat {
        CGFloat(forecasts.count) * cellWidth
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(current.theme.foregroundMuted)
    }
}

private struct HourlyCurve: View {
    let forecasts: [HourlyForecast]
    let theme: WeatherTheme

    var body: some View {
        GeometryReader { proxy in
            let points = curvePoints(size: proxy.size)
            ZStack {
                filledPath(points: points, size: proxy.size)
                    .fill(
                        LinearGradient(
                            colors: [theme.accent.opacity(0.32), theme.accent.opacity(0)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                linePath(points: points)
                    .stroke(theme.accent, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                ForEach(Array(points.enumerated()), id: \.offset) { offset, point in
                    Circle()
                        .fill(theme.foreground.opacity(offset == 0 ? 1 : 0.55))
                        .frame(width: offset == 0 ? 6 : 3.2, height: offset == 0 ? 6 : 3.2)
                        .position(point)
                }
            }
        }
    }

    private func curvePoints(size: CGSize) -> [CGPoint] {
        let temperatures = forecasts.map(\.temperatureC)
        let minTemp = temperatures.min() ?? 0
        let maxTemp = temperatures.max() ?? minTemp + 1
        let range = max(maxTemp - minTemp, 1)
        let step = size.width / CGFloat(max(forecasts.count, 1))
        let pad: CGFloat = 8

        return forecasts.enumerated().map { index, forecast in
            let normalized = CGFloat(forecast.temperatureC - minTemp) / CGFloat(range)
            return CGPoint(
                x: (CGFloat(index) + 0.5) * step,
                y: pad + (1 - normalized) * (size.height - pad * 2)
            )
        }
    }

    private func linePath(points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for index in points.indices.dropFirst() {
                let previous = points[index - 1]
                let current = points[index]
                let midX = previous.x + (current.x - previous.x) / 2
                path.addCurve(
                    to: current,
                    control1: CGPoint(x: midX, y: previous.y),
                    control2: CGPoint(x: midX, y: current.y)
                )
            }
        }
    }

    private func filledPath(points: [CGPoint], size: CGSize) -> Path {
        var path = linePath(points: points)
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.addLine(to: CGPoint(x: 0, y: size.height))
        path.closeSubpath()
        return path
    }
}
