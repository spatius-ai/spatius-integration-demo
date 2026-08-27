import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart';
import 'package:url_launcher/url_launcher.dart';

import 'config.dart';
import 'playground_page.dart';

const _dashUrl = 'https://app.spatius.ai';
const _livekitUrl = 'https://cloud.livekit.io';

/// Which scene the playground opens in.
enum Scene { sample, realtime }

/// Which language the realtime conversation runs in.
enum Lang { en, zh }

/// One of the server's clips: what to show, and what to ask for.
///
/// The two differ — the name is the file without its extension — and sending the name
/// where the filename belongs gets a clip the server cannot find.
typedef ServerClip = ({String name, String clip});

/// The configuration screen.
///
/// Credentials are shown, never typed. Copying secrets across apps on a phone is
/// miserable, and the keyboard mangles them — autocapitalization and autocorrect leave
/// damage that is invisible afterwards. They belong in the server's `.env`, which the
/// user is already sitting in front of, and one copy there covers every client.
///
/// So the only field here is the server's address: a phone cannot reach the dev
/// machine's localhost, and the server prints its LAN address on startup.
class ConfigCheckPage extends StatefulWidget {
  const ConfigCheckPage({super.key});

  @override
  State<ConfigCheckPage> createState() => _ConfigCheckPageState();
}

class _ConfigCheckPageState extends State<ConfigCheckPage> {
  static const _prefsBaseUrl = 'baseUrl';
  static const _prefsScene = 'scene';
  static const _prefsLanguage = 'language';

  final _urlController = TextEditingController(text: Config.backendModeURL);
  Scene _scene = Scene.sample;
  Lang _language = Lang.en;

  bool _checking = true;
  bool _reachable = false;
  String? _statusText;

  /// Which credentials each scene is still waiting on. Reported per scene: the
  /// pre-recorded one needs only the Spatius pair, so a server without LiveKit's is
  /// not unconfigured — it just cannot run the realtime scene yet.
  List<String> _missingSample = [];
  List<String> _missingRealtime = [];

  String? _appId;
  String? _avatarId;
  String? _region;
  List<ServerClip> _clips = [];

  bool get _isRealtime => _scene == Scene.realtime;
  List<String> get _missing => _isRealtime ? _missingRealtime : _missingSample;
  bool get _ready => _reachable && _missing.isEmpty && !_checking;

  List<String> get _requiredKeys => _isRealtime
      ? const [
          'SPATIUS_API_KEY',
          'SPATIUS_APP_ID',
          'LIVEKIT_URL',
          'LIVEKIT_API_KEY',
          'LIVEKIT_API_SECRET',
        ]
      : const ['SPATIUS_API_KEY', 'SPATIUS_APP_ID'];

  @override
  void initState() {
    super.initState();
    _restore();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefsBaseUrl);
    if (saved != null && saved.isNotEmpty) _urlController.text = saved;
    _scene = prefs.getString(_prefsScene) == 'realtime' ? Scene.realtime : Scene.sample;
    _language = prefs.getString(_prefsLanguage) == 'zh' ? Lang.zh : Lang.en;
    if (mounted) setState(() {});
    await _check();
  }

  /// Persisted as they change, not once a session succeeds: the address is what makes
  /// the server reachable in the first place, so a failed Start is exactly when it must
  /// not be lost — otherwise every retry begins by typing an IP address on a phone
  /// keyboard again.
  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsBaseUrl, _urlController.text.trim());
    await prefs.setString(_prefsScene, _isRealtime ? 'realtime' : 'sample');
    await prefs.setString(_prefsLanguage, _language == Lang.zh ? 'zh' : 'en');
  }

  Future<void> _check() async {
    final base = _urlController.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) {
      setState(() {
        _checking = false;
        _reachable = false;
        _statusText = 'No server address';
      });
      return;
    }

    setState(() {
      _checking = true;
      _statusText = 'Checking…';
    });

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.getUrl(Uri.parse('$base/api/config'));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;

      // `missing` is an object keyed by scene, not a flat list.
      final missing = json['missing'] as Map<String, dynamic>?;
      List<String> listFor(String key) =>
          (missing?[key] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [];

      setState(() {
        _checking = false;
        _reachable = true;
        _statusText = 'Server online.';
        _missingSample = listFor('sample');
        _missingRealtime = listFor('realtime');
        _appId = json['appId'] as String?;
        _avatarId = json['avatarId'] as String?;
        _region = json['region'] as String? ?? 'us-west';
        _clips = ((json['clips'] as List<dynamic>?) ?? [])
            .map((e) => e as Map<String, dynamic>)
            .map((e) => (
                  name: e['name'] as String? ?? '',
                  clip: e['clip'] as String? ?? '',
                ))
            .toList();
      });
    } catch (e) {
      setState(() {
        _checking = false;
        _reachable = false;
        _statusText = e.toString();
      });
    } finally {
      client.close();
    }
  }

  Future<void> _start() async {
    final appId = _appId;
    if (appId == null) return;
    await _persist();

    await AvatarSDK.initialize(
      appID: appId,
      configuration: Configuration(
        region: _region ?? 'us-west',
        audioFormat: const AudioFormat(sampleRate: 16000),
        drivingServiceMode: DrivingServiceMode.backend,
        logLevel: LogLevel.all,
      ),
    );

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => PlaygroundPage(
          baseUrl: _urlController.text.trim().replaceAll(RegExp(r'/+$'), ''),
          scene: _scene,
          language: _language,
          configuredAvatarId: _avatarId ?? '',
          clips: _clips,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Backend Mode')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('AvatarKit Backend Mode Demo', style: theme.textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(
            'The server drives the avatar and streams it back. Pick where its audio '
            'comes from.',
            style: theme.textTheme.bodySmall,
          ),

          // The scene goes first: it decides which credentials are required below.
          const SizedBox(height: 20),
          Text('Scene', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: _SceneCard(
                title: 'Pre-recorded audio',
                subtitle: 'Play a server clip',
                selected: !_isRealtime,
                onTap: () {
                  setState(() => _scene = Scene.sample);
                  _persist();
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SceneCard(
                title: 'Realtime audio',
                subtitle: 'Talk to the avatar',
                selected: _isRealtime,
                onTap: () {
                  setState(() => _scene = Scene.realtime);
                  _persist();
                },
              ),
            ),
          ]),

          // The server's address. The one thing that cannot come from the server
          // itself, since this is how the phone finds it.
          const SizedBox(height: 20),
          Text('Server address', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          TextField(
            controller: _urlController,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'http://192.168.x.x:8765',
              isDense: true,
            ),
            onChanged: (_) => _persist(),
          ),
          const SizedBox(height: 4),
          Text(
            'The server prints this on startup. Use 10.0.2.2 on the Android emulator, '
            'the LAN address on a real device.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          Row(children: [
            OutlinedButton(
              onPressed: _checking ? null : _check,
              child: Text(_checking ? 'Checking…' : 'Check connection'),
            ),
            const SizedBox(width: 10),
            if (_statusText != null)
              Expanded(child: Text(_statusText!, style: theme.textTheme.bodySmall)),
          ]),

          // Only the realtime scene reaches an agent, so this appears with it.
          //
          // Chosen here rather than inside the scene: recognition, synthesis and the
          // persona are all fixed when the agent session is built, so it cannot be
          // switched on a running conversation.
          if (_isRealtime) ...[
            const SizedBox(height: 20),
            Text('Conversation language', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: _SceneCard(
                  title: 'English',
                  selected: _language == Lang.en,
                  onTap: () {
                    setState(() => _language = Lang.en);
                    _persist();
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _SceneCard(
                  title: '中文',
                  selected: _language == Lang.zh,
                  onTap: () {
                    setState(() => _language = Lang.zh);
                    _persist();
                  },
                ),
              ),
            ]),
            const SizedBox(height: 4),
            Text(
              "Sets speech recognition, the voice, and the assistant's persona.",
              style: theme.textTheme.bodySmall,
            ),
          ],

          const Divider(height: 40),

          // Credentials, shown but not editable — see the note on this page.
          Text('Credentials', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          if (_checking)
            Row(children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 8),
              Text('Checking server…', style: theme.textTheme.bodySmall),
            ])
          else if (!_reachable)
            Text(
              'Cannot reach the server. Start it with: cd servers/python && '
              'uv run uvicorn app.main:app --host 0.0.0.0',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
            )
          else ...[
            for (final key in _requiredKeys)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(key, style: theme.textTheme.bodySmall),
                    Text(
                      _missing.contains(key) ? 'missing' : 'configured',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: _missing.contains(key)
                            ? theme.colorScheme.error
                            : const Color(0xFF22C55E),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 6),
            Text(
              "Set these in the server's .env — they never reach this device. In Backend "
              'Mode the server holds the Motion Server connection, so this app never '
              'talks to Spatius at all.',
              style: theme.textTheme.bodySmall,
            ),
          ],

          const SizedBox(height: 24),
          FilledButton(
            onPressed: _ready ? _start : null,
            child: const Text('Start'),
          ),
          if (_reachable && _missing.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              "Fill in ${_missing.join(', ')} in the server's .env first.",
              style: theme.textTheme.bodySmall,
            ),
          ],

          // One guide per credential set, in the order the keys are listed above. The
          // Spatius one is always there; LiveKit's is added by the realtime scene
          // rather than replacing it, since that scene needs both.
          const SizedBox(height: 24),
          Text('Where to find these', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          _GuideImage('assets/api-key-guide.png', 'App ID and API Key', _dashUrl),
          if (_isRealtime) ...[
            const SizedBox(height: 8),
            _GuideImage('assets/livekit-guide-1.jpg', 'LiveKit: project settings', _livekitUrl),
            const SizedBox(height: 6),
            _GuideImage('assets/livekit-guide-2.jpg', 'LiveKit: API keys', _livekitUrl),
          ],
        ],
      ),
    );
  }
}

class _SceneCard extends StatelessWidget {
  const _SceneCard({
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? theme.colorScheme.primary.withValues(alpha: 0.10) : null,
          border: Border.all(
            color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            if (subtitle != null) ...[
              const SizedBox(height: 2),
              Text(subtitle!, style: theme.textTheme.bodySmall),
            ],
          ],
        ),
      ),
    );
  }
}

class _GuideImage extends StatelessWidget {
  const _GuideImage(this.asset, this.caption, this.url);

  final String asset;
  final String caption;
  final String url;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.asset(asset, fit: BoxFit.fitWidth, width: double.infinity),
          ),
        ),
        Text(caption, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
