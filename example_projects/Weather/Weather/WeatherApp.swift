//
//  WeatherApp.swift
//  Weather
//
//  Created by Cameron on 30/04/2026.
//

import SwiftUI

@main
struct WeatherApp: App {
    private let weatherService: WeatherService

    init() {
        weatherService = AppWeatherServiceFactory.makeService()
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
