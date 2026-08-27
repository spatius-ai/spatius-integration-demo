import Foundation

struct AvatarCharacter: Identifiable, Hashable {
    let id: String
    let name: String
}

let defaultCharacters: [AvatarCharacter] = [
    AvatarCharacter(id: "41c62a7c-993c-4b6b-b6d3-549ce3c8be00", name: "Kian"),
    AvatarCharacter(id: "dbb01388-7c57-47bf-ab59-c492caeb9d90", name: "Julian"),
    AvatarCharacter(id: "d51ab422-3db7-47cc-afa8-7273b02bc70b", name: "Clara"),
    AvatarCharacter(id: "c7069121-8245-4015-9940-82d0dc0c6bda", name: "Halima"),
]
