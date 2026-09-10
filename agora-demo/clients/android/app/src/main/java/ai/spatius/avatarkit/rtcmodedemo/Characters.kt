package ai.spatius.avatarkit.rtcmodedemo

data class AvatarCharacter(val id: String, val name: String)

/** The four public sample avatars, the same set as the other clients. */
val defaultCharacters = listOf(
    AvatarCharacter("41c62a7c-993c-4b6b-b6d3-549ce3c8be00", "Kian"),
    AvatarCharacter("dbb01388-7c57-47bf-ab59-c492caeb9d90", "Julian"),
    AvatarCharacter("d51ab422-3db7-47cc-afa8-7273b02bc70b", "Clara"),
    AvatarCharacter("c7069121-8245-4015-9940-82d0dc0c6bda", "Halima"),
)
