import SwiftUI

struct AtmosWeatherScreen: View {
    let locationName: String
    let locationSubtitle: String
    let current: CurrentWeather
    let hourly: [HourlyForecast]
    let daily: [DailyForecast]
    let units: WeatherUnits
    let onOpenLocations: () -> Void
    let onOpenSettings: () -> Void
    let onOpenPrecipitation: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                AtmosBackground(current: current, animationsEnabled: units.animationsEnabled)

                ScrollView {
                    VStack(spacing: 0) {
                        WeatherHeroView(locationName: locationName, locationSubtitle: locationSubtitle, current: current, units: units)

                        VStack(spacing: 10) {
                            HourlyForecastCard(forecasts: hourly, current: current, units: units)
                            DailyForecastCard(forecasts: daily, current: current, units: units)
                            ConditionGrid(current: current, units: units, onOpenPrecipitation: onOpenPrecipitation)

                            Text("Updated just now")
                                .font(.system(size: 11))
                                .tracking(0.3)
                                .foregroundStyle(current.theme.foregroundFaint)
                                .padding(.top, 14)
                                .padding(.bottom, 4)
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 14)
                    }
                    .padding(.top, 84)
                    .padding(.bottom, 90)
                }
                .scrollIndicators(.hidden)
                .accessibilityIdentifier("weather.mainScrollView")
                .frame(width: proxy.size.width, height: proxy.size.height)

                topScrim(topInset: proxy.safeAreaInsets.top)

                WeatherTopBar(
                    locationName: locationName,
                    current: current,
                    onOpenLocations: onOpenLocations,
                    onOpenSettings: onOpenSettings
                )
                .padding(.top, 12)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(current.theme.foreground)
        .preferredColorScheme(current.theme.statusDark ? .dark : .light)
    }

    private func topScrim(topInset: CGFloat) -> some View {
        LinearGradient(
            stops: [
                .init(color: firstBackgroundStop.opacity(1), location: 0),
                .init(color: firstBackgroundStop.opacity(0.80), location: 0.38),
                .init(color: firstBackgroundStop.opacity(0.40), location: 0.72),
                .init(color: firstBackgroundStop.opacity(0), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 96 + topInset)
        .offset(y: -topInset)
        .blur(radius: 2)
        .allowsHitTesting(false)
    }

    private var firstBackgroundStop: Color {
        current.theme.backgroundStops.first?.color ?? .clear
    }
}
