import Foundation

struct WeatherService: Sendable {
    private let apiClient: any WeatherAPIClient

    init(apiClient: any WeatherAPIClient) {
        self.apiClient = apiClient
    }

    func defaultLocations() async throws -> [WeatherLocation] {
        try await apiClient.defaultLocations().map { dto in
            try WeatherLocation(dto: dto)
        }
    }

    func weather(for locationID: WeatherLocation.ID) async throws -> WeatherReport {
        let dto = try await apiClient.weather(for: locationID)
        return try WeatherReport(dto: dto)
    }

    func searchLocations(matching query: String) async throws -> [WeatherLocation] {
        try await apiClient.searchLocations(matching: query).map { dto in
            try WeatherLocation(dto: dto)
        }
    }
}

extension WeatherService {
    static var production: WeatherService {
        WeatherService(apiClient: URLSessionWeatherAPIClient(configuration: .production))
    }

    static var mock: WeatherService {
        WeatherService(apiClient: MockWeatherAPIClient())
    }
}
