import Testing

struct MCPTestTests {

    @Test func appNameIsCorrect() async throws {
        let expected = "MCPTest"
        #expect(expected == "MCPTest")
    }

    @Test func deliberateFailure() async throws {
        #expect(1 == 2, "This test is designed to fail for snapshot testing")
    }
}
