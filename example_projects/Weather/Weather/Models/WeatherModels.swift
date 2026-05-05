import Foundation

/// Predominant weather reported by the data source; UI labels and symbols are derived in the view layer.
enum WeatherCondition: String, CaseIterable, Sendable {
    case sunny
    case mostlySunny = "mostly_sunny"
    case partlyCloudy = "partly_cloudy"
    case cloudy
    case clearDay = "clear_day"
    case clearNight = "clear_night"
    case lightRain = "light_rain"
    case heavyRain = "heavy_rain"
    case lightSnow = "light_snow"
    case snowShowers = "snow_showers"
    case thunderstorms
    case hazy
}

/// Air quality bucket paired with the numeric AQI value.
enum AirQualityCategory: String, CaseIterable, Sendable {
    case good
    case moderate
    case unhealthyForSensitiveGroups = "unhealthy_for_sensitive_groups"
    case unhealthy
    case veryUnhealthy = "very_unhealthy"
    case hazardous
}

/// UV exposure bucket paired with the numeric UV index.
enum UVIndexCategory: String, CaseIterable, Sendable {
    case none
    case low
    case moderate
    case high
    case veryHigh = "very_high"
    case extreme
}

/// Direction of pressure movement over the recent observation window.
enum PressureTrend: String, CaseIterable, Sendable {
    case rising
    case steady
    case falling
}

/// Wind bearing in meteorological degrees, normalized to the 0..<360 range.
struct WindDirection: Equatable, Hashable, Sendable {
    let degrees: Double

    init(degrees: Double) {
        precondition(degrees >= 0 && degrees < 360, "wind direction degrees must be in the 0..<360 range")
        self.degrees = degrees
    }
}

/// Local civil time for a weather location, stored in 24-hour time without presentation formatting.
struct LocalClockTime: Equatable, Hashable, Sendable {
    let hour: Int
    let minute: Int

    init(hour: Int, minute: Int = 0) {
        precondition((0...23).contains(hour), "hour must be in the 0...23 range")
        precondition((0...59).contains(minute), "minute must be in the 0...59 range")
        self.hour = hour
        self.minute = minute
    }
}

/// Relative or local-clock slot for an hourly forecast.
enum ForecastHour: Equatable, Hashable, Sendable {
    case current
    case clock(LocalClockTime)
}

enum Weekday: Int, CaseIterable, Sendable {
    case sunday = 1
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
}

/// Day identity for a daily forecast independent of display labels.
enum ForecastDay: Equatable, Hashable, Sendable {
    case today
    case weekday(Weekday)
}

/// Position in the local solar day; daylight fractions are normalized to 0...1 from sunrise to sunset.
enum SolarDayProgress: Equatable, Sendable {
    case beforeSunrise
    case daylight(fraction: Double)
    case afterSunset

    static func daylightFraction(_ fraction: Double) -> SolarDayProgress {
        precondition((0...1).contains(fraction), "daylight fraction must be normalized to the 0...1 range")
        return .daylight(fraction: fraction)
    }
}

struct CurrentWeather: Equatable, Identifiable, Sendable {
    let id: String
    let temperatureC: Int
    let highC: Int
    let lowC: Int
    let feelsLikeC: Int
    let dewPointC: Int
    let condition: WeatherCondition
    let solarProgress: SolarDayProgress
    let sunrise: LocalClockTime
    let sunset: LocalClockTime
    let airQualityIndex: Int
    let airQualityCategory: AirQualityCategory
    let uvIndex: Int
    let uvCategory: UVIndexCategory
    let windKph: Int
    let windDirection: WindDirection
    let humidity: Int
    let visibilityKilometers: Double
    let pressureMillibars: Int
    let pressureTrend: PressureTrend
    let precipChance: Int
}

struct HourlyForecast: Equatable, Identifiable, Sendable {
    let id: String
    let hour: ForecastHour
    let temperatureC: Int
    let condition: WeatherCondition
}

struct DailyForecast: Equatable, Identifiable, Sendable {
    let id: String
    let day: ForecastDay
    let condition: WeatherCondition
    let lowC: Int
    let highC: Int
    let weekLowC: Int
    let weekHighC: Int
}

struct WeatherLocation: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let subtitle: String
    let country: String?
    let temperatureC: Int
    let highC: Int
    let lowC: Int
    let condition: WeatherCondition
    let localTime: LocalClockTime
}

struct WeatherReport: Equatable, Sendable {
    let current: CurrentWeather
    let hourly: [HourlyForecast]
    let daily: [DailyForecast]
    let precipitationDetailCurrent: CurrentWeather
}

enum TemperatureUnit: String, CaseIterable, Identifiable, Sendable {
    case fahrenheit
    case celsius

    var id: String { rawValue }
    var label: String { self == .fahrenheit ? "°F" : "°C" }
}

enum WindUnit: String, CaseIterable, Identifiable, Sendable {
    case mph
    case kmh
    case metersPerSecond

    var id: String { rawValue }
    var label: String {
        switch self {
        case .mph: "mph"
        case .kmh: "km/h"
        case .metersPerSecond: "m/s"
        }
    }
}

enum PressureUnit: String, CaseIterable, Identifiable, Sendable {
    case millibars
    case inchesMercury

    var id: String { rawValue }
    var label: String { self == .millibars ? "mb" : "inHg" }
}

enum DistanceUnit: String, CaseIterable, Identifiable, Sendable {
    case miles
    case kilometers

    var id: String { rawValue }
    var label: String { self == .miles ? "mi" : "km" }
}

struct WeatherUnits: Equatable, Sendable {
    var temperature: TemperatureUnit = .fahrenheit
    var wind: WindUnit = .mph
    var pressure: PressureUnit = .millibars
    var distance: DistanceUnit = .miles
    var animationsEnabled = true
    var alertsEnabled = true
    var reduceTransparency = false
}
