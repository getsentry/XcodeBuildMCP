import SwiftUI

public struct ContentView: View {
    @State private var calculatorService = CalculatorService()
    @State private var backgroundGradient = BackgroundState.normal
    
    private var inputHandler: CalculatorInputHandler {
        CalculatorInputHandler(service: calculatorService)
    }
    
    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Dynamic gradient background
                AnimatedBackground(backgroundGradient: backgroundGradient)
                
                VStack(spacing: 0) {
                    Spacer()
                    
                    // Display Section
                    CalculatorDisplay(
                        expressionDisplay: calculatorService.expressionDisplay,
                        display: calculatorService.display,
                        onDeleteLastDigit: {
                            inputHandler.deleteLastDigit()
                        }
                    )
                    
                    // Button Grid
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                        ForEach(calculatorButtons, id: \.self) { button in
                            CalculatorButton(
                                title: button,
                                buttonType: buttonType(for: button),
                                isWideButton: button == "0"
                            ) {
                                handleButtonPress(button)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, max(geometry.safeAreaInsets.bottom, 20))
                }
            }
        }
    }
    
    // Calculator button layout (proper grid with = button in correct position)
    private var calculatorButtons: [String] {
        [
            "C", "±", "%", "÷",
            "7", "8", "9", "×", 
            "4", "5", "6", "-",
            "1", "2", "3", "+",
            "",  "0", ".", "="
        ]
    }
    
    private func buttonType(for button: String) -> CalculatorButtonType {
        switch button {
        case "C", "±", "%":
            return .function
        case "÷", "×", "-", "+", "=":
            return .operation
        case "":
            return .hidden
        default:
            return .number
        }
    }
    
    private func handleButtonPress(_ button: String) {
        print("[CalculatorApp] Button pressed: \(button)")

        // Process input through the input handler
        inputHandler.handleInput(button)
        
        // Handle background state changes with modern animation
        withAnimation(.easeInOut(duration: 0.3)) {
            if button == "=" {
                backgroundGradient = calculatorService.hasError ? .error : .calculated
                
                // Reset to normal after a delay using structured concurrency
                Task {
                    try await Task.sleep(for: .seconds(1.5))
                    await MainActor.run {
                        withAnimation(.easeInOut(duration: 0.5)) {
                            backgroundGradient = .normal
                        }
                    }
                }
            } else if button == "C" {
                backgroundGradient = .normal
            }
        }
    }
    
    public init() {}
}


#Preview {
    ContentView()
}
