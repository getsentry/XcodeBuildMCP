import OSLog
import SwiftUI

struct SettingsSheetView: View {
    @Environment(\.dismiss) private var dismiss

    @Binding var units: WeatherUnits

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack {
                    Text("Settings")
                        .font(.system(size: 22, weight: .bold))
                        .tracking(-0.3)
                    Spacer()
                    Button(action: dismiss.callAsFunction) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(width: 30, height: 30)
                            .background(.white.opacity(0.15), in: Circle())
                    }
                    .accessibilityLabel("Close")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 26)

                SettingsGroup(title: "UNITS") {
                    SegmentRow(label: "Temperature", selection: $units.temperature, options: TemperatureUnit.allCases)
                    SegmentRow(label: "Wind speed", selection: $units.wind, options: WindUnit.allCases)
                    SegmentRow(label: "Pressure", selection: $units.pressure, options: PressureUnit.allCases)
                    SegmentRow(label: "Distance", selection: $units.distance, options: DistanceUnit.allCases)
                }

                Spacer().frame(height: 22)

                SettingsGroup(title: "DISPLAY") {
                    ToggleRow(label: "Atmospheric animations", value: $units.animationsEnabled)
                    ToggleRow(label: "Severe weather alerts", value: $units.alertsEnabled)
                    ToggleRow(label: "Reduce transparency", value: $units.reduceTransparency)
                }

                Text("Atmos · v1.0")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(.top, 28)
                    .padding(.bottom, 10)
            }
            .foregroundStyle(.white)
            .padding(.top, 44)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .background(sheetBackground)
        .accessibilityIdentifier("weather.settingsSheet")
        .onChange(of: units.temperature) { _, new in
            AppLog.settings.notice("temperature=\(new.label, privacy: .public)")
        }
        .onChange(of: units.wind) { _, new in
            AppLog.settings.notice("wind=\(new.label, privacy: .public)")
        }
        .onChange(of: units.pressure) { _, new in
            AppLog.settings.notice("pressure=\(new.label, privacy: .public)")
        }
        .onChange(of: units.distance) { _, new in
            AppLog.settings.notice("distance=\(new.label, privacy: .public)")
        }
        .onChange(of: units.animationsEnabled) { _, new in
            AppLog.settings.notice("animationsEnabled=\(new, privacy: .public)")
        }
        .onChange(of: units.alertsEnabled) { _, new in
            AppLog.settings.notice("alertsEnabled=\(new, privacy: .public)")
        }
        .onChange(of: units.reduceTransparency) { _, new in
            AppLog.settings.notice("reduceTransparency=\(new, privacy: .public)")
        }
    }

    private var sheetBackground: some View {
        ZStack {
            Rectangle().fill(Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255).opacity(0.85))
            Rectangle().fill(.ultraThinMaterial)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(.white.opacity(0.12)).frame(height: 0.5)
        }
    }
}

private struct SettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.55))
                .padding(.horizontal, 16)

            VStack(spacing: 0) {
                content
            }
            .background(.white.opacity(0.05), in: groupedShape)
            .padding(.horizontal, 20)
        }
    }

    private var groupedShape: some Shape {
        if #available(iOS 26.0, *) {
            AnyShape(ConcentricRectangle(corners: .concentric, isUniform: true))
        } else {
            AnyShape(ContainerRelativeShape())
        }
    }
}

private struct SegmentRow<Option: Identifiable & Hashable>: View {
    let label: String
    @Binding var selection: Option
    let options: [Option]

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
            Spacer()
            HStack(spacing: 2) {
                ForEach(options) { option in
                    Button(optionLabel(option)) {
                        selection = option
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(selection == option ? .black : .white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(selection == option ? .white.opacity(0.95) : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
            }
            .padding(2)
            .background(Color(red: 120 / 255, green: 120 / 255, blue: 128 / 255).opacity(0.32), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5)
        }
    }

    private func optionLabel(_ option: Option) -> String {
        if let option = option as? TemperatureUnit { return option.label }
        if let option = option as? WindUnit { return option.label }
        if let option = option as? PressureUnit { return option.label }
        if let option = option as? DistanceUnit { return option.label }
        return "\(option.id)"
    }
}

private struct ToggleRow: View {
    let label: String
    @Binding var value: Bool

    var body: some View {
        Toggle(label, isOn: $value)
            .font(.system(size: 15))
            .tint(Color(hex: "#34C759"))
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .overlay(alignment: .bottom) {
                Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5)
            }
    }
}
