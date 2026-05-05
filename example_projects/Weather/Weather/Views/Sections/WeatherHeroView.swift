import SwiftUI

struct WeatherHeroView: View {
    let locationName: String
    let locationSubtitle: String
    let current: CurrentWeather
    let units: WeatherUnits

    var body: some View {
        VStack(spacing: 0) {
            Text(locationName)
                .font(.system(size: 22, weight: .medium))
                .tracking(-0.3)
                .accessibilityIdentifier("weather.heroLocation")

            Text(locationSubtitle)
                .font(.system(size: 13))
                .tracking(0.2)
                .foregroundStyle(current.theme.foregroundMuted)
                .padding(.top, 2)

            HStack(alignment: .top, spacing: 0) {
                Text("\(WeatherUnitFormatter.temperature(current.temperatureC, units: units))")
                    .font(.system(size: 132, weight: .ultraLight))
                    .tracking(-6)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                Text("°")
                    .font(.system(size: 36, weight: .thin))
                    .padding(.top, 18)
                    .padding(.leading, -6)
            }
            .lineSpacing(0)
            .padding(.top, -2)

            Text(current.conditionLabel)
                .font(.system(size: 19))
                .foregroundStyle(current.theme.foreground.opacity(0.92))

            Text("H:\(WeatherUnitFormatter.temperature(current.highC, units: units))°  L:\(WeatherUnitFormatter.temperature(current.lowC, units: units))°")
                .font(.system(size: 15))
                .monospacedDigit()
                .foregroundStyle(current.theme.foregroundMuted)
                .padding(.top, 2)

            Text("\"\(current.heroPhrase)\"")
                .font(.system(size: 14, weight: .light).italic())
                .tracking(0.1)
                .foregroundStyle(current.theme.foregroundMuted)
                .padding(.top, 10)
        }
        .multilineTextAlignment(.center)
        .padding(.top, 12)
        .padding(.horizontal, 24)
        .padding(.bottom, 6)
    }
}
