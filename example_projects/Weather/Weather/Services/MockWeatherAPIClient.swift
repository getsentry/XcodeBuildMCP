import Foundation

struct MockWeatherAPIClient: WeatherAPIClient, Sendable {
    private let fixtures: MockWeatherDTOFixtures

    init(fixtures: MockWeatherDTOFixtures = MockWeatherDTOFixtures()) {
        self.fixtures = fixtures
    }

    func defaultLocations() async throws -> [WeatherLocationDTO] {
        fixtures.locations
    }

    func weather(for locationID: WeatherLocation.ID) async throws -> WeatherReportDTO {
        guard let scenario = fixtures.scenarioByLocationID[locationID] else {
            throw MockWeatherAPIClientError.unknownLocation
        }

        return WeatherReportDTO(
            current: CurrentWeatherDTO.mock(for: scenario),
            hourly: HourlyForecastDTO.mockForecast(for: scenario),
            daily: DailyForecastDTO.mockForecast(for: scenario),
            precipitationDetailCurrent: CurrentWeatherDTO.mock(for: .rainy)
        )
    }

    func searchLocations(matching query: String) async throws -> [WeatherLocationDTO] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        let needle = trimmed.localizedLowercase
        return fixtures.searchPool.filter { location in
            location.name.localizedLowercase.contains(needle)
                || location.subtitle.localizedLowercase.contains(needle)
                || (location.country?.localizedLowercase.contains(needle) ?? false)
        }
    }
}

private enum MockWeatherAPIClientError: Error {
    case unknownLocation
}
