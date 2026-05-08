import SwiftUI

struct WeatherIconView: View {
    let kind: WeatherIconKind
    let size: CGFloat
    let foreground: Color
    let accent: Color

    var body: some View {
        Image(systemName: symbol)
            .symbolRenderingMode(.palette)
            .foregroundStyle(primary, secondary)
            .font(.system(size: size, weight: .semibold))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch kind {
        case .sun: "sun.max.fill"
        case .sunLow: "sun.horizon.fill"
        case .moon: "moon.stars.fill"
        case .cloud: "cloud.fill"
        case .rain: "cloud.rain.fill"
        case .heavyRain: "cloud.heavyrain.fill"
        case .snow: "cloud.snow.fill"
        case .storm: "cloud.bolt.rain.fill"
        }
    }

    private var primary: Color {
        switch kind {
        case .sun, .sunLow, .storm:
            accent
        default:
            foreground.opacity(0.95)
        }
    }

    private var secondary: Color {
        switch kind {
        case .rain, .heavyRain:
            Color(hex: "#9DB7D6")
        case .snow:
            .white
        default:
            foreground.opacity(0.70)
        }
    }
}
