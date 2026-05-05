import Foundation

struct WeatherLocationsResponseDTO: Codable, Equatable, Sendable {
    let locations: [WeatherLocationDTO]
}

struct WeatherLocationDTO: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let subtitle: String
    let country: String?
    let temperatureC: Int
    let highC: Int
    let lowC: Int
    let condition: WeatherConditionDTO
    let localTime: LocalClockTimeDTO
}

struct LocalClockTimeDTO: Codable, Equatable, Sendable {
    let hour: Int
    let minute: Int
}

struct WeatherReportDTO: Codable, Equatable, Sendable {
    let current: CurrentWeatherDTO
    let hourly: [HourlyForecastDTO]
    let daily: [DailyForecastDTO]
    let precipitationDetailCurrent: CurrentWeatherDTO
}

struct CurrentWeatherDTO: Codable, Equatable, Sendable {
    let id: String
    let temperatureC: Int
    let highC: Int
    let lowC: Int
    let feelsLikeC: Int
    let dewPointC: Int
    let condition: WeatherConditionDTO
    let solarProgress: SolarDayProgressDTO
    let sunrise: LocalClockTimeDTO
    let sunset: LocalClockTimeDTO
    let airQualityIndex: Int
    let airQualityCategory: AirQualityCategoryDTO
    let uvIndex: Int
    let uvCategory: UVIndexCategoryDTO
    let windKph: Int
    let windDirectionDegrees: Double
    let humidity: Int
    let visibilityKilometers: Double
    let pressureMillibars: Int
    let pressureTrend: PressureTrendDTO
    let precipChance: Int
}

struct SolarDayProgressDTO: Codable, Equatable, Sendable {
    let kind: SolarDayProgressKindDTO
    let daylightFraction: Double?
}

struct HourlyForecastDTO: Codable, Equatable, Sendable {
    let id: String
    let hour: ForecastHourDTO
    let temperatureC: Int
    let condition: WeatherConditionDTO
}

struct ForecastHourDTO: Codable, Equatable, Sendable {
    let kind: ForecastHourKindDTO
    let hour: Int?
    let minute: Int?
}

struct DailyForecastDTO: Codable, Equatable, Sendable {
    let id: String
    let day: ForecastDayDTO
    let condition: WeatherConditionDTO
    let lowC: Int
    let highC: Int
    let weekLowC: Int
    let weekHighC: Int
}

struct ForecastDayDTO: Codable, Equatable, Sendable {
    let kind: ForecastDayKindDTO
    let weekdayRawValue: Int?
}

enum WeatherConditionDTO: String, Codable, CaseIterable, Sendable {
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

enum AirQualityCategoryDTO: String, Codable, CaseIterable, Sendable {
    case good
    case moderate
    case unhealthyForSensitiveGroups = "unhealthy_for_sensitive_groups"
    case unhealthy
    case veryUnhealthy = "very_unhealthy"
    case hazardous
}

enum UVIndexCategoryDTO: String, Codable, CaseIterable, Sendable {
    case none
    case low
    case moderate
    case high
    case veryHigh = "very_high"
    case extreme
}

enum PressureTrendDTO: String, Codable, CaseIterable, Sendable {
    case rising
    case steady
    case falling
}

enum SolarDayProgressKindDTO: String, Codable, CaseIterable, Sendable {
    case beforeSunrise = "before_sunrise"
    case daylight
    case afterSunset = "after_sunset"
}

enum ForecastHourKindDTO: String, Codable, CaseIterable, Sendable {
    case current
    case clock
}

enum ForecastDayKindDTO: String, Codable, CaseIterable, Sendable {
    case today
    case weekday
}

enum WeatherDTOMappingError: Error, Equatable {
    case missingDaylightFraction
    case invalidDaylightFraction(Double)
    case missingClockTime
    case invalidClockTime(hour: Int, minute: Int)
    case missingWeekday
    case invalidWeekday(Int)
    case invalidWindDirection(Double)
}

extension WeatherReport {
    init(dto: WeatherReportDTO) throws {
        var hourly: [HourlyForecast] = []
        hourly.reserveCapacity(dto.hourly.count)
        for forecast in dto.hourly {
            hourly.append(try HourlyForecast(dto: forecast))
        }

        var daily: [DailyForecast] = []
        daily.reserveCapacity(dto.daily.count)
        for forecast in dto.daily {
            daily.append(try DailyForecast(dto: forecast))
        }

        self.init(
            current: try CurrentWeather(dto: dto.current),
            hourly: hourly,
            daily: daily,
            precipitationDetailCurrent: try CurrentWeather(dto: dto.precipitationDetailCurrent)
        )
    }
}

extension WeatherLocation {
    init(dto: WeatherLocationDTO) throws {
        self.init(
            id: dto.id,
            name: dto.name,
            subtitle: dto.subtitle,
            country: dto.country,
            temperatureC: dto.temperatureC,
            highC: dto.highC,
            lowC: dto.lowC,
            condition: WeatherCondition(dto: dto.condition),
            localTime: try LocalClockTime(dto: dto.localTime)
        )
    }
}

extension CurrentWeather {
    init(dto: CurrentWeatherDTO) throws {
        guard (0...360).contains(dto.windDirectionDegrees) else {
            throw WeatherDTOMappingError.invalidWindDirection(dto.windDirectionDegrees)
        }

        let windDirectionDegrees = dto.windDirectionDegrees == 360 ? 0 : dto.windDirectionDegrees

        self.init(
            id: dto.id,
            temperatureC: dto.temperatureC,
            highC: dto.highC,
            lowC: dto.lowC,
            feelsLikeC: dto.feelsLikeC,
            dewPointC: dto.dewPointC,
            condition: WeatherCondition(dto: dto.condition),
            solarProgress: try SolarDayProgress(dto: dto.solarProgress),
            sunrise: try LocalClockTime(dto: dto.sunrise),
            sunset: try LocalClockTime(dto: dto.sunset),
            airQualityIndex: dto.airQualityIndex,
            airQualityCategory: AirQualityCategory(dto: dto.airQualityCategory),
            uvIndex: dto.uvIndex,
            uvCategory: UVIndexCategory(dto: dto.uvCategory),
            windKph: dto.windKph,
            windDirection: WindDirection(degrees: windDirectionDegrees),
            humidity: dto.humidity,
            visibilityKilometers: dto.visibilityKilometers,
            pressureMillibars: dto.pressureMillibars,
            pressureTrend: PressureTrend(dto: dto.pressureTrend),
            precipChance: dto.precipChance
        )
    }
}

extension HourlyForecast {
    init(dto: HourlyForecastDTO) throws {
        self.init(
            id: dto.id,
            hour: try ForecastHour(dto: dto.hour),
            temperatureC: dto.temperatureC,
            condition: WeatherCondition(dto: dto.condition)
        )
    }
}

extension DailyForecast {
    init(dto: DailyForecastDTO) throws {
        self.init(
            id: dto.id,
            day: try ForecastDay(dto: dto.day),
            condition: WeatherCondition(dto: dto.condition),
            lowC: dto.lowC,
            highC: dto.highC,
            weekLowC: dto.weekLowC,
            weekHighC: dto.weekHighC
        )
    }
}

private extension LocalClockTime {
    init(dto: LocalClockTimeDTO) throws {
        guard (0...23).contains(dto.hour), (0...59).contains(dto.minute) else {
            throw WeatherDTOMappingError.invalidClockTime(hour: dto.hour, minute: dto.minute)
        }

        self.init(hour: dto.hour, minute: dto.minute)
    }
}

private extension SolarDayProgress {
    init(dto: SolarDayProgressDTO) throws {
        switch dto.kind {
        case .beforeSunrise:
            self = .beforeSunrise
        case .daylight:
            guard let fraction = dto.daylightFraction else {
                throw WeatherDTOMappingError.missingDaylightFraction
            }
            guard (0...1).contains(fraction) else {
                throw WeatherDTOMappingError.invalidDaylightFraction(fraction)
            }
            self = .daylightFraction(fraction)
        case .afterSunset:
            self = .afterSunset
        }
    }
}

private extension ForecastHour {
    init(dto: ForecastHourDTO) throws {
        switch dto.kind {
        case .current:
            self = .current
        case .clock:
            guard let hour = dto.hour, let minute = dto.minute else {
                throw WeatherDTOMappingError.missingClockTime
            }
            self = .clock(try LocalClockTime(dto: LocalClockTimeDTO(hour: hour, minute: minute)))
        }
    }
}

private extension ForecastDay {
    init(dto: ForecastDayDTO) throws {
        switch dto.kind {
        case .today:
            self = .today
        case .weekday:
            guard let weekdayRawValue = dto.weekdayRawValue else {
                throw WeatherDTOMappingError.missingWeekday
            }
            guard let weekday = Weekday(rawValue: weekdayRawValue) else {
                throw WeatherDTOMappingError.invalidWeekday(weekdayRawValue)
            }
            self = .weekday(weekday)
        }
    }
}

private extension WeatherCondition {
    init(dto: WeatherConditionDTO) {
        switch dto {
        case .sunny: self = .sunny
        case .mostlySunny: self = .mostlySunny
        case .partlyCloudy: self = .partlyCloudy
        case .cloudy: self = .cloudy
        case .clearDay: self = .clearDay
        case .clearNight: self = .clearNight
        case .lightRain: self = .lightRain
        case .heavyRain: self = .heavyRain
        case .lightSnow: self = .lightSnow
        case .snowShowers: self = .snowShowers
        case .thunderstorms: self = .thunderstorms
        case .hazy: self = .hazy
        }
    }
}

private extension AirQualityCategory {
    init(dto: AirQualityCategoryDTO) {
        switch dto {
        case .good: self = .good
        case .moderate: self = .moderate
        case .unhealthyForSensitiveGroups: self = .unhealthyForSensitiveGroups
        case .unhealthy: self = .unhealthy
        case .veryUnhealthy: self = .veryUnhealthy
        case .hazardous: self = .hazardous
        }
    }
}

private extension UVIndexCategory {
    init(dto: UVIndexCategoryDTO) {
        switch dto {
        case .none: self = .none
        case .low: self = .low
        case .moderate: self = .moderate
        case .high: self = .high
        case .veryHigh: self = .veryHigh
        case .extreme: self = .extreme
        }
    }
}

private extension PressureTrend {
    init(dto: PressureTrendDTO) {
        switch dto {
        case .rising: self = .rising
        case .steady: self = .steady
        case .falling: self = .falling
        }
    }
}
