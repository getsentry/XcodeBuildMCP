//
//  CalculatorAppTests.swift
//  CalculatorAppTests
//
//  Created by Cameron on 05/06/2025.
//

import XCTest
import SwiftUI
@testable import CalculatorApp
import CalculatorAppFeature

final class CalculatorAppTests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        // Clean up after each test
    }
}

// MARK: - App Lifecycle Tests
extension CalculatorAppTests {
    
    func testAppLaunch() throws {
        // Test that the app launches without crashing
        let app = CalculatorApp()
        XCTAssertNotNil(app, "App should initialize successfully")
    }
    
    func testContentViewInitialization() throws {
        // Test that ContentView initializes properly
        let contentView = ContentView()
        XCTAssertNotNil(contentView, "ContentView should initialize successfully")
    }
}

// MARK: - Calculator Service Integration Tests
extension CalculatorAppTests {
    
    func testCalculatorServiceCreation() throws {
        let service = CalculatorService()
        XCTAssertEqual(service.display, "0", "Calculator should start with display showing 0")
        XCTAssertEqual(service.expressionDisplay, "", "Calculator should start with empty expression")
    }
    
    func testCalculatorServiceFailure() throws {
        let service = CalculatorService()
        // This test is designed to fail to test error reporting
        XCTAssertEqual(service.display, "999", "This test should fail - display should be 0, not 999")
    }
    
    func testCalculatorServiceBasicOperation() throws {
        let service = CalculatorService()
        
        // Test basic addition
        service.inputNumber("5")
        service.setOperation(.add)
        service.inputNumber("3")
        service.calculate()
        
        XCTAssertEqual(service.display, "8", "5 + 3 should equal 8")
    }

    func testAddition() throws {
        let service = CalculatorService()

        service.inputNumber("5")
        service.setOperation(.add)
        service.inputNumber("3")
        service.calculate()

        XCTAssertEqual(service.display, "8", "5 + 3 should equal 8")
    }
    
    func testCalculatorServiceChainedOperations() throws {
        let service = CalculatorService()
        
        // Test chained operations: 10 + 5 * 2 = 30 (since calculator evaluates left to right)
        service.inputNumber("10")
        service.setOperation(.add)
        service.inputNumber("5")
        service.setOperation(.multiply)
        service.inputNumber("2")
        service.calculate()
        
        XCTAssertEqual(service.display, "30", "10 + 5 * 2 should equal 30 (left-to-right evaluation)")
    }
    
    func testCalculatorServiceClear() throws {
        let service = CalculatorService()
        
        // Set up some state
        service.inputNumber("123")
        service.setOperation(.add)
        service.inputNumber("456")
        
        // Clear should reset everything
        service.clear()
        
        XCTAssertEqual(service.display, "0", "Display should be 0 after clear")
        XCTAssertEqual(service.expressionDisplay, "", "Expression should be empty after clear")
    }
}

// MARK: - API Surface Tests
extension CalculatorAppTests {
    
    func testCalculatorServicePublicInterface() throws {
        let service = CalculatorService()
        
        // Test that all expected public methods are available
        XCTAssertNoThrow(service.inputNumber("5"))
        XCTAssertNoThrow(service.inputDecimal())
        XCTAssertNoThrow(service.setOperation(.add))
        XCTAssertNoThrow(service.calculate())
        XCTAssertNoThrow(service.toggleSign())
        XCTAssertNoThrow(service.percentage())
        XCTAssertNoThrow(service.clear())
    }
    
    func testCalculatorServicePublicProperties() throws {
        let service = CalculatorService()
        
        // Test that all expected public properties are accessible
        XCTAssertNotNil(service.display)
        XCTAssertNotNil(service.expressionDisplay)
        XCTAssertEqual(service.hasError, false)
        
        // Test testing support properties
        XCTAssertEqual(service.currentValue, 0)
        XCTAssertEqual(service.previousValue, 0)
        XCTAssertNil(service.currentOperation)
        XCTAssertEqual(service.willResetDisplay, false)
    }
    
    func testCalculatorOperationsEnum() throws {
        // Test that all operations are available
        XCTAssertEqual(CalculatorService.Operation.add.rawValue, "+")
        XCTAssertEqual(CalculatorService.Operation.subtract.rawValue, "-")
        XCTAssertEqual(CalculatorService.Operation.multiply.rawValue, "×")
        XCTAssertEqual(CalculatorService.Operation.divide.rawValue, "÷")
        
        // Test operation calculations
        XCTAssertEqual(CalculatorService.Operation.add.calculate(5, 3), 8)
        XCTAssertEqual(CalculatorService.Operation.subtract.calculate(5, 3), 2)
        XCTAssertEqual(CalculatorService.Operation.multiply.calculate(5, 3), 15)
        XCTAssertEqual(CalculatorService.Operation.divide.calculate(6, 3), 2)
        XCTAssertEqual(CalculatorService.Operation.divide.calculate(5, 0), 0) // Division by zero
    }
}

// MARK: - Edge Case and Error Handling Tests
extension CalculatorAppTests {
    
    func testDivisionByZero() throws {
        let service = CalculatorService()
        
        service.inputNumber("10")
        service.setOperation(.divide)
        service.inputNumber("0")
        service.calculate()
        
        XCTAssertEqual(service.display, "0", "Division by zero should return 0")
    }
    
    func testLargeNumbers() throws {
        let service = CalculatorService()
        
        // Test large number input
        service.inputNumber("999999999")
        XCTAssertEqual(service.display, "999999999", "Should handle large numbers")
        
        // Test large number calculation
        service.setOperation(.multiply)
        service.inputNumber("2")
        service.calculate()
        
        // Should handle the result without crashing
        XCTAssertNotEqual(service.display, "", "Should display some result for large calculations")
    }
    
    func testRepeatedEquals() throws {
        let service = CalculatorService()
        
        service.inputNumber("5")
        service.setOperation(.add)
        service.inputNumber("3")
        service.calculate() // 5 + 3 = 8
        
        let firstResult = service.display
        
        service.calculate() // Should repeat last operation: 8 + 3 = 11
        let secondResult = service.display
        
        XCTAssertEqual(firstResult, "8", "First calculation should be correct")
        XCTAssertEqual(secondResult, "11", "Repeated equals should repeat last operation")
    }
}

// MARK: - Performance Tests
extension CalculatorAppTests {
    
    func testCalculationPerformance() throws {
        let service = CalculatorService()
        
        measure {
            // Measure performance of 100 calculations
            for i in 1...100 {
                service.clear()
                service.inputNumber("\(i)")
                service.setOperation(.multiply)
                service.inputNumber("2")
                service.calculate()
            }
        }
    }
    
    func testLargeNumberInputPerformance() throws {
        let service = CalculatorService()
        
        measure {
            // Measure performance of inputting large numbers
            service.clear()
            for digit in "123456789012345" {
                service.inputNumber(String(digit))
            }
        }
    }
}

// MARK: - State Consistency Tests
extension CalculatorAppTests {
    
    func testStateConsistencyAfterOperations() throws {
        let service = CalculatorService()
        
        // Perform a series of operations and verify state remains consistent
        service.inputNumber("10")
        XCTAssertEqual(service.display, "10")
        
        service.setOperation(.add)
        XCTAssertEqual(service.display, "10")
        XCTAssertTrue(service.expressionDisplay.contains("10 +"))
        
        service.inputNumber("5")
        XCTAssertEqual(service.display, "5")
        
        service.calculate()
        XCTAssertEqual(service.display, "15")
    }
    
    func testStateConsistencyWithDecimalNumbers() throws {
        let service = CalculatorService()
        
        service.inputNumber("3")
        service.inputDecimal()
        service.inputNumber("14")
        XCTAssertEqual(service.display, "3.14")
        
        service.setOperation(.multiply)
        service.inputNumber("2")
        service.calculate()
        
        XCTAssertEqual(service.display, "6.28")
    }
    
    func testMultipleDecimalPointsHandling() throws {
        let service = CalculatorService()
        
        service.inputNumber("1")
        service.inputDecimal()
        service.inputNumber("5")
        service.inputDecimal() // This should be ignored
        service.inputNumber("9")
        
        XCTAssertEqual(service.display, "1.59", "Multiple decimal points should be ignored")
    }
}

final class IntentionalFailureTests: XCTestCase {

    func test() throws {
        XCTAssertTrue(false, "This test should fail to verify error reporting")
    }
}

// MARK: - Component Integration Tests
extension CalculatorAppTests {
    
    func testComplexCalculationWorkflow() throws {
        let service = CalculatorService()
        
        // Test complex workflow through direct service calls
        service.inputNumber("2")
        service.inputNumber("5")
        service.setOperation(.divide)
        service.inputNumber("5")
        service.calculate()
        
        XCTAssertEqual(service.display, "5", "Complex workflow should work correctly")
        
        // Test that we can continue with the result
        service.setOperation(.multiply)
        service.inputNumber("4")
        service.calculate()
        
        XCTAssertEqual(service.display, "20", "Should be able to continue with previous result")
    }
    
    func testPercentageCalculation() throws {
        let service = CalculatorService()
        
        service.inputNumber("50")
        service.percentage()
        
        XCTAssertEqual(service.display, "0.5", "50% should equal 0.5")
    }
    
    func testSignToggle() throws {
        let service = CalculatorService()
        
        service.inputNumber("42")
        service.toggleSign()
        XCTAssertEqual(service.display, "-42", "Should toggle to negative")
        
        service.toggleSign()
        XCTAssertEqual(service.display, "42", "Should toggle back to positive")
    }
}
