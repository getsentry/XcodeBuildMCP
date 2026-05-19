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
    private let weatherService: WeatherService = .mock

    var body: some Scene {
        WindowGroup {
            ContentView(weatherService: weatherService)
        }
    }
}
