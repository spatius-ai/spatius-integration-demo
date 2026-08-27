import 'package:flutter/material.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' hide ConnectionState, Transform;

import 'avatar_view_model.dart';
import 'characters.dart';
import 'config_check_page.dart';

class PlaygroundPage extends StatefulWidget {
  const PlaygroundPage({
    super.key,
    required this.baseUrl,
    required this.scene,
    required this.language,
    required this.configuredAvatarId,
    required this.clips,
  });

  final String baseUrl;
  final Scene scene;
  final Lang language;
  /// Whatever the server nominates, so the playground is never empty on arrival.
  final String configuredAvatarId;
  final List<ServerClip> clips;

  @override
  State<PlaygroundPage> createState() => _PlaygroundPageState();
}

class _PlaygroundPageState extends State<PlaygroundPage> {
  final AvatarViewModel _vm = AvatarViewModel();
  final TextEditingController _textController = TextEditingController();
  final TextEditingController _customIdController = TextEditingController();

  String? _selectedCharacterId;
  bool _isLoadingAvatar = false;
  double _loadProgress = 0;
  String? _loadError;
  bool _showCustomInput = false;
  int _avatarViewKey = 0;

  @override
  void initState() {
    super.initState();
    _vm.addListener(_onVmChanged);
    _vm.baseUrl = widget.baseUrl;
    _vm.language = widget.language == Lang.zh ? 'zh' : 'en';
    _vm.clips = widget.clips;
    if (widget.configuredAvatarId.isNotEmpty) {
      _loadCharacter(widget.configuredAvatarId);
    }
  }

  void _onVmChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _vm.removeListener(_onVmChanged);
    _vm.close();
    _vm.dispose();
    _textController.dispose();
    _customIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Backend Mode'),
        centerTitle: true,
        actions: [
          // A dialog rather than a list beside the avatar: a phone has no room for
          // both, and the avatar is what the screen is for.
          TextButton(
            onPressed: _showCharacters,
            child: const Text('Avatar'),
          ),
        ],
      ),
      body: Column(
        children: [
          // 1. Avatar view
          _buildAvatarSection(),
          // 2. Status bar
          _buildStatusBar(),
          const Divider(height: 1),
          // The two scenes differ only in where the audio comes from: a clip the
          // server already has, or this device's microphone. Both arrive back as the
          // same audio-plus-motion pair, so everything below the split is shared.
          Expanded(
            child: SingleChildScrollView(
              child: widget.scene == Scene.sample ? _buildClipList() : _buildHostPanel(),
            ),
          ),
        ],
      ),
    );
  }

  // --- Avatar section ---

  Widget _buildAvatarSection() {
    if (_vm.avatar != null) {
      final idle = _vm.conversationState == 'idle';
      // Read from the SDK rather than a local flag: playback ending on its own would
      // leave a toggle saying "Resume" with nothing paused.
      final paused = _vm.conversationState == 'paused';
      return SizedBox(
        height: 280,
        width: double.infinity,
        child: Stack(children: [
          Container(
            color: Colors.black,
            child: AvatarWidget(
              key: ValueKey(_avatarViewKey),
              avatar: _vm.avatar!,
              onPlatformViewCreated: (controller) {
                _vm.setAvatarController(controller);
            // Nothing to ask the user here: this is a WebSocket to the demo's own
            // server, not a session that costs anything. The iOS and Android clients
            // connect at the same point, and none of the three has a Start button —
            // the server owns the Motion Server connection, so there is nothing for
            // one to start.
                _vm.backendConnect();
              },
            ),
          ),
          // Over the avatar, since that is what they act on, and pinned to the two
          // bottom corners rather than centred as a pair: the avatar's face is in the
          // middle, and a row of buttons across it is the one place they cannot go.
          if (!idle)
            Positioned(
              left: 20,
              right: 20,
              bottom: 16,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _stageButton(Icons.stop, const Color(0xFFEF4444), _vm.interrupt),
                  _stageButton(
                    paused ? Icons.play_arrow : Icons.pause,
                    Theme.of(context).colorScheme.primary,
                    paused ? _vm.resume : _vm.pause,
                  ),
                ],
              ),
            ),
        ]),
      );
    }

    return Container(
      height: 280,
      width: double.infinity,
      color: Colors.black,
      child: Center(
        child: _isLoadingAvatar
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(color: Colors.white),
                  const SizedBox(height: 8),
                  Text(
                    '${(_loadProgress * 100).toInt()}%',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              )
            : const Text(
                'Select a character below',
                style: TextStyle(color: Colors.grey),
              ),
      ),
    );
  }

  // --- Status bar ---

  /// The SDK callbacks worth watching, in the order they first fire.
  ///
  /// There is no Motion Server connection row: in Backend Mode the server holds that
  /// one, so `onConnectionState` never fires here — what this reports instead is the
  /// WebSocket this app renders from.
  Widget _buildStatusBar() {
    final theme = Theme.of(context);
    final rows = <(String, String?)>[
      ('Download', _isLoadingAvatar ? '${(_loadProgress * 100).toInt()}%' : 'complete'),
      ('First frame', _vm.avatar != null ? 'rendered' : 'waiting'),
      (
        'Server',
        _vm.backendConnected
            ? 'connected'
            : _vm.backendConnecting
                ? 'connecting'
                : 'disconnected',
      ),
      ('Conversation', _vm.conversationState),
      ('Error', _vm.errorMessage ?? 'none'),
    ];

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: theme.textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      value ?? '\u2014',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: label == 'Error' && value != 'none'
                            ? theme.colorScheme.error
                            : null,
                      ),
                      textAlign: TextAlign.end,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// One of the two controls over the avatar.
  ///
  /// An icon rather than a word: these sit on top of the render, where a label wide
  /// enough to read is a label wide enough to cover the picture.
  Widget _stageButton(IconData icon, Color color, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color,
          border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 3),
          boxShadow: const [
            BoxShadow(color: Colors.black38, blurRadius: 8, offset: Offset(0, 4)),
          ],
        ),
        child: Icon(icon, color: Colors.white, size: 24),
      ),
    );
  }

  Widget _buildCharacterSection() {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                const Text(
                  'Characters',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
                const Spacer(),
                GestureDetector(
                  onTap: () {},
                  child: const Text(
                    'IDs',
                    style: TextStyle(fontSize: 10, color: Colors.blue),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          ...defaultCharacters.map((c) => _buildCharacterTile(c)),
          if (_showCustomInput) _buildCustomIdInput() else _buildCustomIdButton(),
          if (_loadError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Text(
                _loadError!,
                style: const TextStyle(fontSize: 10, color: Colors.red),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildCharacterTile(AvatarCharacter character) {
    final isSelected = _selectedCharacterId == character.id;
    final isLoaded = isSelected && _vm.avatar != null;
    final isLoading = isSelected && _isLoadingAvatar;

    return InkWell(
      onTap: _isLoadingAvatar ? null : () => _loadCharacter(character.id),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          children: [
            CircleAvatar(
              radius: 13,
              backgroundColor: Colors.blue,
              child: Text(
                character.name[0],
                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(width: 8),
            Text(character.name, style: const TextStyle(fontSize: 12)),
            const Spacer(),
            if (isLoading)
              Text(
                '${(_loadProgress * 100).toInt()}%',
                style: const TextStyle(fontSize: 10, color: Colors.blue, fontWeight: FontWeight.w600),
              ),
            if (isLoaded)
              const Icon(Icons.check_circle, color: Colors.green, size: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomIdButton() {
    return InkWell(
      onTap: () => setState(() => _showCustomInput = true),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          children: [
            Container(
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.grey, style: BorderStyle.solid),
              ),
              child: const Center(
                child: Text('+', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ),
            ),
            const SizedBox(width: 8),
            const Text('Custom ID', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomIdInput() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Column(
        children: [
          TextField(
            controller: _customIdController,
            style: const TextStyle(fontSize: 12),
            decoration: const InputDecoration(
              hintText: 'Character ID',
              isDense: true,
              contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              OutlinedButton(
                onPressed: _isLoadingAvatar
                    ? null
                    : () {
                        final id = _customIdController.text.trim();
                        if (id.isNotEmpty) _loadCharacter(id);
                      },
                child: const Text('Load', style: TextStyle(fontSize: 12)),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () {
                  setState(() {
                    _showCustomInput = false;
                    _customIdController.clear();
                  });
                },
                child: const Text('Cancel', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // --- Host panel ---

  void _showCharacters() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Avatar'),
        content: SingleChildScrollView(child: _buildCharacterSection()),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildClipList() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Pre-recorded audio',
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          for (final entry in _vm.clips)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: InkWell(
                // Disabled until the socket is up as well as while one is in flight:
                // a tap before then is sent to nobody, and the row just goes quiet.
                onTap: _vm.backendConnected && _vm.playingClip == null
                    ? () => _vm.playSample(entry.clip)
                    : null,
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    border: Border.all(color: theme.colorScheme.outlineVariant),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(children: [
                    const Icon(Icons.graphic_eq, size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _vm.playingClip == entry.clip ? '...' : entry.name,
                        style: theme.textTheme.bodySmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ]),
                ),
              ),
            ),
          const SizedBox(height: 8),
          Text(
            'The clips live on the server and never pass through this app: one is '
            'streamed straight into the avatar, and what arrives here is the encoded '
            'audio and motion to render.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  /// The realtime scene: the microphone, and a way to type instead.
  ///
  /// No Connect button — the socket opens with the avatar. The same shape as the iOS
  /// client: one large microphone, the line of text under it that says what it is
  /// doing, and a field for trying the scene without speaking.
  Widget _buildHostPanel() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Microphone',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 10),
          Center(
            child: InkWell(
              onTap: _vm.backendConnected
                  ? () => _vm.backendMicActive
                      ? _vm.backendStopMic()
                      : _vm.backendStartMic()
                  : null,
              customBorder: const CircleBorder(),
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: !_vm.backendConnected
                      ? theme.colorScheme.outlineVariant
                      : _vm.backendMicActive
                          ? const Color(0xFFEF4444)
                          : theme.colorScheme.primary,
                ),
                child: Icon(
                  _vm.backendMicActive ? Icons.stop : Icons.mic,
                  color: Colors.white,
                  size: 30,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Center(
            child: Text(
              !_vm.backendConnected
                  ? 'Connecting to the server…'
                  : _vm.backendMicActive
                      ? 'Listening — just talk, the agent decides when your turn ends.'
                      : 'Tap to start talking.',
              style: theme.textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 12),

          // A way to try the scene without a microphone — a device with no input, or
          // a quick check that the agent replies.
          Row(children: [
            Expanded(
              child: TextField(
                controller: _textController,
                enabled: _vm.backendConnected,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  hintText: '…or type a line to speak',
                  isDense: true,
                ),
                onSubmitted: (_) => _sendHostText(),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: _vm.backendConnected ? _sendHostText : null,
              child: const Text('Say'),
            ),
          ]),

          const SizedBox(height: 16),
          Text(
            'The conversation runs on the server — ASR, LLM and TTS — and the reply is '
            'driven into the avatar there. This app only renders the audio and motion '
            'that come back.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  void _sendHostText() {
    final text = _textController.text.trim();
    if (text.isEmpty) return;
    _vm.backendSendText(text);
    _textController.clear();
  }

  Future<void> _loadCharacter(String id) async {
    setState(() {
      _selectedCharacterId = id;
      _isLoadingAvatar = true;
      _loadError = null;
      _loadProgress = 0;
    });

    _vm.close();
    _vm.avatar = null;

    try {
      final avatar = await AvatarManager.shared.load(
        id: id,
        onProgress: (progress) {
          setState(() => _loadProgress = progress);
        },
      );
      _vm.avatar = avatar;
      _avatarViewKey++;
      setState(() => _isLoadingAvatar = false);
    } catch (e) {
      setState(() {
        _loadError = e.toString();
        _isLoadingAvatar = false;
      });
    }
  }
}
