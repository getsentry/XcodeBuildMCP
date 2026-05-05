import Foundation

enum WeatherMetricHelpers {
    static func compassAbbreviation(_ direction: WindDirection) -> String {
        compassPoint(for: direction).abbreviation
    }

    static func longDirection(_ direction: WindDirection) -> String {
        compassPoint(for: direction).longLabel
    }

    static func beaufortLabel(_ kph: Int) -> String {
        switch kph {
        case ..<2: "Calm"
        case ..<6: "Light air"
        case ..<12: "Light breeze"
        case ..<20: "Gentle breeze"
        case ..<29: "Moderate breeze"
        case ..<39: "Fresh breeze"
        case ..<50: "Strong breeze"
        case ..<63: "Near gale"
        default: "Gale"
        }
    }

    static func deterministicPercent(seed: Int, index: Int) -> Double {
        let value = abs((seed &* 1_103_515_245 &+ index &* 12_345) % 10_000)
        return Double(value) / 10_000
    }

    private static func compassPoint(for direction: WindDirection) -> CompassPoint {
        let index = Int(((direction.degrees + 11.25) / 22.5).rounded(.down)) % CompassPoint.allCases.count
        return CompassPoint.allCases[index]
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private enum CompassPoint: CaseIterable {
    case north
    case northNortheast
    case northeast
    case eastNortheast
    case east
    case eastSoutheast
    case southeast
    case southSoutheast
    case south
    case southSouthwest
    case southwest
    case westSouthwest
    case west
    case westNorthwest
    case northwest
    case northNorthwest

    var abbreviation: String {
        switch self {
        case .north: "N"
        case .northNortheast: "NNE"
        case .northeast: "NE"
        case .eastNortheast: "ENE"
        case .east: "E"
        case .eastSoutheast: "ESE"
        case .southeast: "SE"
        case .southSoutheast: "SSE"
        case .south: "S"
        case .southSouthwest: "SSW"
        case .southwest: "SW"
        case .westSouthwest: "WSW"
        case .west: "W"
        case .westNorthwest: "WNW"
        case .northwest: "NW"
        case .northNorthwest: "NNW"
        }
    }

    var longLabel: String {
        switch self {
        case .north: "north"
        case .northNortheast: "north-northeast"
        case .northeast: "northeast"
        case .eastNortheast: "east-northeast"
        case .east: "east"
        case .eastSoutheast: "east-southeast"
        case .southeast: "southeast"
        case .southSoutheast: "south-southeast"
        case .south: "south"
        case .southSouthwest: "south-southwest"
        case .southwest: "southwest"
        case .westSouthwest: "west-southwest"
        case .west: "west"
        case .westNorthwest: "west-northwest"
        case .northwest: "northwest"
        case .northNorthwest: "north-northwest"
        }
    }
}
