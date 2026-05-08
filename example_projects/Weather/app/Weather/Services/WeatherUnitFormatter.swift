import Foundation

struct FormattedMeasurement: Equatable {
    let value: String
    let unit: String
}

enum WeatherUnitFormatter {
    static func temperature(_ celsius: Int, units: WeatherUnits) -> Int {
        switch units.temperature {
        case .fahrenheit:
            Int((Double(celsius) * 9 / 5 + 32).rounded())
        case .celsius:
            celsius
        }
    }

    static func temperatureString(_ celsius: Int, units: WeatherUnits) -> String {
        "\(temperature(celsius, units: units))°"
    }

    static func wind(_ kph: Int, units: WeatherUnits) -> FormattedMeasurement {
        switch units.wind {
        case .mph:
            FormattedMeasurement(value: "\(Int((Double(kph) / 1.60934).rounded()))", unit: "mph")
        case .kmh:
            FormattedMeasurement(value: "\(kph)", unit: "km/h")
        case .metersPerSecond:
            FormattedMeasurement(value: oneDecimal(Double(kph) / 3.6), unit: "m/s")
        }
    }

    static func pressure(_ millibars: Int, units: WeatherUnits) -> FormattedMeasurement {
        switch units.pressure {
        case .millibars:
            FormattedMeasurement(value: "\(millibars)", unit: "mb")
        case .inchesMercury:
            FormattedMeasurement(value: String(format: "%.2f", Double(millibars) * 0.02953), unit: "inHg")
        }
    }

    static func distance(_ kilometers: Double, units: WeatherUnits) -> FormattedMeasurement {
        switch units.distance {
        case .miles:
            let miles = kilometers / 1.60934
            return FormattedMeasurement(value: miles == floor(miles) ? "\(Int(miles))" : oneDecimal(miles), unit: "mi")
        case .kilometers:
            return FormattedMeasurement(value: oneDecimal(kilometers), unit: "km")
        }
    }

    private static func oneDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded == floor(rounded) {
            return "\(Int(rounded))"
        }
        return String(format: "%.1f", rounded)
    }
}
