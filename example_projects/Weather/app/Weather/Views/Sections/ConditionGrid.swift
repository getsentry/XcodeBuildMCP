import SwiftUI

struct ConditionGrid: View {
    let current: CurrentWeather
    let units: WeatherUnits
    let onOpenPrecipitation: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(spacing: 10) {
            WindCard(current: current, units: units)

            LazyVGrid(columns: columns, spacing: 10) {
                ConditionTile(title: "UV INDEX", value: "\(current.uvIndex)", caption: current.uvLabel, current: current) {
                    UVViz(value: current.uvIndex, theme: current.theme)
                }
                ConditionTile(title: "HUMIDITY", value: "\(current.humidity)%", caption: "Dew point: \(WeatherUnitFormatter.temperature(current.dewPointC, units: units))°", current: current) {
                    FilledBar(value: Double(current.humidity) / 100, theme: current.theme)
                }
                ConditionTile(
                    title: "PRECIP.",
                    value: "\(current.precipChance)%",
                    caption: "Next 24 hours",
                    current: current,
                    action: onOpenPrecipitation,
                    accessibilityIdentifier: "weather.precipitationCard"
                ) {
                    PrecipBars(value: current.precipChance, theme: current.theme)
                }
                ConditionTile(title: "VISIBILITY", value: visibility.value + " " + visibility.unit, caption: current.visibilityKilometers >= 13 ? "Clear view" : "Reduced", current: current) {
                    VisibilityViz(value: current.visibilityKilometers, theme: current.theme)
                }
                PressureTile(current: current, pressure: pressure)
                SunMiniCard(current: current)
            }
        }
    }

    private var visibility: FormattedMeasurement {
        WeatherUnitFormatter.distance(current.visibilityKilometers, units: units)
    }

    private var pressure: FormattedMeasurement {
        WeatherUnitFormatter.pressure(current.pressureMillibars, units: units)
    }
}

private struct ConditionTile<Visual: View>: View {
    let title: String
    let value: String
    var unit: String?
    let caption: String
    let current: CurrentWeather
    var action: (() -> Void)?
    var accessibilityIdentifier: String?
    @ViewBuilder let visual: Visual

    @ViewBuilder
    var body: some View {
        if let action {
            Button(action: action) {
                card
                    .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(accessibilityIdentifier ?? "")
        } else if let accessibilityIdentifier {
            card
                .accessibilityIdentifier(accessibilityIdentifier)
        } else {
            card
        }
    }

    private var card: some View {
        AtmosGlassCard(theme: current.theme, padding: 14, isInteractive: action != nil) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(current.theme.foregroundMuted)

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value)
                        .font(.system(size: 28, weight: .light))
                        .tracking(-0.6)
                        .monospacedDigit()
                    if let unit {
                        Text(unit)
                            .font(.system(size: 12))
                            .foregroundStyle(current.theme.foregroundMuted)
                    }
                }

                Spacer()
                visual
                Text(caption)
                    .font(.system(size: 12))
                    .foregroundStyle(current.theme.foregroundMuted)
                    .textCase(.none)
            }
            .frame(height: 124)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct UVViz: View {
    let value: Int
    let theme: WeatherTheme

    var body: some View {
        GeometryReader { proxy in
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "#6FCF97"), Color(hex: "#F2C94C"), Color(hex: "#F2994A"), Color(hex: "#EB5757"), Color(hex: "#BB6BD9")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(height: 4)
                .overlay(alignment: .leading) {
                    Circle()
                        .fill(theme.foreground)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(theme.backgroundStops[safe: 1]?.color ?? .clear, lineWidth: 2))
                        .offset(x: proxy.size.width * min(1, Double(value) / 11) - 6)
                }
                .frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: 12)
    }
}

private struct FilledBar: View {
    let value: Double
    let theme: WeatherTheme

    var body: some View {
        GeometryReader { proxy in
            Capsule()
                .fill(theme.cardBorder)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(theme.accent)
                        .frame(width: proxy.size.width * value)
                }
        }
        .frame(height: 4)
    }
}

private struct PrecipBars: View {
    let value: Int
    let theme: WeatherTheme
    private let heights: [Double] = [0.20, 0.40, 0.80, 0.95, 0.70, 0.30, 0.15, 0.10]

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(heights.enumerated()), id: \.offset) { index, height in
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(isFilled(index: index) ? theme.accent : theme.cardBorder)
                    .frame(maxWidth: .infinity)
                    .frame(height: 22 * height)
            }
        }
        .frame(height: 22)
    }

    private func isFilled(index: Int) -> Bool {
        let clampedValue = min(100, max(0, value))
        return Double(index) < Double(clampedValue) / 100 * Double(heights.count)
    }
}

private struct VisibilityViz: View {
    let value: Double
    let theme: WeatherTheme

    var body: some View {
        let filled = Int((value / 16.1 * 5).rounded())
        HStack(spacing: 3) {
            ForEach(0..<5, id: \.self) { index in
                Capsule()
                    .fill(index < filled ? theme.foreground.opacity(0.85) : theme.cardBorder)
                    .frame(height: 3)
            }
        }
    }
}

private struct PressureTile: View {
    let current: CurrentWeather
    let pressure: FormattedMeasurement

    private let standardPressureMillibars = 1013

    var body: some View {
        AtmosGlassCard(theme: current.theme, padding: 14, isInteractive: false) {
            VStack(alignment: .leading, spacing: 6) {
                Text("PRESSURE")
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(current.theme.foregroundMuted)

                PressureGauge(
                    pressureMillibars: current.pressureMillibars,
                    pressure: pressure,
                    theme: current.theme
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(current.pressureTrend.arrowSymbol)
                        .font(.system(size: 12))
                        .foregroundStyle(current.theme.accent)
                    Text(current.pressureTrend.displayLabel.capitalized)
                        .font(.system(size: 12))
                        .foregroundStyle(current.theme.foregroundMuted)
                        .textCase(.none)
                }
            }
            .frame(height: 124)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Pressure \(pressure.value) \(spokenUnit), \(current.pressureTrend.displayLabel)")
        .accessibilityValue(standardOffsetDescription)
    }

    private var spokenUnit: String {
        pressure.unit == "inHg" ? "inches of mercury" : "millibars"
    }

    private var standardOffsetDescription: String {
        let delta = current.pressureMillibars - standardPressureMillibars
        if delta == 0 {
            return "At standard"
        }
        let direction = delta > 0 ? "above" : "below"
        return "\(abs(delta)) \(direction) standard"
    }
}

private struct PressureGauge: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let pressureMillibars: Int
    let pressure: FormattedMeasurement
    let theme: WeatherTheme

    private let minPressure = 970.0
    private let maxPressure = 1050.0

    var body: some View {
        ZStack {
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height - 7)
                let radius = min((size.width - 10) / 2, size.height - 18)

                context.stroke(
                    arcPath(center: center, radius: radius, from: 0, to: 1),
                    with: .color(theme.cardBorder),
                    style: StrokeStyle(lineWidth: 1, lineCap: .round)
                )

                for tickIndex in 0...48 {
                    let progress = Double(tickIndex) / 48
                    let majorTick = tickIndex.isMultiple(of: 12)
                    let tickLength = majorTick ? 9.0 : 5.0
                    let tickWidth = majorTick ? 1.2 : 0.8
                    let tickColor = majorTick ? theme.foreground.opacity(0.75) : theme.foregroundMuted.opacity(0.55)
                    let angle = angleFor(progress)

                    var tickPath = Path()
                    tickPath.move(to: point(center: center, radius: radius - tickLength, angle: angle))
                    tickPath.addLine(to: point(center: center, radius: radius, angle: angle))
                    context.stroke(tickPath, with: .color(tickColor), style: StrokeStyle(lineWidth: tickWidth, lineCap: .round))
                }

                let markerCenter = point(center: center, radius: radius, angle: angleFor(normalizedPressure))
                context.fill(
                    Path(ellipseIn: CGRect(x: markerCenter.x - 6.5, y: markerCenter.y - 6.5, width: 13, height: 13)),
                    with: .color(theme.accent.opacity(0.35))
                )

                let dotPath = Path(ellipseIn: CGRect(x: markerCenter.x - 3.5, y: markerCenter.y - 3.5, width: 7, height: 7))
                context.fill(dotPath, with: .color(theme.accent))
                context.stroke(dotPath, with: .color(theme.cardBorder), style: StrokeStyle(lineWidth: 1))
            }

            VStack(spacing: 1) {
                Text(pressure.value)
                    .font(.system(size: pressure.unit == "inHg" ? 22 : 24, weight: .light))
                    .tracking(-0.5)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(theme.foreground)

                Text(pressure.unit)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.foregroundMuted)
            }
            .offset(y: 12)

            GeometryReader { proxy in
                let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height - 7)
                let radius = min((proxy.size.width - 10) / 2, proxy.size.height - 18)
                Text("L")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(theme.foregroundMuted.opacity(0.65))
                    .position(labelPoint(center: center, radius: radius, progress: 0))
                Text("H")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(theme.foregroundMuted.opacity(0.65))
                    .position(labelPoint(center: center, radius: radius, progress: 1))
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .frame(height: 88)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: pressureMillibars)
    }

    private var normalizedPressure: Double {
        let rawValue = (Double(pressureMillibars) - minPressure) / (maxPressure - minPressure)
        return min(1, max(0, rawValue))
    }

    private func angleFor(_ progress: Double) -> Double {
        .pi + .pi * progress
    }

    private func point(center: CGPoint, radius: Double, angle: Double) -> CGPoint {
        CGPoint(
            x: center.x + CGFloat(cos(angle) * radius),
            y: center.y + CGFloat(sin(angle) * radius)
        )
    }

    private func labelPoint(center: CGPoint, radius: Double, progress: Double) -> CGPoint {
        let base = point(center: center, radius: radius + 8, angle: angleFor(progress))
        return CGPoint(x: base.x, y: base.y + 4)
    }

    private func arcPath(center: CGPoint, radius: Double, from start: Double, to end: Double) -> Path {
        let steps = max(2, Int((end - start) * 48))
        var path = Path()

        for index in 0...steps {
            let progress = start + (end - start) * Double(index) / Double(steps)
            let nextPoint = point(center: center, radius: radius, angle: angleFor(progress))
            if index == 0 {
                path.move(to: nextPoint)
            } else {
                path.addLine(to: nextPoint)
            }
        }

        return path
    }
}

