import SwiftUI

struct LocationPickerView: View {
    @Environment(\.dismiss) private var dismiss

    @Binding var savedLocations: [WeatherLocation]
    let units: WeatherUnits
    let weatherService: WeatherService
    let onSelectSaved: (WeatherLocation) -> Void
    let onPreviewSearchResult: (WeatherLocation) -> Void

    @State private var query = ""
    @State private var isLoading = false
    @State private var results: [WeatherLocation] = []
    @State private var searchErrorMessage: String?
    @State private var isEditing = false
    @State private var justAddedID: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            searchField
            if !showingSearch {
                currentLocationButton
            }
            sectionHeader
            locationList
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 30)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .background(sheetBackground)
        .accessibilityIdentifier("weather.locationsSheet")
        .task(id: query) {
            await search()
        }
        .task(id: justAddedID) {
            await clearAddedIndicator()
        }
    }

    private var showingSearch: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var header: some View {
        HStack {
            Text("Locations")
                .font(.system(size: 22, weight: .bold))
                .tracking(-0.3)
            Spacer()
            if !showingSearch {
                Button(isEditing ? "Done" : "Edit") {
                    isEditing.toggle()
                }
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(isEditing ? Color(hex: "#78B4FF").opacity(0.35) : .white.opacity(0.15), in: Capsule())
            }
            Button(action: dismiss.callAsFunction) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 30, height: 30)
                    .background(.white.opacity(0.15), in: Circle())
            }
            .accessibilityLabel("Close")
        }
        .foregroundStyle(.white)
        .padding(.bottom, 12)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            if isLoading {
                ProgressView().tint(.white).frame(width: 16, height: 16)
            } else {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.white.opacity(0.7))
            }
            TextField("Search for a city, airport, or country", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(.white)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .frame(width: 18, height: 18)
                        .background(.white.opacity(0.2), in: Circle())
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.bottom, 10)
    }

    private var currentLocationButton: some View {
        Button(action: selectCurrentLocation) {
            HStack(spacing: 12) {
                Image(systemName: "location.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "#7ABFFF"))
                    .frame(width: 28, height: 28)
                    .background(Color(hex: "#78B4FF").opacity(0.25), in: Circle())
                Text("Use current location")
                    .font(.system(size: 15, weight: .medium))
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 10)
    }

    private var sectionHeader: some View {
        Text(showingSearch ? (isLoading ? "SEARCHING…" : "\(results.count) RESULT\(results.count == 1 ? "" : "S")") : "MY LOCATIONS · \(savedLocations.count)")
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(.white.opacity(0.55))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
    }

    private var locationList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                if !showingSearch {
                    ForEach(savedLocations) { location in
                        SavedLocationRow(
                            location: location,
                            units: units,
                            isCurrentLocation: isCurrentLocation(location),
                            isEditing: isEditing && !isCurrentLocation(location),
                            onSelect: { select(location) },
                            onRemove: { remove(location) }
                        )
                        .id("saved-\(location.id)-\(isEditing)")
                    }
                } else if isLoading {
                    ForEach(0..<3, id: \.self) { _ in SearchSkeletonRow() }
                } else if results.isEmpty {
                    noMatches
                } else {
                    ForEach(results) { location in
                        SearchLocationRow(
                            location: location,
                            units: units,
                            saved: isSaved(location),
                            added: justAddedID == location.id,
                            onPreview: { preview(location) },
                            onAdd: { add(location) }
                        )
                        .id("search-\(location.id)-\(isSaved(location))-\(justAddedID == location.id)")
                    }
                }
            }
            .padding(.bottom, 8)
        }
    }

    private var noMatches: some View {
        VStack(spacing: 4) {
            Text("No matches").font(.system(size: 15, weight: .medium))
            Text(searchErrorMessage ?? "Try a different city or country.").font(.system(size: 13))
        }
        .foregroundStyle(.white.opacity(0.5))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private var sheetBackground: some View {
        ZStack {
            Rectangle().fill(Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255).opacity(0.82))
            Rectangle().fill(.ultraThinMaterial)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(.white.opacity(0.12)).frame(height: 0.5)
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            isLoading = false
            results = []
            return
        }
        isLoading = true
        searchErrorMessage = nil
        let currentQuery = query
        defer {
            if currentQuery == query {
                isLoading = false
            }
        }

        do {
            let matches = try await weatherService.searchLocations(matching: currentQuery)
            guard !Task.isCancelled, currentQuery == query else { return }
            results = matches
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, currentQuery == query else { return }
            results = []
            searchErrorMessage = "Search is unavailable right now."
        }
    }

    private func isSaved(_ location: WeatherLocation) -> Bool {
        savedLocations.contains { $0.id == location.id }
    }

    private func isCurrentLocation(_ location: WeatherLocation) -> Bool {
        location.id == savedLocations.first?.id
    }

    private func add(_ location: WeatherLocation) {
        guard !isSaved(location) else { return }
        savedLocations.append(location)
        justAddedID = location.id
    }

    private func selectCurrentLocation() {
        guard let currentLocation = savedLocations.first else { return }
        select(currentLocation)
    }

    private func clearAddedIndicator() async {
        guard let id = justAddedID else { return }
        try? await Task.sleep(for: .milliseconds(1_400))
        guard !Task.isCancelled, justAddedID == id else { return }
        justAddedID = nil
    }

    private func preview(_ location: WeatherLocation) {
        onPreviewSearchResult(location)
    }

    private func select(_ location: WeatherLocation) {
        onSelectSaved(location)
        dismiss()
    }

    private func remove(_ location: WeatherLocation) {
        guard !isCurrentLocation(location) else { return }
        savedLocations.removeAll { $0.id == location.id }
    }
}
