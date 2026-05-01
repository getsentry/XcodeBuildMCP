import SwiftUI
import OSLog
import CalculatorAppFeature

private let logger = Logger(subsystem: "io.sentry.calculatorapp", category: "lifecycle")

@main
struct CalculatorApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                logger.info("Calculator app launched")
            case .background:
                logger.info("Calculator app terminated")
            default:
                break
            }
        }
    }
}

#Preview {
    ContentView()
}

#if SNAPSHOT_COMPILER_ERROR
private let snapshotCompilerError: Int = "not an int"
#endif
