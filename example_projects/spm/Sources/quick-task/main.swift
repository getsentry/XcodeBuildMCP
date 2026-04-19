import Foundation
import TestLib
import ArgumentParser

@main
struct QuickTask: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "quick-task",
        abstract: "A quick task that finishes within 5 seconds",
        version: "1.0.0"
    )
    
    @Option(name: .shortAndLong, help: "Number of seconds to work (default: 3)")
    var duration: Int = 3
    
    @Flag(name: .shortAndLong, help: "Enable verbose output")
    var verbose: Bool = false
    
    @Option(name: .shortAndLong, help: "Task name to display")
    var taskName: String = "DefaultTask"
    
    func run() async throws {
        let taskManager = TaskManager()
        
        if verbose {
            print("🚀 Starting quick task: \(taskName)")
            print("⏱️  Duration: \(duration) seconds")
        }
        
        await taskManager.executeQuickTask(name: taskName, duration: duration, verbose: verbose)
        
        if verbose {
            print("✅ Quick task completed successfully!")
        }
    }
}
