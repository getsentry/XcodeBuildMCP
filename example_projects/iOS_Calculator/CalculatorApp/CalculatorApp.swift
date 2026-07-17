import SwiftUI
import OSLog
import CalculatorAppFeature

private let logger = Logger(subsystem: "io.sentry.calculatorapp", category: "lifecycle")
private let snapshotScrollSurfaceArgument = "--snapshot-scroll-surface"

@main
struct CalculatorApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.arguments.contains(snapshotScrollSurfaceArgument) {
                SnapshotScrollSurface()
            } else {
                ContentView()
            }
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

private struct SnapshotScrollSurface: View {
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(0..<30, id: \.self) { index in
                    Text("Snapshot row \(index)")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .padding()
        }
        .accessibilityIdentifier("snapshot-scroll-surface")
    }
}

#Preview {
    ContentView()
}

#if SNAPSHOT_COMPILER_ERROR
private let snapshotCompilerError: Int = "not an int"
#endif
