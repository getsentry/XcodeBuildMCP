import Foundation
import OSLog

struct WeatherService: Sendable {
    private let apiClient: any WeatherAPIClient

    init(apiClient: any WeatherAPIClient) {
        self.apiClient = apiClient
    }

    func defaultLocations() async throws -> [WeatherLocation] {
        let start = ContinuousClock.now
        AppLog.service.notice("defaultLocations start")
        do {
            let result = try await apiClient.defaultLocations().map { dto in
                try WeatherLocation(dto: dto)
            }
            AppLog.service.notice("defaultLocations ok count=\(result.count, privacy: .public) elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            return result
        } catch {
            AppLog.service.error("defaultLocations failed error=\(String(describing: error), privacy: .public) elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            throw error
        }
    }

    func weather(for locationID: WeatherLocation.ID) async throws -> WeatherReport {
        let start = ContinuousClock.now
        AppLog.service.notice("weather start id=\(locationID, privacy: .public)")
        do {
            let dto = try await apiClient.weather(for: locationID)
            let report = try WeatherReport(dto: dto)
            AppLog.service.notice("weather ok id=\(locationID, privacy: .public) temp=\(report.current.temperatureC, privacy: .public)C elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            return report
        } catch {
            AppLog.service.error("weather failed id=\(locationID, privacy: .public) error=\(String(describing: error), privacy: .public) elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            throw error
        }
    }

    func searchLocations(matching query: String) async throws -> [WeatherLocation] {
        let start = ContinuousClock.now
        AppLog.service.notice("search start query=\"\(query, privacy: .public)\"")
        do {
            let result = try await apiClient.searchLocations(matching: query).map { dto in
                try WeatherLocation(dto: dto)
            }
            AppLog.service.notice("search ok query=\"\(query, privacy: .public)\" count=\(result.count, privacy: .public) elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            return result
        } catch {
            AppLog.service.error("search failed query=\"\(query, privacy: .public)\" error=\(String(describing: error), privacy: .public) elapsed=\(elapsedMs(since: start), privacy: .public)ms")
            throw error
        }
    }
}

private func elapsedMs(since start: ContinuousClock.Instant) -> Int {
    let duration = ContinuousClock.now - start
    let (seconds, attoseconds) = duration.components
    return Int(seconds * 1000) + Int(attoseconds / 1_000_000_000_000_000)
}

extension WeatherService {
    static var production: WeatherService {
        WeatherService(apiClient: URLSessionWeatherAPIClient(configuration: .production))
    }

    static var mock: WeatherService {
        WeatherService(apiClient: MockWeatherAPIClient())
    }
}
