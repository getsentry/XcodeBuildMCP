//
//  MCPTestApp.swift
//  MCPTest
//
//  Created by Cameron on 16/02/2025.
//

import SwiftUI

@main
struct MCPTestApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

#if SNAPSHOT_COMPILER_ERROR
private let snapshotCompilerError: Int = "not an int"
#endif
