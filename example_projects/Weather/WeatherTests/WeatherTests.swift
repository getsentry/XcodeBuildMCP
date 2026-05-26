//
//  WeatherTests.swift
//  WeatherTests
//
//  Created by Cameron on 30/04/2026.
//

import Foundation
import Testing
@testable import Weather

@MainActor
struct WeatherTests {

    @Test func temperatureFormattingMatchesPrototypeRules() {
        var units = WeatherUnits()
        #expect(WeatherUnitFormatter.temperature(20, units: units) == 68)

        units.temperature = .celsius
        #expect(WeatherUnitFormatter.temperature(20, units: units) == 20)
        #expect(WeatherUnitFormatter.temperature(11, units: units) == 11)
    }

    @Test func windPressureAndDistanceFormattingMatchPrototypeRules() {
        var units = WeatherUnits()
        units.wind = .mph
        #expect(WeatherUnitFormatter.wind(23, units: units) == FormattedMeasurement(value: "14", unit: "mph"))

        units.wind = .metersPerSecond
        #expect(WeatherUnitFormatter.wind(23, units: units) == FormattedMeasurement(value: "6.4", unit: "m/s"))

        units.pressure = .inchesMercury
        #expect(WeatherUnitFormatter.pressure(1018, units: units) == FormattedMeasurement(value: "30.06", unit: "inHg"))

        units.distance = .miles
        #expect(WeatherUnitFormatter.distance(16.1, units: units) == FormattedMeasurement(value: "10", unit: "mi"))
    }

    @Test func mockSearchIsCaseInsensitiveAcrossNameSubtitleAndCountry() async throws {
        let service = WeatherService(apiClient: MockWeatherAPIClient())

        let byName = try await service.searchLocations(matching: "london")
        #expect(byName.contains { $0.name == "London" })

        let bySubtitle = try await service.searchLocations(matching: "united kingdom")
        #expect(bySubtitle.map(\.name).contains("London"))

        let byCountry = try await service.searchLocations(matching: "gb")
        #expect(byCountry.map(\.name).contains("London"))

        let savedLocationByName = try await service.searchLocations(matching: "tokyo")
        #expect(savedLocationByName.contains { $0.name == "Tokyo" })
    }

    @Test func emptySearchReturnsNoResults() async throws {
        let results = try await WeatherService(apiClient: MockWeatherAPIClient()).searchLocations(matching: "   ")
        #expect(results.isEmpty)
    }

    @Test func weatherServiceMapsDTOsToDomainModels() async throws {
        let service = WeatherService(apiClient: MockWeatherAPIClient())

        let locations = try await service.defaultLocations()
        #expect(locations.first == WeatherLocation(
            id: "loc-current-san-francisco",
            name: "San Francisco",
            subtitle: "Current Location",
            country: nil,
            temperatureC: 18,
            highC: 20,
            lowC: 12,
            condition: .mostlySunny,
            localTime: LocalClockTime(hour: 13, minute: 24)
        ))

        let report = try await service.weather(for: "loc-current-san-francisco")
        #expect(report.current == CurrentWeather(
            id: "weather-current-loc-current-san-francisco",
            temperatureC: 18,
            highC: 20,
            lowC: 12,
            feelsLikeC: 17,
            dewPointC: 9,
            condition: .mostlySunny,
            solarProgress: .daylightFraction(0.62),
            sunrise: LocalClockTime(hour: 6, minute: 18),
            sunset: LocalClockTime(hour: 19, minute: 42),
            airQualityIndex: 38,
            airQualityCategory: .good,
            uvIndex: 6,
            uvCategory: .high,
            windKph: 13,
            windDirection: WindDirection(degrees: 292),
            humidity: 64,
            visibilityKilometers: 16.1,
            pressureMillibars: 1018,
            pressureTrend: .rising,
            precipChance: 5
        ))
        #expect(report.hourly.first?.condition == .sunny)
        #expect(report.daily.first?.day == .today)
    }

    @Test func defaultLocationsFixtureDecodesAsExpectedDTOs() throws {
        let decoded: WeatherLocationsResponseDTO = try decodeFixture(named: "default-locations")

        #expect(decoded.locations == [
            WeatherLocationDTO(
                id: "loc-current-san-francisco",
                name: "San Francisco",
                subtitle: "Current Location",
                country: nil,
                temperatureC: 18,
                highC: 20,
                lowC: 12,
                condition: .mostlySunny,
                localTime: LocalClockTimeDTO(hour: 13, minute: 24)
            ),
            WeatherLocationDTO(
                id: "loc-us-or-portland",
                name: "Portland",
                subtitle: "Oregon, USA",
                country: nil,
                temperatureC: 11,
                highC: 13,
                lowC: 9,
                condition: .lightRain,
                localTime: LocalClockTimeDTO(hour: 13, minute: 24)
            ),
        ])
    }

    @Test func searchLocationsFixtureDecodesAsExpectedDTOs() throws {
        let decoded: WeatherLocationsResponseDTO = try decodeFixture(named: "search-locations")

        #expect(decoded.locations == [
            WeatherLocationDTO(
                id: "loc-gb-london",
                name: "London",
                subtitle: "England, United Kingdom",
                country: "GB",
                temperatureC: 13,
                highC: 16,
                lowC: 9,
                condition: .lightRain,
                localTime: LocalClockTimeDTO(hour: 21, minute: 24)
            ),
            WeatherLocationDTO(
                id: "loc-fr-paris",
                name: "Paris",
                subtitle: "Île-de-France, France",
                country: "FR",
                temperatureC: 15,
                highC: 18,
                lowC: 11,
                condition: .partlyCloudy,
                localTime: LocalClockTimeDTO(hour: 22, minute: 24)
            ),
        ])
    }

    @Test func solarProgressKindDecodesSnakeCaseValues() throws {
        let decoder = JSONDecoder()

        let beforeSunrise = try decoder.decode(
            SolarDayProgressDTO.self,
            from: Data(#"{"kind":"before_sunrise","daylightFraction":null}"#.utf8)
        )
        #expect(beforeSunrise == SolarDayProgressDTO(kind: .beforeSunrise, daylightFraction: nil))

        let afterSunset = try decoder.decode(
            SolarDayProgressDTO.self,
            from: Data(#"{"kind":"after_sunset","daylightFraction":null}"#.utf8)
        )
        #expect(afterSunset == SolarDayProgressDTO(kind: .afterSunset, daylightFraction: nil))
    }

    @Test func invalidClockTimeThrowsMappingError() throws {
        let location = WeatherLocationDTO(
            id: "invalid-time",
            name: "Invalid Time",
            subtitle: "Fixture",
            country: nil,
            temperatureC: 18,
            highC: 20,
            lowC: 12,
            condition: .sunny,
            localTime: LocalClockTimeDTO(hour: 25, minute: 0)
        )

        #expect(throws: WeatherDTOMappingError.invalidClockTime(hour: 25, minute: 0)) {
            _ = try WeatherLocation(dto: location)
        }
    }

    @Test func windDirection360MapsToNorth() throws {
        let dto = CurrentWeatherDTO(
            id: "north-wind",
            temperatureC: 10,
            highC: 12,
            lowC: 8,
            feelsLikeC: 9,
            dewPointC: 8,
            condition: .sunny,
            solarProgress: SolarDayProgressDTO(kind: .daylight, daylightFraction: 0.5),
            sunrise: LocalClockTimeDTO(hour: 6, minute: 0),
            sunset: LocalClockTimeDTO(hour: 18, minute: 0),
            airQualityIndex: 10,
            airQualityCategory: .good,
            uvIndex: 1,
            uvCategory: .low,
            windKph: 12,
            windDirectionDegrees: 360,
            humidity: 50,
            visibilityKilometers: 10,
            pressureMillibars: 1_013,
            pressureTrend: .steady,
            precipChance: 0
        )

        let current = try CurrentWeather(dto: dto)

        #expect(current.windDirection == WindDirection(degrees: 0))
    }

    @Test func weatherFixtureDecodesAsExpectedDTO() throws {
        let decoded: WeatherReportDTO = try decodeFixture(named: "weather-report-loc-current-san-francisco")

        #expect(decoded == WeatherReportDTO(
            current: CurrentWeatherDTO(
                id: "weather-current-loc-current-san-francisco",
                temperatureC: 18,
                highC: 20,
                lowC: 12,
                feelsLikeC: 17,
                dewPointC: 9,
                condition: .mostlySunny,
                solarProgress: SolarDayProgressDTO(kind: .daylight, daylightFraction: 0.62),
                sunrise: LocalClockTimeDTO(hour: 6, minute: 18),
                sunset: LocalClockTimeDTO(hour: 19, minute: 42),
                airQualityIndex: 38,
                airQualityCategory: .good,
                uvIndex: 6,
                uvCategory: .high,
                windKph: 13,
                windDirectionDegrees: 292,
                humidity: 64,
                visibilityKilometers: 16.1,
                pressureMillibars: 1018,
                pressureTrend: .rising,
                precipChance: 5
            ),
            hourly: [
                HourlyForecastDTO(
                    id: "hourly-now-18-sunny",
                    hour: ForecastHourDTO(kind: .current, hour: nil, minute: nil),
                    temperatureC: 18,
                    condition: .sunny
                ),
                HourlyForecastDTO(
                    id: "hourly-14-0-19-sunny",
                    hour: ForecastHourDTO(kind: .clock, hour: 14, minute: 0),
                    temperatureC: 19,
                    condition: .sunny
                ),
            ],
            daily: [
                DailyForecastDTO(
                    id: "daily-today-sunny-12-20",
                    day: ForecastDayDTO(kind: .today, weekdayRawValue: nil),
                    condition: .sunny,
                    lowC: 12,
                    highC: 20,
                    weekLowC: 9,
                    weekHighC: 23
                ),
                DailyForecastDTO(
                    id: "daily-weekday-5-partly_cloudy-13-21",
                    day: ForecastDayDTO(kind: .weekday, weekdayRawValue: 5),
                    condition: .partlyCloudy,
                    lowC: 13,
                    highC: 21,
                    weekLowC: 9,
                    weekHighC: 23
                ),
            ],
            precipitationDetailCurrent: CurrentWeatherDTO(
                id: "weather-current-loc-us-or-portland",
                temperatureC: 11,
                highC: 13,
                lowC: 9,
                feelsLikeC: 9,
                dewPointC: 8,
                condition: .lightRain,
                solarProgress: SolarDayProgressDTO(kind: .daylight, daylightFraction: 0.45),
                sunrise: LocalClockTimeDTO(hour: 6, minute: 42),
                sunset: LocalClockTimeDTO(hour: 19, minute: 18),
                airQualityIndex: 22,
                airQualityCategory: .good,
                uvIndex: 1,
                uvCategory: .low,
                windKph: 23,
                windDirectionDegrees: 225,
                humidity: 89,
                visibilityKilometers: 9.7,
                pressureMillibars: 1006,
                pressureTrend: .falling,
                precipChance: 78
            )
        ))
    }

    private func decodeFixture<T: Decodable>(named fileName: String, as type: T.Type = T.self) throws -> T {
        let fixtureObject = try loadFixtureJSONObject(named: fileName)
        let decoderData = try JSONSerialization.data(withJSONObject: fixtureObject)
        return try JSONDecoder().decode(type, from: decoderData)
    }


    private func loadFixtureJSONObject(named fileName: String) throws -> Any {
        let url = try #require(Bundle(for: FixtureBundleToken.self).url(forResource: fileName, withExtension: "json"))
        let data = try Data(contentsOf: url)
        return try JSONSerialization.jsonObject(with: data)
    }

}

private final class FixtureBundleToken {}
