import SwiftUI

struct SavedLocationRow: View {
    let location: WeatherLocation
    let units: WeatherUnits
    let isCurrentLocation: Bool
    let isEditing: Bool
    let onSelect: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onSelect) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        if isCurrentLocation {
                            Text("MY LOCATION")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(1)
                                .foregroundStyle(.white.opacity(0.7))
                        }
                        Text(location.name)
                            .font(.system(size: 19, weight: .semibold))
                            .tracking(-0.3)
                        Text("\(location.localTimeLabel)  ·  \(location.conditionLabel)")
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.65))
                    }
                    Spacer()
                    WeatherIconView(kind: location.iconKind, size: 28, foreground: .white, accent: Color(hex: "#FFD89B"))
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(WeatherUnitFormatter.temperatureString(location.temperatureC, units: units))
                            .font(.system(size: 38, weight: .thin))
                            .tracking(-1.5)
                            .monospacedDigit()
                        Text("H:\(WeatherUnitFormatter.temperature(location.highC, units: units))°  L:\(WeatherUnitFormatter.temperature(location.lowC, units: units))°")
                            .font(.system(size: 11))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.65))
                    }
                }
                .foregroundStyle(.white)
                .padding(14)
                .background(
                    LinearGradient(
                        colors: [
                            Color(red: 80 / 255, green: 100 / 255, blue: 140 / 255).opacity(0.42),
                            Color(red: 40 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.30),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
            }
            .buttonStyle(.plain)

            if isEditing {
                Button(action: onRemove) {
                    Image(systemName: "trash")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 52)
                        .frame(maxHeight: .infinity)
                        .background(Color(red: 255 / 255, green: 69 / 255, blue: 58 / 255).opacity(0.22), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .foregroundStyle(Color(hex: "#FF6B61"))
                }
                .accessibilityLabel("Remove")
            }
        }
    }
}

struct SearchLocationRow: View {
    let location: WeatherLocation
    let units: WeatherUnits
    let saved: Bool
    let added: Bool
    let onPreview: () -> Void
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onPreview) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(location.name)
                        .font(.system(size: 16, weight: .semibold))
                        .tracking(-0.2)
                    Text(location.subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.6))
                    Text("\(location.localTimeLabel) · \(location.conditionLabel)")
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.55))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            VStack(alignment: .trailing, spacing: 3) {
                Text(WeatherUnitFormatter.temperatureString(location.temperatureC, units: units))
                    .font(.system(size: 22, weight: .light))
                    .tracking(-0.5)
                    .monospacedDigit()
                Text("H:\(WeatherUnitFormatter.temperature(location.highC, units: units))°  L:\(WeatherUnitFormatter.temperature(location.lowC, units: units))°")
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.55))
            }

            Button(action: onAdd) {
                Image(systemName: saved || added ? "checkmark" : "plus")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 36, height: 36)
                    .background(saved || added ? Color(hex: "#34C759").opacity(0.85) : Color(hex: "#78B4FF").opacity(0.30), in: Circle())
            }
            .disabled(saved)
            .accessibilityLabel(saved ? "Saved" : "Add")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.10), lineWidth: 0.5))
    }
}

struct SearchSkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(.white.opacity(0.10)).frame(width: 120, height: 14)
                Capsule().fill(.white.opacity(0.07)).frame(width: 170, height: 11)
                Capsule().fill(.white.opacity(0.07)).frame(width: 95, height: 11)
            }
            Spacer()
            Circle().fill(.white.opacity(0.08)).frame(width: 36, height: 36)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.06), lineWidth: 0.5))
    }
}
