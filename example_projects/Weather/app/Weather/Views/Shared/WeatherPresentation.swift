import SwiftUI

enum AtmosphericParticle: String, Sendable {
    case sun
    case rain
    case snow
    case stars
    case storm
}

enum WeatherIconKind: Sendable {
    case sun
    case sunLow
    case moon
    case cloud
    case rain
    case heavyRain
    case snow
    case storm
}

struct WeatherTheme {
    let backgroundStops: [Gradient.Stop]
    let accent: Color
    let foreground: Color
    let foregroundMuted: Color
    let foregroundFaint: Color
    let cardBackground: Color
    let cardBackgroundOpacity: Double
    let cardBorder: Color
    let statusDark: Bool
}

extension CurrentWeather {
    var theme: WeatherTheme {
        WeatherPresentation.style(for: condition).theme
    }

    var atmosphericParticle: AtmosphericParticle {
        WeatherPresentation.style(for: condition).particle
    }

    var conditionLabel: String {
        condition.displayLabel
    }

    var heroPhrase: String {
        condition.heroPhrase
    }

    var iconKind: WeatherIconKind {
        condition.iconKind
    }

    var airQualityLabel: String {
        airQualityCategory.displayLabel
    }

    var uvLabel: String {
        uvCategory.displayLabel
    }

    var pressureTrendLabel: String {
        pressureTrend.displayLabel
    }
}

extension WeatherLocation {
    var conditionLabel: String {
        condition.displayLabel
    }

    var iconKind: WeatherIconKind {
        condition.iconKind
    }

    var localTimeLabel: String {
        localTime.fullClockLabel
    }
}

extension HourlyForecast {
    var hourLabel: String {
        hour.displayLabel
    }

    var iconKind: WeatherIconKind {
        condition.iconKind
    }
}

extension DailyForecast {
    var dayLabel: String {
        day.displayLabel
    }

    var isToday: Bool {
        day == .today
    }

    var iconKind: WeatherIconKind {
        condition.iconKind
    }
}

extension WeatherCondition {
    var displayLabel: String {
        switch self {
        case .sunny: "Sunny"
        case .mostlySunny: "Mostly Sunny"
        case .partlyCloudy: "Partly Cloudy"
        case .cloudy: "Cloudy"
        case .clearDay, .clearNight: "Clear"
        case .lightRain: "Light Rain"
        case .heavyRain: "Heavy Rain"
        case .lightSnow: "Light Snow"
        case .snowShowers: "Snow Showers"
        case .thunderstorms: "Thunderstorms"
        case .hazy: "Hazy"
        }
    }

    var heroPhrase: String {
        switch self {
        case .sunny, .mostlySunny, .clearDay, .partlyCloudy, .hazy:
            "Crisp and clear"
        case .cloudy:
            "Soft clouds overhead"
        case .clearNight:
            "Still and starlit"
        case .lightRain, .heavyRain:
            "A soft, steady rain"
        case .lightSnow, .snowShowers:
            "A quiet hush of snow"
        case .thunderstorms:
            "Thunder rolling in"
        }
    }

    var iconKind: WeatherIconKind {
        switch self {
        case .sunny, .mostlySunny, .hazy, .clearDay:
            .sun
        case .partlyCloudy:
            .sunLow
        case .clearNight:
            .moon
        case .cloudy:
            .cloud
        case .lightRain:
            .rain
        case .heavyRain:
            .heavyRain
        case .lightSnow, .snowShowers:
            .snow
        case .thunderstorms:
            .storm
        }
    }
}

extension LocalClockTime {
    var hourMinuteLabel: String {
        "\(hour12):\(String(format: "%02d", minute))"
    }

    var fullClockLabel: String {
        "\(hourMinuteLabel) \(meridiem)"
    }

    var compactClockLabel: String {
        if minute == 0 {
            "\(hour12)\(meridiem.lowercased())"
        } else {
            fullClockLabel
        }
    }

    private var hour12: Int {
        let adjusted = hour % 12
        return adjusted == 0 ? 12 : adjusted
    }

    private var meridiem: String {
        hour < 12 ? "AM" : "PM"
    }
}

extension ForecastHour {
    var displayLabel: String {
        switch self {
        case .current:
            "Now"
        case let .clock(time):
            time.compactClockLabel
        }
    }
}

extension ForecastDay {
    var displayLabel: String {
        switch self {
        case .today:
            "Today"
        case let .weekday(weekday):
            weekday.displayLabel
        }
    }
}

extension Weekday {
    var displayLabel: String {
        switch self {
        case .sunday: "Sun"
        case .monday: "Mon"
        case .tuesday: "Tue"
        case .wednesday: "Wed"
        case .thursday: "Thu"
        case .friday: "Fri"
        case .saturday: "Sat"
        }
    }
}

extension UVIndexCategory {
    var displayLabel: String {
        switch self {
        case .none: "—"
        case .low: "Low"
        case .moderate: "Moderate"
        case .high: "High"
        case .veryHigh: "Very High"
        case .extreme: "Extreme"
        }
    }
}

extension AirQualityCategory {
    var displayLabel: String {
        switch self {
        case .good: "Good"
        case .moderate: "Moderate"
        case .unhealthyForSensitiveGroups: "Unhealthy for Sensitive Groups"
        case .unhealthy: "Unhealthy"
        case .veryUnhealthy: "Very Unhealthy"
        case .hazardous: "Hazardous"
        }
    }
}

extension PressureTrend {
    var displayLabel: String {
        switch self {
        case .rising: "rising"
        case .steady: "steady"
        case .falling: "falling"
        }
    }

    var arrowSymbol: String {
        switch self {
        case .rising: "↑"
        case .steady: "→"
        case .falling: "↓"
        }
    }
}

private enum WeatherPresentationStyle {
    case clearDay
    case rainy
    case snowy
    case night
    case stormy

    var particle: AtmosphericParticle {
        switch self {
        case .clearDay: .sun
        case .rainy: .rain
        case .snowy: .snow
        case .night: .stars
        case .stormy: .storm
        }
    }

    var theme: WeatherTheme {
        switch self {
        case .clearDay:
            WeatherTheme(
                backgroundStops: gradientStops([("#FFD89B", 0), ("#FF9E7A", 0.32), ("#7B6FD9", 0.70), ("#1F2D6F", 1)]),
                accent: Color(hex: "#FFD89B"),
                foreground: Color(hex: "#FFFFFF"),
                foregroundMuted: Color(hex: "#FFFFFF", opacity: 0.72),
                foregroundFaint: Color(hex: "#FFFFFF", opacity: 0.45),
                cardBackground: Color.white.opacity(0.13),
                cardBackgroundOpacity: 0.13,
                cardBorder: Color.white.opacity(0.20),
                statusDark: true
            )
        case .rainy:
            WeatherTheme(
                backgroundStops: gradientStops([("#6B7C8E", 0), ("#4A5A6F", 0.40), ("#2E3B4E", 0.75), ("#1A2330", 1)]),
                accent: Color(hex: "#9DB7D6"),
                foreground: Color(hex: "#FFFFFF"),
                foregroundMuted: Color(hex: "#FFFFFF", opacity: 0.70),
                foregroundFaint: Color(hex: "#FFFFFF", opacity: 0.42),
                cardBackground: Color.white.opacity(0.10),
                cardBackgroundOpacity: 0.10,
                cardBorder: Color.white.opacity(0.16),
                statusDark: true
            )
        case .snowy:
            WeatherTheme(
                backgroundStops: gradientStops([("#D4DFEA", 0), ("#A6BACE", 0.38), ("#6E84A0", 0.74), ("#3E4E66", 1)]),
                accent: Color(hex: "#EAF2FB"),
                foreground: Color(hex: "#1F2A3A"),
                foregroundMuted: Color(hex: "#1F2A3A", opacity: 0.70),
                foregroundFaint: Color(hex: "#1F2A3A", opacity: 0.40),
                cardBackground: Color.white.opacity(0.32),
                cardBackgroundOpacity: 0.32,
                cardBorder: Color.white.opacity(0.55),
                statusDark: false
            )
        case .night:
            WeatherTheme(
                backgroundStops: gradientStops([("#1B1F3A", 0), ("#221A48", 0.32), ("#0E1130", 0.70), ("#05071A", 1)]),
                accent: Color(hex: "#B8C7FF"),
                foreground: Color(hex: "#FFFFFF"),
                foregroundMuted: Color(hex: "#FFFFFF", opacity: 0.66),
                foregroundFaint: Color(hex: "#FFFFFF", opacity: 0.38),
                cardBackground: Color.white.opacity(0.07),
                cardBackgroundOpacity: 0.07,
                cardBorder: Color.white.opacity(0.13),
                statusDark: true
            )
        case .stormy:
            WeatherTheme(
                backgroundStops: gradientStops([("#3A3144", 0), ("#272036", 0.36), ("#161526", 0.72), ("#080812", 1)]),
                accent: Color(hex: "#F5C77E"),
                foreground: Color(hex: "#FFFFFF"),
                foregroundMuted: Color(hex: "#FFFFFF", opacity: 0.66),
                foregroundFaint: Color(hex: "#FFFFFF", opacity: 0.38),
                cardBackground: Color.white.opacity(0.09),
                cardBackgroundOpacity: 0.09,
                cardBorder: Color.white.opacity(0.16),
                statusDark: true
            )
        }
    }

    private func gradientStops(_ stops: [(String, Double)]) -> [Gradient.Stop] {
        stops.map { Gradient.Stop(color: Color(hex: $0.0), location: $0.1) }
    }
}

private enum WeatherPresentation {
    static func style(for condition: WeatherCondition) -> WeatherPresentationStyle {
        switch condition {
        case .clearNight:
            .night
        case .thunderstorms:
            .stormy
        case .lightSnow, .snowShowers:
            .snowy
        case .lightRain, .heavyRain:
            .rainy
        case .sunny, .mostlySunny, .partlyCloudy, .cloudy, .clearDay, .hazy:
            .clearDay
        }
    }
}

extension Color {
    init(hex: String, opacity: Double = 1) {
        let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let scanner = Scanner(string: value)
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        let red = Double((rgb >> 16) & 0xFF) / 255
        let green = Double((rgb >> 8) & 0xFF) / 255
        let blue = Double(rgb & 0xFF) / 255
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}
