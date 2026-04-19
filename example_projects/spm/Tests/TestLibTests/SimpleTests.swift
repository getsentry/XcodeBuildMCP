import Testing
import XCTest

@Test("Basic truth assertions")
func basicTruthTest() {
    #expect(true == true)
    #expect(false == false)
    #expect(true != false)
}

@Test("Basic math operations")
func basicMathTest() {
    #expect(2 + 2 == 4)
    #expect(5 - 3 == 2)
    #expect(3 * 4 == 12)
    #expect(10 / 2 == 5)
}

@Test("String operations")
func stringTest() {
    let greeting = "Hello"
    let world = "World"
    #expect(greeting + " " + world == "Hello World")
    #expect(greeting.count == 5)
    #expect(world.isEmpty == false)
}

@Test("Array operations")
func arrayTest() {
    let numbers = [1, 2, 3, 4, 5]
    #expect(numbers.count == 5)
    #expect(numbers.first == 1)
    #expect(numbers.last == 5)
    #expect(numbers.contains(3) == true)
}

@Test("Optional handling")
func optionalTest() {
    let someValue: Int? = 42
    let nilValue: Int? = nil

    #expect(someValue != nil)
    #expect(nilValue == nil)
    #expect(someValue! == 42)
}

final class CalculatorAppTests: XCTestCase {
    func testCalculatorServiceFailure() {
        XCTAssertEqual(0, 999, "This test should fail - display should be 0, not 999")
    }
}

@Suite("This test should fail to verify error reporting")
struct IntentionalFailureSuite {
    @Test("test")
    func test() {
        #expect(Bool(false), "Test failed")
    }
}
