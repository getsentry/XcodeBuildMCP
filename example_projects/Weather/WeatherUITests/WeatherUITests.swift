//
//  WeatherUITests.swift
//  WeatherUITests
//
//  Created by Cameron on 30/04/2026.
//

import XCTest

final class WeatherUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testLocationPickerOpens() throws {
        let app = launchApp()

        XCTAssertTrue(app.staticTexts["San Francisco"].waitForExistence(timeout: 5))

        app.buttons["weather.locationButton"].tap()
        XCTAssertTrue(app.staticTexts["Locations"].waitForExistence(timeout: 2))
    }

    @MainActor
    func testSettingsSheetOpens() throws {
        let app = launchApp()

        XCTAssertTrue(app.staticTexts["San Francisco"].waitForExistence(timeout: 5))
        app.buttons["weather.settingsButton"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 2))
    }

    @MainActor
    func testPrecipitationDetailOpens() throws {
        let app = launchApp()

        XCTAssertTrue(app.staticTexts["San Francisco"].waitForExistence(timeout: 5))
        let precipitationCard = app.buttons["weather.precipitationCard"]
        let mainScrollView = app.scrollViews["weather.mainScrollView"]
        XCTAssertTrue(mainScrollView.waitForExistence(timeout: 2))

        for _ in 0..<5 where !precipitationCard.exists {
            mainScrollView.swipeUp()
        }
        XCTAssertTrue(precipitationCard.waitForExistence(timeout: 1))
        precipitationCard.tap()
        XCTAssertTrue(app.staticTexts["PRECIPITATION"].waitForExistence(timeout: 2))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            _ = launchApp()
        }
    }

    @MainActor
    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launch()
        return app
    }
}
