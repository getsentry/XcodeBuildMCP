import SwiftUI

struct WindCard: View {
    let current: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        AtmosGlassCard(theme: current.theme, padding: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("WIND")
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(current.theme.foregroundMuted)

                HStack(spacing: 18) {
                    WindCompass(current: current, units: units)
                        .frame(width: 168, height: 168)

                    VStack(spacing: 14) {
                        WindStat(
                            label: "LULL",
                            kph: max(0, Int((Double(current.windKph) * 0.55).rounded())),
                            color: current.theme.foregroundFaint,
                            units: units,
                            theme: current.theme,
                            muted: true
                        )
                        WindStat(
                            label: "NOW",
                            kph: current.windKph,
                            color: current.theme.accent,
                            units: units,
                            theme: current.theme
                        )
                        WindStat(
                            label: "GUST",
                            kph: Int((Double(current.windKph) * 1.65).rounded()),
                            color: current.theme.foreground,
                            units: units,
                            theme: current.theme
                        )

                        Text("From the \(WeatherMetricHelpers.longDirection(current.windDirection)) · \(WeatherMetricHelpers.beaufortLabel(current.windKph))")
                            .font(.system(size: 11))
                            .tracking(0.2)
                            .foregroundStyle(current.theme.foregroundMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

private struct WindCompass: View {
    let current: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        ZStack {
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let outer: CGFloat = 76
                let inner: CGFloat = 56
                strokeCircle(context: &context, center: center, radius: outer, opacity: 0.18)
                strokeCircle(context: &context, center: center, radius: inner, opacity: 0.10)
                drawTicks(context: &context, center: center, outer: outer)
                drawWindArc(context: &context, center: center, radius: inner + 8)
                drawNeedle(context: &context, center: center, outer: outer, inner: inner)
            }

            ForEach(["N", "E", "S", "W"], id: \.self) { label in
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(label == "N" ? current.theme.accent : current.theme.foreground.opacity(0.55))
                    .position(labelPosition(label))
            }

            VStack(spacing: 2) {
                Text(WeatherMetricHelpers.compassAbbreviation(current.windDirection))
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(current.theme.foregroundMuted)
                Text(WeatherUnitFormatter.wind(current.windKph, units: units).value)
                    .font(.system(size: 30, weight: .thin))
                    .tracking(-1)
                    .monospacedDigit()
                Text(WeatherUnitFormatter.wind(current.windKph, units: units).unit)
                    .font(.system(size: 10.5))
                    .foregroundStyle(current.theme.foregroundMuted)
            }
        }
    }

    private func labelPosition(_ label: String) -> CGPoint {
        let degrees = cardinalDegrees(label)
        let radians = (degrees - 90) * .pi / 180
        return CGPoint(x: 84 + cos(radians) * 90, y: 88 + sin(radians) * 90)
    }

    private func cardinalDegrees(_ label: String) -> Double {
        switch label {
        case "N": 0
        case "E": 90
        case "S": 180
        case "W": 270
        default: 0
        }
    }

    private func strokeCircle(context: inout GraphicsContext, center: CGPoint, radius: CGFloat, opacity: Double) {
        var path = Path()
        path.addEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        context.stroke(path, with: .color(current.theme.foreground.opacity(opacity)), lineWidth: 1)
    }

    private func drawTicks(context: inout GraphicsContext, center: CGPoint, outer: CGFloat) {
        for angle in stride(from: 0, to: 360, by: 15) {
            let cardinal = angle % 90 == 0
            let intercardinal = angle % 45 == 0
            let length: CGFloat = cardinal ? 12 : intercardinal ? 8 : 5
            let width: CGFloat = cardinal ? 1.6 : 1
            let opacity = cardinal ? 0.55 : intercardinal ? 0.32 : 0.16
            let radians = (Double(angle) - 90) * .pi / 180
            var path = Path()
            path.move(to: CGPoint(x: center.x + CGFloat(cos(radians)) * (outer - length), y: center.y + CGFloat(sin(radians)) * (outer - length)))
            path.addLine(to: CGPoint(x: center.x + CGFloat(cos(radians)) * outer, y: center.y + CGFloat(sin(radians)) * outer))
            context.stroke(path, with: .color(current.theme.foreground.opacity(opacity)), style: StrokeStyle(lineWidth: width, lineCap: .round))
        }
    }

    private func drawWindArc(context: inout GraphicsContext, center: CGPoint, radius: CGFloat) {
        let angle = current.windDirection.degrees
        var path = Path()
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(angle - 28 - 90),
            endAngle: .degrees(angle + 28 - 90),
            clockwise: false
        )
        context.stroke(path, with: .color(current.theme.accent.opacity(0.85)), style: StrokeStyle(lineWidth: 3, lineCap: .round))
    }

    private func drawNeedle(context: inout GraphicsContext, center: CGPoint, outer: CGFloat, inner: CGFloat) {
        let angle = current.windDirection.degrees
        let start = point(center: center, radius: outer - 18, degrees: angle)
        let end = point(center: center, radius: inner - 18, degrees: angle + 180)
        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        context.stroke(path, with: .color(current.theme.accent.opacity(0.9)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        var dot = Path()
        dot.addEllipse(in: CGRect(x: center.x - 3.5, y: center.y - 3.5, width: 7, height: 7))
        context.fill(dot, with: .color(current.theme.accent))
    }

    private func point(center: CGPoint, radius: CGFloat, degrees: Double) -> CGPoint {
        let radians = (degrees - 90) * .pi / 180
        return CGPoint(x: center.x + CGFloat(cos(radians)) * radius, y: center.y + CGFloat(sin(radians)) * radius)
    }
}

private struct WindStat: View {
    let label: String
    let kph: Int
    let color: Color
    let units: WeatherUnits
    let theme: WeatherTheme
    var muted = false

    var body: some View {
        let value = WeatherUnitFormatter.wind(kph, units: units)
        VStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(theme.foregroundMuted)
                Spacer()
                Text(value.value)
                    .font(.system(size: 17, weight: .medium))
                    .monospacedDigit()
                Text(value.unit)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.foregroundMuted)
            }

            GeometryReader { proxy in
                Capsule()
                    .fill(theme.cardBorder)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(color.opacity(muted ? 0.55 : 1))
                            .frame(width: proxy.size.width * min(1, max(0.04, Double(kph) / 100)))
                    }
            }
            .frame(height: 4)
        }
    }
}
