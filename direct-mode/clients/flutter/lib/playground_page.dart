import 'package:flutter/material.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' hide ConnectionState, Transform;

import 'avatar_view_model.dart';
import 'characters.dart';
import 'configuration_page.dart';

class PlaygroundPage extends StatefulWidget {
  const PlaygroundPage({
    super.key,
    required this.scene,
    required this.language,
    required this.realtimeUrl,
    required this.configuredAvatarId,
  });

  final Scene scene;
  final Lang language;

  /// Where the realtime scene's agent socket lives, as the server reported it.
  final String realtimeUrl;

  /// Whatever the server nominates, so the playground is never empty on arrival.
  final String configuredAvatarId;

  @override
  State<PlaygroundPage> createState() => _PlaygroundPageState();
}

class _PlaygroundPageState extends State<PlaygroundPage> {
  final AvatarViewModel _vm = AvatarViewModel();

  String? _selectedCharacterId;
  bool _isLoadingAvatar = false;
  double _loadProgress = 0;
  String? _loadError;
  bool _showCustomInput = false;
  final TextEditingController _customIdController = TextEditingController();
  final TextEditingController _textController = TextEditingController();
  int _avatarViewKey = 0;

  @override
  void initState() {
    super.initState();
    _vm.realtimeUrl = widget.realtimeUrl;
    _vm.language = widget.language == Lang.zh ? 'zh' : 'en';
    // Whatever the server nominates, loaded on arrival — the same as the iOS and
    // Android clients, so the playground is never empty to begin with.
    if (widget.configuredAvatarId.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _loadCharacter(widget.configuredAvatarId);
      });
    }
    _vm.addListener(_onVmChanged);
    _vm.onToast = _showToast;
  }

  void _onVmChanged() {
    if (mounted) setState(() {});
  }

  void _showAudioHint() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sending audio'),
        content: const Text(audioSourceHint),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }

  void _showToast(ToastMessage message) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    // Replace rather than queue: a stale message behind the current one is
    // noise, not history.
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message.text),
        backgroundColor: message.kind == ToastKind.warning
            ? const Color(0xFF8A5A00)
            : const Color(0xFFB3261E),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 4),
      ),
    );
  }

  @override
  void dispose() {
    _vm.removeListener(_onVmChanged);
    _vm.onToast = null;
    _vm.close();
    _vm.dispose();
    _customIdController.dispose();
    _textController.dispose();
    _vm.closeRealtime();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Direct Mode'),
        centerTitle: true,
        actions: [
          // A dialog rather than a list beside the avatar: a phone has no room for
          // both, and the avatar is what the screen is for.
          TextButton(onPressed: _showCharacters, child: const Text('Characters')),
        ],
      ),
      body: Column(
        children: [
          _buildAvatarSection(),
          // Above the status bar: connecting is the first thing to do once a
          // character is loaded, and the status below reports whether it worked.
          if (_vm.avatar != null) _buildStartButton(),
          const Divider(height: 1),
          // The two scenes differ only in where the audio comes from: a bundled clip,
          // or this device's microphone with an agent answering. Both end at
          // controller.yieldAudioData().
          // What drives the avatar, and the only thing that differs between the two
          // scenes. The realtime panel is one control and a transcript that grows, so
          // it scrolls with the status bar above it; the clips are what gets tapped
          // and the status is what gets read while the avatar answers, so those two
          // sit side by side and neither may push the other off screen.
          Expanded(
            child: widget.scene == Scene.realtime
                ? SingleChildScrollView(
                    child: Column(children: [
                      _buildStatusBar(),
                      _buildRealtimePanel(),
                    ]),
                  )
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: SingleChildScrollView(child: _buildStatusBar()),
                      ),
                      Expanded(
                        child: SingleChildScrollView(child: _buildAudioFileSection()),
                      ),
                    ],
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
              },
            ),
          ),
          // Over the avatar, since that is what they act on, and pinned to the two
          // bottom corners rather than centred as a pair: the avatar's face is in the
          // middle, and a row of buttons across it is the one place they cannot go.
          // Interrupt keeps the left corner in both states — it does the same thing
          // either way, and moving it would make the two swap places on every pause.
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
  /// Listed whether or not this demo acts on the value — which hooks exist is part of
  /// what a reference client is meant to show. A value of `—` means "registered,
  /// nothing reported yet".
  Widget _buildStatusBar() {
    final theme = Theme.of(context);
    final rows = <(String, String?)>[
      ('Download', _isLoadingAvatar ? '${(_loadProgress * 100).toInt()}%' : 'complete'),
      ('First frame', _vm.avatar != null ? 'rendered' : 'waiting'),
      ('Connection', _vm.connectionState),
      ('Conversation', _vm.conversationState),
      ('Frame rate', _vm.fps == null ? null : '${_vm.fps} fps'),
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
                            : value == null
                                ? theme.colorScheme.outline
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
  /// enough to read is a label wide enough to cover the picture. The white ring is
  /// what keeps it readable against a light avatar and a dark background alike.
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

  Widget _buildStartButton() {
    final connected = _vm.connectionState == 'connected';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: connected ? null : _vm.start,
          child: Text(connected ? 'Connected' : 'Start'),
        ),
      ),
    );
  }

  Widget _buildAudioFileSection() {
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
                  'Audio Files',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
                const SizedBox(width: 4),
                InkWell(
                  onTap: _showAudioHint,
                  child: const Icon(Icons.help_outline,
                      size: 14, color: Colors.grey),
                ),
                const Spacer(),
                if (_vm.isSendingAudio)
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          ..._vm.audioFiles.map((file) => InkWell(
                onTap: _vm.isSendingAudio ? null : () => _vm.sendAudioFile(file),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Row(
                    children: [
                      const Icon(Icons.graphic_eq, size: 14, color: Colors.grey),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          file,
                          style: const TextStyle(fontSize: 11),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (_vm.currentlyPlayingFile == file)
                        const Icon(Icons.volume_up,
                            size: 14, color: Colors.blue),
                    ],
                  ),
                ),
              )),
        ],
      ),
    );
  }

  // --- Character section ---

  void _showCharacters() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Characters'),
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

  /// The realtime scene: one microphone, a way to type instead, and what was said.
  Widget _buildRealtimePanel() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          InkWell(
            onTap: _vm.agentConnecting
                ? null
                : () => _vm.micActive ? _vm.stopMic() : _vm.startMic(),
            customBorder: const CircleBorder(),
            child: Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _vm.micActive ? const Color(0xFFEF4444) : theme.colorScheme.primary,
              ),
              child: Icon(
                _vm.micActive ? Icons.stop : Icons.mic,
                color: Colors.white,
                size: 30,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            switch (true) {
              _ when _vm.agentConnecting => 'Starting the agent…',
              _ when !_vm.agentReady => 'Tap to start talking.',
              _ when _vm.micActive =>
                'Listening — just talk, the agent decides when your turn ends.',
              _ => 'Tap to start talking.',
            },
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _textController,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  hintText: '…or type a line to speak',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: () {
                final line = _textController.text;
                _textController.clear();
                _vm.sendText(line);
              },
              child: const Text('Say'),
            ),
          ]),
          if (_vm.transcript.isNotEmpty) ...[
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerLeft,
              child: Text('Transcript', style: theme.textTheme.titleSmall),
            ),
            const SizedBox(height: 4),
            for (final (role, said) in _vm.transcript.take(20))
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 1),
                  child: Text(
                    '${role == 'user' ? 'You' : 'Avatar'}: $said',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ),
          ],
        ],
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
          if (_showCustomInput)
            _buildCustomIdInput()
          else
            _buildCustomIdButton(),
          if (_loadError != null)
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
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
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(width: 8),
            Text(character.name, style: const TextStyle(fontSize: 12)),
            const Spacer(),
            if (isLoading)
              Text(
                '${(_loadProgress * 100).toInt()}%',
                style: const TextStyle(
                    fontSize: 10,
                    color: Colors.blue,
                    fontWeight: FontWeight.w600),
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
                border:
                    Border.all(color: Colors.grey, style: BorderStyle.solid),
              ),
              child: const Center(
                child: Text('+',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
              ),
            ),
            const SizedBox(width: 8),
            const Text('Custom ID',
                style: TextStyle(fontSize: 12, color: Colors.grey)),
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
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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

  // --- Actions ---

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
