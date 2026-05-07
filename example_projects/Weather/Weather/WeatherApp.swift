//
//  WeatherApp.swift
//  Weather
//
//  Created by Cameron on 30/04/2026.
//

import OSLog
import SwiftUI

@main
struct WeatherApp: App {
    private let weatherService: WeatherService

    init() {
        let useMock = ProcessInfo.processInfo.arguments.contains("--mock-weather-api")
        weatherService = AppWeatherServiceFactory.makeService()
        AppLog.app.notice("launch service=\(useMock ? "mock" : "production", privacy: .public)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView(weatherService: weatherService)
        }
    }
}

private enum AppWeatherServiceFactory {
    static func makeService(arguments: [String] = ProcessInfo.processInfo.arguments) -> WeatherService {
        if arguments.contains("--mock-weather-api") {
            return .mock
        }

        return .production
    }
}
