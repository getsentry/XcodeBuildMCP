import SwiftUI

struct SunMiniCard: View {
    let current: CurrentWeather

    var body: some View {
        AtmosGlassCard(theme: current.theme, padding: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(primaryLabel)
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(current.theme.foregroundMuted)

                Text(primaryTime)
                    .font(.system(size: 22, weight: .light))
                    .tracking(-0.5)
                    .monospacedDigit()

                Spacer(minLength: 4)
                SunArcMini(current: current)
                    .frame(height: 56)
                    .padding(.horizontal, -6)

                Text("\(secondaryLabel) \(secondaryTime)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(current.theme.foregroundMuted)
                    .lineLimit(1)
            }
            .frame(height: 124)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var primaryLabel: String {
        switch current.solarProgress {
        case .beforeSunrise:
            "SUNRISE"
        case .daylight:
            "SUNSET"
        case .afterSunset:
            "SUNRISE"
        }
    }

    private var primaryTime: String {
        switch current.solarProgress {
        case .beforeSunrise, .afterSunset:
            current.sunrise.fullClockLabel
        case .daylight:
            current.sunset.fullClockLabel
        }
    }

    private var secondaryLabel: String {
        switch current.solarProgress {
        case .beforeSunrise:
            "Sunset at"
        case .daylight:
            "Sunrise was"
        case .afterSunset:
            "Sunset was"
        }
    }

    private var secondaryTime: String {
        switch current.solarProgress {
        case .beforeSunrise:
            current.sunset.fullClockLabel
        case .daylight:
            current.sunrise.fullClockLabel
        case .afterSunset:
            current.sunset.fullClockLabel
        }
    }
}

private struct SunArcMini: View {
    let current: CurrentWeather

    var body: some View {
        Canvas { context, size in
            let pad: CGFloat = 8
            let centerX = size.width / 2
            let centerY = size.height - 10
            let radius = min((size.width - pad * 2) / 2, centerY - pad - 4)
            let daylightFraction = current.solarProgress.daylightFraction
            let point = daylightFraction.map { fraction in
                CGPoint(
                    x: centerX - radius * cos(.pi * fraction),
                    y: centerY - radius * sin(.pi * fraction)
                )
            }

            var horizon = Path()
            horizon.move(to: CGPoint(x: pad, y: centerY))
            horizon.addLine(to: CGPoint(x: size.width - pad, y: centerY))
            context.stroke(horizon, with: .color(current.theme.cardBorder), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))

            var arc = Path()
            arc.addArc(center: CGPoint(x: centerX, y: centerY), radius: radius, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            context.stroke(arc, with: .color(current.theme.cardBorder), lineWidth: 1.2)

            if let daylightFraction, daylightFraction > 0 {
                let travelled = sunArcPath(center: CGPoint(x: centerX, y: centerY), radius: radius, from: 0, to: daylightFraction)
                context.stroke(travelled, with: .color(current.theme.accent.opacity(0.85)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            }

            if let point {
                context.fill(Path(ellipseIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)), with: .color(current.theme.accent.opacity(0.22)))
                context.fill(Path(ellipseIn: CGRect(x: point.x - 3, y: point.y - 3, width: 6, height: 6)), with: .color(current.theme.accent))
            }
        }
    }
}

private func sunArcPath(center: CGPoint, radius: CGFloat, from startFraction: Double, to endFraction: Double) -> Path {
    let steps = max(2, Int((endFraction - startFraction) * 48))
    var path = Path()

    for index in 0...steps {
        let fraction = startFraction + (endFraction - startFraction) * Double(index) / Double(steps)
        let point = CGPoint(
            x: center.x - radius * cos(.pi * fraction),
            y: center.y - radius * sin(.pi * fraction)
        )

        if index == 0 {
            path.move(to: point)
        } else {
            path.addLine(to: point)
        }
    }

    return path
}

private extension SolarDayProgress {
    var daylightFraction: Double? {
        switch self {
        case let .daylight(fraction):
            fraction
        case .beforeSunrise, .afterSunset:
            nil
        }
    }
}
