import SwiftUI

private struct AtmosReduceTransparencyKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var atmosReduceTransparency: Bool {
        get { self[AtmosReduceTransparencyKey.self] }
        set { self[AtmosReduceTransparencyKey.self] = newValue }
    }
}

struct AtmosGlassCard<Content: View>: View {
    let theme: WeatherTheme
    var cornerRadius: CGFloat = 22
    var padding: CGFloat = 16
    var isInteractive: Bool = false
    var action: (() -> Void)?
    @ViewBuilder let content: Content

    var body: some View {
        AtmosGlassSurface(
            theme: theme,
            cornerRadius: cornerRadius,
            padding: padding,
            isInteractive: isInteractive || action != nil,
            action: action,
            content: { content }
        )
    }
}

struct AtmosGlassPill<Content: View>: View {
    let theme: WeatherTheme
    var cornerRadius: CGFloat = 20
    var padding: CGFloat = 0
    var isInteractive: Bool = false
    var action: (() -> Void)?
    @ViewBuilder let content: Content

    var body: some View {
        AtmosGlassSurface(
            theme: theme,
            cornerRadius: cornerRadius,
            padding: padding,
            isInteractive: isInteractive || action != nil,
            action: action,
            content: { content }
        )
    }
}

private struct AtmosGlassSurface<Content: View>: View {
    @Environment(\.accessibilityReduceTransparency) private var accessibilityReduceTransparency
    @Environment(\.atmosReduceTransparency) private var atmosReduceTransparency

    let theme: WeatherTheme
    let cornerRadius: CGFloat
    let padding: CGFloat
    let isInteractive: Bool
    let action: (() -> Void)?
    @ViewBuilder let content: Content

    @ViewBuilder
    var body: some View {
        if let action {
            Button(action: action) {
                surface
            }
            .buttonStyle(.plain)
        } else {
            surface
        }
    }

    @ViewBuilder
    private var surface: some View {
        let paddedContent = content
            .padding(padding)
            .clipShape(shape)

        if shouldReduceTransparency {
            paddedContent
                .background(reducedTransparencyBackground)
                .overlay(border)
                .clipShape(shape)
        } else if #available(iOS 26.0, macOS 26.0, visionOS 26.0, *) {
            nativeGlassSurface(paddedContent)
        } else {
            paddedContent
                .background(fallbackMaterialBackground)
                .overlay(border)
                .overlay(highlight)
                .shadow(color: .black.opacity(0.10), radius: 9, x: 0, y: 4)
                .clipShape(shape)
        }
    }

    @ViewBuilder
    private func nativeGlassSurface(_ content: some View) -> some View {
        if isInteractive {
            content
                .glassEffect(.regular.tint(theme.cardBackground).interactive(), in: .rect(cornerRadius: cornerRadius))
                .overlay(border)
                .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 3)
        } else {
            content
                .glassEffect(.regular.tint(theme.cardBackground), in: .rect(cornerRadius: cornerRadius))
                .overlay(border)
                .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 3)
        }
    }

    private var reducedTransparencyBackground: some View {
        shape.fill(Color.white.opacity(min(0.95, theme.cardBackgroundOpacity * 4)))
    }

    private var fallbackMaterialBackground: some View {
        shape
            .fill(.ultraThinMaterial)
            .overlay(shape.fill(theme.cardBackground))
    }

    private var border: some View {
        shape.strokeBorder(theme.cardBorder, lineWidth: 0.5)
    }

    private var highlight: some View {
        LinearGradient(
            colors: [.white.opacity(0.18), .clear],
            startPoint: .top,
            endPoint: UnitPoint(x: 0.5, y: 0.06)
        )
        .clipShape(shape)
        .allowsHitTesting(false)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var shouldReduceTransparency: Bool {
        accessibilityReduceTransparency || atmosReduceTransparency
    }
}

struct AtmosGlassContainer<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        if #available(iOS 26.0, macOS 26.0, visionOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                content
            }
        } else {
            content
        }
    }
}
