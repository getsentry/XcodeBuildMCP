import SwiftUI

struct AtmosBackground: View {
    let current: CurrentWeather
    let animationsEnabled: Bool
    var forcedParticle: AtmosphericParticle?

    private var particleSeed: Int {
        current.id.unicodeScalars.reduce(0) { seed, scalar in
            seed &* 31 &+ Int(scalar.value)
        }
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size

            ZStack {
                LinearGradient(
                    stops: current.theme.backgroundStops,
                    startPoint: .top,
                    endPoint: .bottom
                )
                meshBlobs(size: size)
                noise

                TimelineView(.animation(minimumInterval: animationsEnabled ? 1 / 30 : nil, paused: !animationsEnabled)) { timeline in
                    let time = timeline.date.timeIntervalSinceReferenceDate
                    ZStack {
                        particleLayer(size: size, time: time)
                        cloudLayer(size: size, time: time)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.45), value: current.id)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private func meshBlobs(size: CGSize) -> some View {
        ZStack {
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [current.theme.accent.opacity(0.33), .clear],
                        center: .center,
                        startRadius: 0,
                        endRadius: max(size.width, size.height) * 0.45
                    )
                )
                .frame(width: size.width * 1.2, height: size.height * 0.6)
                .position(x: size.width * 0.25, y: size.height * 0.12)
                .blur(radius: 40)

            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [current.theme.backgroundStops[safe: 2]?.color.opacity(0.53) ?? .clear, .clear],
                        center: .center,
                        startRadius: 0,
                        endRadius: max(size.width, size.height) * 0.38
                    )
                )
                .frame(width: size.width, height: size.height * 0.5)
                .position(x: size.width * 0.85, y: size.height * 0.88)
                .blur(radius: 50)
        }
    }

    private var noise: some View {
        Canvas { context, size in
            for x in stride(from: 0, through: size.width, by: 18) {
                for y in stride(from: 0, through: size.height, by: 18) {
                    let alpha = WeatherMetricHelpers.deterministicPercent(seed: Int(x + y), index: Int(x * 3 + y)) * 0.006
                    context.fill(
                        Path(CGRect(x: x, y: y, width: 1, height: 1)),
                        with: .color(.white.opacity(alpha))
                    )
                }
            }
        }
        .blendMode(.overlay)
        .opacity(0.6)
    }

    @ViewBuilder private func particleLayer(size: CGSize, time: TimeInterval) -> some View {
        switch forcedParticle ?? current.atmosphericParticle {
        case .sun:
            sunRays(size: size, time: time)
        case .rain:
            rain(size: size, time: time)
        case .snow:
            snow(size: size, time: time)
        case .stars:
            stars(size: size, time: time)
        case .storm:
            stormFlash(time: time)
        }
    }

    private func sunRays(size: CGSize, time: TimeInterval) -> some View {
        let phase = animationsEnabled ? (sin(time * .pi / 4) + 1) / 2 : 0.5
        return Circle()
            .fill(
                RadialGradient(
                    colors: [Color(hex: "#FFE4AA").opacity(0.35), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: 300
                )
            )
            .frame(width: 600, height: 600)
            .scaleEffect(1 + phase * 0.06)
            .opacity(0.85 + phase * 0.15)
            .position(x: size.width / 2, y: size.height * 0.02)
            .blur(radius: 20)
    }

    private func rain(size: CGSize, time: TimeInterval) -> some View {
        Canvas { context, canvasSize in
            let seed = particleSeed
            let baseColor = Color(hex: "#DCEBFF")
            for index in 0..<70 {
                let x = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index) * canvasSize.width
                let duration = 0.7 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 100) * 0.6
                let delay = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 200) * 1.2
                let progress = animationsEnabled
                    ? ((time + delay).truncatingRemainder(dividingBy: duration) / duration)
                    : WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 300)
                let length = 14 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 400) * 18
                let opacity = 0.3 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 500) * 0.5
                let centerY = -30 + progress * (canvasSize.height + 80)
                let rect = CGRect(x: x - 0.5, y: centerY - length / 2, width: 1, height: length)

                context.fill(
                    Path(rect),
                    with: .linearGradient(
                        Gradient(colors: [.clear, baseColor.opacity(opacity)]),
                        startPoint: CGPoint(x: rect.midX, y: rect.minY),
                        endPoint: CGPoint(x: rect.midX, y: rect.maxY)
                    )
                )
            }
        }
    }

    private func snow(size: CGSize, time: TimeInterval) -> some View {
        Canvas { context, canvasSize in
            let seed = particleSeed
            for index in 0..<50 {
                let x = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index) * canvasSize.width
                let duration = 6 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 100) * 5
                let delay = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 200) * 6
                let progress = animationsEnabled
                    ? ((time + delay).truncatingRemainder(dividingBy: duration) / duration)
                    : WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 300)
                let drift = -10 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 400) * 20
                let sizeValue = 2 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 500) * 3
                let opacity = 0.4 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 600) * 0.5
                let centerX = x + drift * progress
                let centerY = -10 + progress * (canvasSize.height + 40)
                let rect = CGRect(x: centerX - sizeValue / 2, y: centerY - sizeValue / 2, width: sizeValue, height: sizeValue)

                context.fill(Path(ellipseIn: rect), with: .color(.white.opacity(opacity)))
            }
        }
    }

    private func stars(size: CGSize, time: TimeInterval) -> some View {
        Canvas { context, canvasSize in
            let seed = particleSeed
            for index in 0..<80 {
                let x = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index) * canvasSize.width
                let y = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 100) * canvasSize.height * 0.75
                let large = WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 200) > 0.85
                let base = 0.4 + WeatherMetricHelpers.deterministicPercent(seed: seed, index: index + 300) * 0.6
                let pulse = animationsEnabled ? (sin(time * (1.2 + Double(index % 5) * 0.25) + Double(index)) + 1) / 2 : 0.6
                let diameter: CGFloat = large ? 2 : 1
                let rect = CGRect(x: x - diameter / 2, y: y - diameter / 2, width: diameter, height: diameter)
                let fill = Color.white.opacity(0.25 + base * pulse)

                if large {
                    context.drawLayer { layer in
                        layer.addFilter(.shadow(color: .white.opacity(0.8), radius: 4))
                        layer.fill(Path(ellipseIn: rect), with: .color(fill))
                    }
                } else {
                    context.fill(Path(ellipseIn: rect), with: .color(fill))
                }
            }
        }
    }

    private func stormFlash(time: TimeInterval) -> some View {
        let phase = animationsEnabled ? time.truncatingRemainder(dividingBy: 7) / 7 : 0
        let opacity = phase > 0.93 && phase < 0.94 ? 0.30 : phase > 0.95 && phase < 0.965 ? 0.18 : 0
        return Color(hex: "#F5C77E").opacity(opacity)
    }

    @ViewBuilder private func cloudLayer(size: CGSize, time: TimeInterval) -> some View {
        let opacity: Double? = switch forcedParticle ?? current.atmosphericParticle {
        case .sun: 0.10
        case .rain: 0.22
        case .storm: 0.18
        default: nil
        }

        if let opacity {
            let offset1 = animationsEnabled ? CGFloat(time.truncatingRemainder(dividingBy: 38) / 38) * (size.width * 1.8) : size.width * 0.35
            let offset2 = animationsEnabled ? CGFloat((time - 10).truncatingRemainder(dividingBy: 52) / 52) * (size.width * 1.8) : size.width * 0.55

            Group {
                cloud(width: size.width * 0.7, height: 100, opacity: opacity)
                    .position(x: -size.width * 0.3 + offset1, y: size.height * 0.08)
                cloud(width: size.width * 0.6, height: 80, opacity: opacity * 0.8)
                    .position(x: -size.width * 0.4 + offset2, y: size.height * 0.22)
            }
        }
    }

    private func cloud(width: CGFloat, height: CGFloat, opacity: Double) -> some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [.white.opacity(0.6), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: width * 0.4
                )
            )
            .frame(width: width, height: height)
            .blur(radius: 20)
            .opacity(opacity)
    }
}

