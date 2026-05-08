//
//  ContentView.swift
//  Weather
//
//  Created by Cameron on 30/04/2026.
//

import OSLog
import SwiftUI

enum WeatherSheet: Identifiable {
    case locations
    case settings
    case precipitation(current: CurrentWeather, rainyCurrent: CurrentWeather)

    var id: String {
        switch self {
        case .locations: "locations"
        case .settings: "settings"
        case .precipitation: "precipitation"
        }
    }

    var detents: Set<PresentationDetent> {
        switch self {
        case .locations: [.medium, .large]
        case .settings: [.fraction(0.62), .large]
        case .precipitation: [.large]
        }
    }
}

struct ContentView: View {
    private let weatherService: WeatherService

    @State private var selectedLocation: WeatherLocation?
    @State private var report: WeatherReport?
    @State private var activeSheet: WeatherSheet?
    @State private var units: WeatherUnits
    @State private var savedLocations: [WeatherLocation]
    @State private var isLoadingWeather = false
    @State private var weatherErrorMessage: String?

    init(weatherService: WeatherService = .production) {
        self.weatherService = weatherService
        _units = State(initialValue: WeatherUnits())
        _savedLocations = State(initialValue: [])
    }

    var body: some View {
        ZStack {
            if let report, let selectedLocation {
                AtmosWeatherScreen(
                    locationName: selectedLocation.name,
                    locationSubtitle: selectedLocation.subtitle,
                    current: report.current,
                    hourly: report.hourly,
                    daily: report.daily,
                    units: units,
                    onOpenLocations: openLocations,
                    onOpenSettings: openSettings,
                    onOpenPrecipitation: openPrecipitation
                )
            } else {
                WeatherLoadingScreen()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) {
            WeatherLoadingBanner(isLoading: isLoadingWeather && report != nil, message: weatherErrorMessage)
                .padding(.top, 92)
        }
        .animation(.easeInOut(duration: 0.18), value: isLoadingWeather)
        .sheet(item: $activeSheet) { sheet in
            presentedSheet(sheet)
                .presentationDetents(sheet.detents)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(36)
        }
        .task {
            await loadDefaultLocations()
        }
        .task(id: selectedLocation?.id) {
            await loadSelectedWeather()
        }
        .environment(\.atmosReduceTransparency, units.reduceTransparency)
    }

    @ViewBuilder
    private func presentedSheet(_ sheet: WeatherSheet) -> some View {
        switch sheet {
        case .locations:
            LocationPickerView(
                savedLocations: $savedLocations,
                units: units,
                weatherService: weatherService,
                onSelectSaved: selectLocation,
                onPreviewSearchResult: previewLocation
            )
        case .settings:
            SettingsSheetView(units: $units)
        case let .precipitation(current, rainyCurrent):
            PrecipitationDetailView(
                current: current,
                rainyCurrent: rainyCurrent,
                units: units
            )
        }
    }

    private func openLocations() {
        activeSheet = .locations
    }

    private func openSettings() {
        activeSheet = .settings
    }

    private func openPrecipitation() {
        guard let report else { return }
        activeSheet = .precipitation(current: report.current, rainyCurrent: report.precipitationDetailCurrent)
    }

    private func selectLocation(_ location: WeatherLocation) {
        AppLog.location.notice("select id=\(location.id, privacy: .public) name=\"\(location.name, privacy: .public)\"")
        selectedLocation = location
    }

    private func previewLocation(_ location: WeatherLocation) {
        AppLog.location.notice("preview id=\(location.id, privacy: .public) name=\"\(location.name, privacy: .public)\"")
        selectedLocation = location
    }

    private func loadDefaultLocations() async {
        guard savedLocations.isEmpty else { return }

        do {
            let locations = try await weatherService.defaultLocations()
            savedLocations = locations
            selectedLocation = selectedLocation ?? locations.first
        } catch is CancellationError {
        } catch {
            weatherErrorMessage = "Locations unavailable"
        }
    }

    private func loadSelectedWeather() async {
        guard let selectedLocation else { return }
        await loadWeather(for: selectedLocation.id)
    }

    private func loadWeather(for locationID: WeatherLocation.ID) async {
        isLoadingWeather = true
        weatherErrorMessage = nil
        defer {
            if selectedLocation?.id == locationID {
                isLoadingWeather = false
            }
        }

        do {
            let loadedReport = try await weatherService.weather(for: locationID)
            guard selectedLocation?.id == locationID else { return }
            report = loadedReport
        } catch is CancellationError {
        } catch {
            guard selectedLocation?.id == locationID else { return }
            weatherErrorMessage = "Weather unavailable"
        }
    }
}

private struct WeatherLoadingScreen: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: "#FFD89B"), Color(hex: "#7B6FD9"), Color(hex: "#1F2D6F")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 14) {
                ProgressView()
                    .tint(.white)
                Text("Loading weather…")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(.white)
        }
    }
}

private struct WeatherLoadingBanner: View {
    let isLoading: Bool
    let message: String?

    var body: some View {
        HStack(spacing: 8) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                Text("Updating weather…")
            } else if let message {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(message)
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(isLoading || message != nil ? 0.22 : 0), in: Capsule())
        .opacity(isLoading || message != nil ? 1 : 0)
        .allowsHitTesting(false)
    }
}

#Preview {
    ContentView(weatherService: .mock)
}
