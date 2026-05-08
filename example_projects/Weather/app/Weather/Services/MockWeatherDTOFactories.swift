import Foundation

enum MockWeatherScenario: Sendable {
    case clearDay
    case rainy
    case snowy
    case night
    case stormy
}

struct MockWeatherDTOFixtures: Sendable {
    let locations: [WeatherLocationDTO]
    let searchPool: [WeatherLocationDTO]
    let scenarioByLocationID: [WeatherLocation.ID: MockWeatherScenario]

    init() {
        locations = [
            .mock(id: "loc-current-san-francisco", name: "San Francisco", subtitle: "Current Location", country: nil, temperature: 18, high: 20, low: 12, condition: .mostlySunny, time: clock(13, 24)),
            .mock(id: "loc-us-or-portland", name: "Portland", subtitle: "Oregon, USA", country: nil, temperature: 11, high: 13, low: 9, condition: .lightRain, time: clock(13, 24)),
            .mock(id: "loc-us-co-aspen", name: "Aspen", subtitle: "Colorado, USA", country: nil, temperature: -4, high: -2, low: -10, condition: .lightSnow, time: clock(14, 24)),
            .mock(id: "loc-is-reykjavik", name: "Reykjavík", subtitle: "Iceland", country: nil, temperature: 3, high: 6, low: 1, condition: .clearNight, time: clock(20, 24)),
            .mock(id: "loc-us-la-new-orleans", name: "New Orleans", subtitle: "Louisiana, USA", country: nil, temperature: 22, high: 26, low: 20, condition: .thunderstorms, time: clock(15, 24)),
            .mock(id: "loc-jp-tokyo", name: "Tokyo", subtitle: "Japan", country: nil, temperature: 14, high: 17, low: 11, condition: .partlyCloudy, time: clock(5, 24)),
            .mock(id: "loc-pt-lisbon", name: "Lisbon", subtitle: "Portugal", country: nil, temperature: 19, high: 22, low: 14, condition: .sunny, time: clock(21, 24)),
        ]

        searchPool = [
            .mock(id: "loc-fr-paris", name: "Paris", subtitle: "Île-de-France, France", country: "FR", temperature: 15, high: 18, low: 11, condition: .partlyCloudy, time: clock(22, 24)),
            .mock(id: "loc-gb-london", name: "London", subtitle: "England, United Kingdom", country: "GB", temperature: 13, high: 16, low: 9, condition: .lightRain, time: clock(21, 24)),
            .mock(id: "loc-de-berlin", name: "Berlin", subtitle: "Germany", country: "DE", temperature: 11, high: 14, low: 7, condition: .cloudy, time: clock(22, 24)),
            .mock(id: "loc-us-ny-new-york", name: "New York", subtitle: "New York, USA", country: "US", temperature: 16, high: 19, low: 12, condition: .sunny, time: clock(16, 24)),
            .mock(id: "loc-au-sydney", name: "Sydney", subtitle: "New South Wales, Australia", country: "AU", temperature: 22, high: 25, low: 18, condition: .sunny, time: clock(6, 24)),
            .mock(id: "loc-sg-singapore", name: "Singapore", subtitle: "Singapore", country: "SG", temperature: 29, high: 31, low: 26, condition: .thunderstorms, time: clock(4, 24)),
            .mock(id: "loc-in-mumbai", name: "Mumbai", subtitle: "Maharashtra, India", country: "IN", temperature: 31, high: 33, low: 26, condition: .hazy, time: clock(1, 54)),
            .mock(id: "loc-eg-cairo", name: "Cairo", subtitle: "Egypt", country: "EG", temperature: 28, high: 32, low: 19, condition: .sunny, time: clock(23, 24)),
            .mock(id: "loc-za-cape-town", name: "Cape Town", subtitle: "Western Cape, South Africa", country: "ZA", temperature: 20, high: 23, low: 14, condition: .mostlySunny, time: clock(23, 24)),
            .mock(id: "loc-is-capital-reykjavik", name: "Reykjavík", subtitle: "Capital Region, Iceland", country: "IS", temperature: 3, high: 6, low: 1, condition: .clearNight, time: clock(20, 24)),
            .mock(id: "loc-no-oslo", name: "Oslo", subtitle: "Norway", country: "NO", temperature: 5, high: 8, low: 1, condition: .snowShowers, time: clock(22, 24)),
            .mock(id: "loc-se-stockholm", name: "Stockholm", subtitle: "Sweden", country: "SE", temperature: 6, high: 9, low: 2, condition: .partlyCloudy, time: clock(22, 24)),
            .mock(id: "loc-ca-vancouver", name: "Vancouver", subtitle: "British Columbia, Canada", country: "CA", temperature: 9, high: 12, low: 6, condition: .lightRain, time: clock(13, 24)),
            .mock(id: "loc-ca-toronto", name: "Toronto", subtitle: "Ontario, Canada", country: "CA", temperature: 8, high: 12, low: 5, condition: .cloudy, time: clock(16, 24)),
            .mock(id: "loc-mx-mexico-city", name: "Mexico City", subtitle: "Mexico", country: "MX", temperature: 22, high: 26, low: 13, condition: .sunny, time: clock(14, 24)),
            .mock(id: "loc-ar-buenos-aires", name: "Buenos Aires", subtitle: "Argentina", country: "AR", temperature: 18, high: 21, low: 13, condition: .partlyCloudy, time: clock(17, 24)),
            .mock(id: "loc-kr-seoul", name: "Seoul", subtitle: "South Korea", country: "KR", temperature: 13, high: 17, low: 8, condition: .clearDay, time: clock(5, 24)),
            .mock(id: "loc-th-bangkok", name: "Bangkok", subtitle: "Thailand", country: "TH", temperature: 32, high: 34, low: 26, condition: .thunderstorms, time: clock(3, 24)),
            .mock(id: "loc-ae-dubai", name: "Dubai", subtitle: "United Arab Emirates", country: "AE", temperature: 33, high: 37, low: 26, condition: .sunny, time: clock(0, 24)),
            .mock(id: "loc-es-madrid", name: "Madrid", subtitle: "Spain", country: "ES", temperature: 19, high: 22, low: 12, condition: .sunny, time: clock(22, 24)),
        ]

        scenarioByLocationID = [
            "loc-current-san-francisco": .clearDay,
            "loc-us-or-portland": .rainy,
            "loc-us-co-aspen": .snowy,
            "loc-is-reykjavik": .night,
            "loc-us-la-new-orleans": .stormy,
            "loc-jp-tokyo": .clearDay,
            "loc-pt-lisbon": .clearDay,
            "loc-fr-paris": .clearDay,
            "loc-gb-london": .rainy,
            "loc-de-berlin": .rainy,
            "loc-us-ny-new-york": .clearDay,
            "loc-au-sydney": .clearDay,
            "loc-sg-singapore": .stormy,
            "loc-in-mumbai": .clearDay,
            "loc-eg-cairo": .clearDay,
            "loc-za-cape-town": .clearDay,
            "loc-is-capital-reykjavik": .night,
            "loc-no-oslo": .snowy,
            "loc-se-stockholm": .rainy,
            "loc-ca-vancouver": .rainy,
            "loc-ca-toronto": .rainy,
            "loc-mx-mexico-city": .clearDay,
            "loc-ar-buenos-aires": .clearDay,
            "loc-kr-seoul": .clearDay,
            "loc-th-bangkok": .stormy,
            "loc-ae-dubai": .clearDay,
            "loc-es-madrid": .clearDay,
        ]
    }
}

extension CurrentWeatherDTO {
    static func mock(for scenario: MockWeatherScenario) -> CurrentWeatherDTO {
        switch scenario {
        case .clearDay:
            CurrentWeatherDTO(
                id: "weather-current-loc-current-san-francisco",
                temperatureC: 18, highC: 20, lowC: 12, feelsLikeC: 17, dewPointC: 9, condition: .mostlySunny,
                solarProgress: .daylight(0.62), sunrise: clock(6, 18), sunset: clock(19, 42), airQualityIndex: 38, airQualityCategory: .good,
                uvIndex: 6, uvCategory: .high, windKph: 13, windDirectionDegrees: 292, humidity: 64,
                visibilityKilometers: 16.1, pressureMillibars: 1018, pressureTrend: .rising, precipChance: 5
            )
        case .rainy:
            CurrentWeatherDTO(
                id: "weather-current-loc-us-or-portland",
                temperatureC: 11, highC: 13, lowC: 9, feelsLikeC: 9, dewPointC: 8, condition: .lightRain,
                solarProgress: .daylight(0.45), sunrise: clock(6, 42), sunset: clock(19, 18), airQualityIndex: 22, airQualityCategory: .good,
                uvIndex: 1, uvCategory: .low, windKph: 23, windDirectionDegrees: 225, humidity: 89,
                visibilityKilometers: 9.7, pressureMillibars: 1006, pressureTrend: .falling, precipChance: 78
            )
        case .snowy:
            CurrentWeatherDTO(
                id: "weather-current-loc-us-co-aspen",
                temperatureC: -4, highC: -2, lowC: -10, feelsLikeC: -8, dewPointC: -7, condition: .lightSnow,
                solarProgress: .daylight(0.50), sunrise: clock(7, 14), sunset: clock(17, 38), airQualityIndex: 18, airQualityCategory: .good,
                uvIndex: 2, uvCategory: .low, windKph: 10, windDirectionDegrees: 0, humidity: 78,
                visibilityKilometers: 6.4, pressureMillibars: 1022, pressureTrend: .steady, precipChance: 65
            )
        case .night:
            CurrentWeatherDTO(
                id: "weather-current-loc-is-reykjavik",
                temperatureC: 3, highC: 6, lowC: 1, feelsLikeC: 1, dewPointC: 0, condition: .clearNight,
                solarProgress: .afterSunset, sunrise: clock(5, 46), sunset: clock(20, 24), airQualityIndex: 12, airQualityCategory: .good,
                uvIndex: 0, uvCategory: .none, windKph: 6, windDirectionDegrees: 45, humidity: 71,
                visibilityKilometers: 16.1, pressureMillibars: 1014, pressureTrend: .steady, precipChance: 8
            )
        case .stormy:
            CurrentWeatherDTO(
                id: "weather-current-loc-us-la-new-orleans",
                temperatureC: 22, highC: 26, lowC: 20, feelsLikeC: 24, dewPointC: 19, condition: .thunderstorms,
                solarProgress: .daylight(0.78), sunrise: clock(6, 8), sunset: clock(19, 52), airQualityIndex: 55, airQualityCategory: .moderate,
                uvIndex: 3, uvCategory: .moderate, windKph: 35, windDirectionDegrees: 180, humidity: 86,
                visibilityKilometers: 4.8, pressureMillibars: 998, pressureTrend: .falling, precipChance: 92
            )
        }
    }
}

extension HourlyForecastDTO {
    static func mockForecast(for scenario: MockWeatherScenario) -> [HourlyForecastDTO] {
        switch scenario {
        case .clearDay:
            [mock(.current, 18, .sunny), mock(.clock(clock(14)), 19, .sunny), mock(.clock(clock(15)), 19, .sunny), mock(.clock(clock(16)), 20, .sunny), mock(.clock(clock(17)), 19, .sunny), mock(.clock(clock(18)), 18, .partlyCloudy), mock(.clock(clock(19)), 17, .partlyCloudy), mock(.clock(clock(20)), 16, .clearNight), mock(.clock(clock(21)), 14, .clearNight), mock(.clock(clock(22)), 13, .clearNight), mock(.clock(clock(23)), 13, .clearNight), mock(.clock(clock(0)), 12, .clearNight)]
        case .rainy:
            [mock(.current, 11, .lightRain), mock(.clock(clock(14)), 12, .lightRain), mock(.clock(clock(15)), 12, .lightRain), mock(.clock(clock(16)), 13, .heavyRain), mock(.clock(clock(17)), 12, .heavyRain), mock(.clock(clock(18)), 12, .lightRain), mock(.clock(clock(19)), 11, .lightRain), mock(.clock(clock(20)), 11, .cloudy), mock(.clock(clock(21)), 10, .cloudy), mock(.clock(clock(22)), 9, .cloudy), mock(.clock(clock(23)), 9, .lightRain), mock(.clock(clock(0)), 9, .lightRain)]
        case .snowy:
            [mock(.current, -4, .lightSnow), mock(.clock(clock(14)), -3, .lightSnow), mock(.clock(clock(15)), -3, .lightSnow), mock(.clock(clock(16)), -2, .cloudy), mock(.clock(clock(17)), -3, .cloudy), mock(.clock(clock(18)), -4, .lightSnow), mock(.clock(clock(19)), -6, .lightSnow), mock(.clock(clock(20)), -7, .lightSnow), mock(.clock(clock(21)), -8, .lightSnow), mock(.clock(clock(22)), -9, .cloudy), mock(.clock(clock(23)), -9, .cloudy), mock(.clock(clock(0)), -10, .clearNight)]
        case .night:
            [mock(.current, 3, .clearNight), mock(.clock(clock(23)), 3, .clearNight), mock(.clock(clock(0)), 2, .clearNight), mock(.clock(clock(1)), 2, .clearNight), mock(.clock(clock(2)), 1, .clearNight), mock(.clock(clock(3)), 1, .clearNight), mock(.clock(clock(4)), 1, .clearNight), mock(.clock(clock(5)), 1, .clearNight), mock(.clock(clock(6)), 2, .partlyCloudy), mock(.clock(clock(7)), 3, .sunny), mock(.clock(clock(8)), 4, .sunny), mock(.clock(clock(9)), 6, .sunny)]
        case .stormy:
            [mock(.current, 22, .thunderstorms), mock(.clock(clock(14)), 23, .thunderstorms), mock(.clock(clock(15)), 24, .heavyRain), mock(.clock(clock(16)), 24, .heavyRain), mock(.clock(clock(17)), 26, .thunderstorms), mock(.clock(clock(18)), 26, .thunderstorms), mock(.clock(clock(19)), 25, .lightRain), mock(.clock(clock(20)), 23, .lightRain), mock(.clock(clock(21)), 22, .cloudy), mock(.clock(clock(22)), 21, .cloudy), mock(.clock(clock(23)), 21, .cloudy), mock(.clock(clock(0)), 20, .cloudy)]
        }
    }

    static func mock(_ hour: ForecastHourDTO, _ temperature: Int, _ condition: WeatherConditionDTO) -> HourlyForecastDTO {
        HourlyForecastDTO(id: "hourly-\(hour.idComponent)-\(temperature)-\(condition.rawValue)", hour: hour, temperatureC: temperature, condition: condition)
    }
}

extension DailyForecastDTO {
    static func mockForecast(for scenario: MockWeatherScenario) -> [DailyForecastDTO] {
        switch scenario {
        case .clearDay:
            [mock(.today, .sunny, 12, 20, 9, 23), mock(.weekday(.wednesday), .sunny, 13, 21, 9, 23), mock(.weekday(.thursday), .partlyCloudy, 13, 21, 9, 23), mock(.weekday(.friday), .cloudy, 11, 19, 9, 23), mock(.weekday(.saturday), .lightRain, 9, 16, 9, 23), mock(.weekday(.sunday), .lightRain, 9, 14, 9, 23), mock(.weekday(.monday), .sunny, 11, 19, 9, 23)]
        case .rainy:
            [mock(.today, .lightRain, 9, 13, 6, 17), mock(.weekday(.wednesday), .lightRain, 8, 12, 6, 17), mock(.weekday(.thursday), .cloudy, 8, 13, 6, 17), mock(.weekday(.friday), .cloudy, 9, 14, 6, 17), mock(.weekday(.saturday), .partlyCloudy, 10, 17, 6, 17), mock(.weekday(.sunday), .sunny, 9, 16, 6, 17), mock(.weekday(.monday), .lightRain, 6, 12, 6, 17)]
        case .snowy:
            [mock(.today, .lightSnow, -10, -2, -13, 1), mock(.weekday(.wednesday), .lightSnow, -11, -3, -13, 1), mock(.weekday(.thursday), .cloudy, -9, -1, -13, 1), mock(.weekday(.friday), .partlyCloudy, -7, 1, -13, 1), mock(.weekday(.saturday), .sunny, -8, 0, -13, 1), mock(.weekday(.sunday), .lightSnow, -12, -6, -13, 1), mock(.weekday(.monday), .lightSnow, -13, -8, -13, 1)]
        case .night:
            [mock(.today, .clearNight, 1, 6, -1, 9), mock(.weekday(.wednesday), .sunny, 2, 8, -1, 9), mock(.weekday(.thursday), .cloudy, 2, 7, -1, 9), mock(.weekday(.friday), .lightRain, 1, 5, -1, 9), mock(.weekday(.saturday), .lightRain, 0, 4, -1, 9), mock(.weekday(.sunday), .sunny, 2, 8, -1, 9), mock(.weekday(.monday), .sunny, 3, 9, -1, 9)]
        case .stormy:
            [mock(.today, .thunderstorms, 20, 26, 18, 31), mock(.weekday(.wednesday), .lightRain, 21, 28, 18, 31), mock(.weekday(.thursday), .cloudy, 22, 29, 18, 31), mock(.weekday(.friday), .partlyCloudy, 22, 30, 18, 31), mock(.weekday(.saturday), .sunny, 23, 31, 18, 31), mock(.weekday(.sunday), .sunny, 21, 29, 18, 31), mock(.weekday(.monday), .thunderstorms, 19, 24, 18, 31)]
        }
    }

    static func mock(_ day: ForecastDayDTO, _ condition: WeatherConditionDTO, _ low: Int, _ high: Int, _ weekLow: Int, _ weekHigh: Int) -> DailyForecastDTO {
        DailyForecastDTO(id: "daily-\(day.idComponent)-\(condition.rawValue)-\(low)-\(high)", day: day, condition: condition, lowC: low, highC: high, weekLowC: weekLow, weekHighC: weekHigh)
    }
}

private extension WeatherLocationDTO {
    static func mock(
        id: String,
        name: String,
        subtitle: String,
        country: String?,
        temperature: Int,
        high: Int,
        low: Int,
        condition: WeatherConditionDTO,
        time: LocalClockTimeDTO,
    ) -> WeatherLocationDTO {
        WeatherLocationDTO(
            id: id,
            name: name,
            subtitle: subtitle,
            country: country,
            temperatureC: temperature,
            highC: high,
            lowC: low,
            condition: condition,
            localTime: time
        )
    }
}

private extension SolarDayProgressDTO {
    static func daylight(_ fraction: Double) -> SolarDayProgressDTO {
        SolarDayProgressDTO(kind: .daylight, daylightFraction: fraction)
    }

    static var afterSunset: SolarDayProgressDTO {
        SolarDayProgressDTO(kind: .afterSunset, daylightFraction: nil)
    }
}

private extension ForecastHourDTO {
    static var current: ForecastHourDTO {
        ForecastHourDTO(kind: .current, hour: nil, minute: nil)
    }

    static func clock(_ time: LocalClockTimeDTO) -> ForecastHourDTO {
        ForecastHourDTO(kind: .clock, hour: time.hour, minute: time.minute)
    }

    var idComponent: String {
        switch kind {
        case .current:
            "now"
        case .clock:
            "\(hour ?? 0)-\(minute ?? 0)"
        }
    }
}

private extension ForecastDayDTO {
    static var today: ForecastDayDTO {
        ForecastDayDTO(kind: .today, weekdayRawValue: nil)
    }

    static func weekday(_ weekday: Weekday) -> ForecastDayDTO {
        ForecastDayDTO(kind: .weekday, weekdayRawValue: weekday.rawValue)
    }

    var idComponent: String {
        switch kind {
        case .today:
            "today"
        case .weekday:
            "weekday-\(weekdayRawValue ?? 0)"
        }
    }
}

private func clock(_ hour: Int, _ minute: Int = 0) -> LocalClockTimeDTO {
    LocalClockTimeDTO(hour: hour, minute: minute)
}
