import Foundation

protocol WeatherAPIClient: Sendable {
    func defaultLocations() async throws -> [WeatherLocationDTO]
    func weather(for locationID: WeatherLocation.ID) async throws -> WeatherReportDTO
    func searchLocations(matching query: String) async throws -> [WeatherLocationDTO]
}

struct WeatherAPIConfiguration: Sendable {
    let baseURL: URL

    static let production = WeatherAPIConfiguration(
        baseURL: URL(string: "http://localhost:3001/v1")!
    )
}

struct URLSessionWeatherAPIClient: WeatherAPIClient {
    private let configuration: WeatherAPIConfiguration
    private let session: URLSession

    init(configuration: WeatherAPIConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func defaultLocations() async throws -> [WeatherLocationDTO] {
        try await request(WeatherLocationsResponseDTO.self, path: "locations/default").locations
    }

    func weather(for locationID: WeatherLocation.ID) async throws -> WeatherReportDTO {
        try await request(WeatherReportDTO.self, path: "weather/\(locationID)")
    }

    func searchLocations(matching query: String) async throws -> [WeatherLocationDTO] {
        try await request(
            WeatherLocationsResponseDTO.self,
            path: "locations/search",
            queryItems: [URLQueryItem(name: "query", value: query)]
        ).locations
    }

    private func request<Response: Decodable>(
        _ responseType: Response.Type,
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Response {
        let url = try endpointURL(path: path, queryItems: queryItems)
        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw WeatherAPIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw WeatherAPIClientError.unsuccessfulStatusCode(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func endpointURL(path: String, queryItems: [URLQueryItem]) throws -> URL {
        let url = configuration.baseURL.appending(path: path)
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw WeatherAPIClientError.invalidURL
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let endpointURL = components.url else {
            throw WeatherAPIClientError.invalidURL
        }
        return endpointURL
    }
}

enum WeatherAPIClientError: Error, Equatable {
    case invalidURL
    case invalidResponse
    case unsuccessfulStatusCode(Int)
}
