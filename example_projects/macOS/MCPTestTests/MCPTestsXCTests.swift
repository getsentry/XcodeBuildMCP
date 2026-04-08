import XCTest

final class MCPTestsXCTests: XCTestCase {

    func testAppNameIsCorrect() async throws {
        let expected = "MCPTest"
        XCTAssertTrue(expected == "MCPTest")
    }

    func testDeliberateFailure() async throws {
        XCTAssertTrue(1 == 2, "This test is designed to fail for snapshot testing")
    }
}
