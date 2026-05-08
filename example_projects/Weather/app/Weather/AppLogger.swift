import OSLog

enum AppLog {
    private static let subsystem = "com.sentry.weather.Weather"
    static let app = Logger(subsystem: subsystem, category: "app")
    static let service = Logger(subsystem: subsystem, category: "service")
    static let settings = Logger(subsystem: subsystem, category: "settings")
    static let location = Logger(subsystem: subsystem, category: "location")
}
