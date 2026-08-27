import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart';
import 'package:url_launcher/url_launcher.dart';

import 'backend_client.dart';
import 'playground_page.dart';

const _dashUrl = 'https://app.spatius.ai';
const _livekitUrl = 'https://cloud.livekit.io';
const _defaultServerUrl = 'http://localhost:8090';

/// Which scene the playground opens in.
enum Scene { sample, realtime }

/// Which language the realtime conversation runs in.
enum Lang { en, zh }

/// The configuration screen.
///
/// Credentials are shown, never typed. Copying secrets across apps on a phone is
/// miserable, and the keyboard mangles them — autocapitalization and autocorrect leave
/// damage that is invisible afterwards. They belong in the server's `.env`, which the
/// user is already sitting in front of, and one copy there covers every client.
///
/// So the only field here is the server's address: a phone cannot reach the dev
/// machine's localhost, and the server prints its LAN address on startup.
class ConfigurationPage extends StatefulWidget {
  const ConfigurationPage({super.key});

  @override
  State<ConfigurationPage> createState() => _ConfigurationPageState();
}

class _ConfigurationPageState extends State<ConfigurationPage> {
  static const _prefsBaseUrl = 'baseUrl';
  static const _prefsScene = 'scene';
  static const _prefsLanguage = 'language';

  final _urlController = TextEditingController(text: _defaultServerUrl);
  Scene _scene = Scene.sample;
  Lang _language = Lang.en;

  bool _checking = true;
  ServerConfig? _config;
  String? _statusText;

  bool get _isRealtime => _scene == Scene.realtime;
  List<String> get _missing => _config == null
      ? const []
      : (_isRealtime ? _config!.missingRealtime : _config!.missingSample);
  bool get _ready => _config != null && _missing.isEmpty && !_checking;

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
    if (_urlController.text.trim().isEmpty) {
      setState(() {
        _checking = false;
        _config = null;
        _statusText = 'No server address';
      });
      return;
    }

    setState(() {
      _checking = true;
      _statusText = 'Checking…';
    });

    try {
      final config = await BackendClient.fetchConfig(_urlController.text);
      setState(() {
        _checking = false;
        _config = config;
        _statusText = 'Server online.';
      });
    } catch (e) {
      setState(() {
        _checking = false;
        _config = null;
        _statusText = e.toString();
      });
    }
  }

  Future<void> _start() async {
    final config = _config;
    if (config == null) return;
    await _persist();

    setState(() => _checking = true);
    try {
      // The API key never reaches this device: the server signs a session token from
      // it and hands that over, which is what the SDK authenticates with.
      final token = await BackendClient.fetchSessionToken(_urlController.text);

      await AvatarSDK.initialize(
        appID: config.appId,
        configuration: Configuration(
          region: config.region,
          audioFormat: AudioFormat(sampleRate: config.sampleRate),
          drivingServiceMode: DrivingServiceMode.direct,
          logLevel: LogLevel.warning,
        ),
      );
      await AvatarSDK.setSessionToken(token);

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => PlaygroundPage(
            scene: _scene,
            language: _language,
            realtimeUrl: config.realtimeUrl,
            configuredAvatarId: config.avatarId,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _checking = false;
        _statusText = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Direct Mode')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('AvatarKit Direct Mode Demo', style: theme.textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(
            'The client drives the avatar directly. Pick where its audio comes from.',
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
                subtitle: 'Play a bundled clip',
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
              hintText: 'http://192.168.x.x:8090',
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
          else if (_config == null)
            Text(
              'Cannot reach the server. Start it with: cd servers/python && '
              'uv run python app.py',
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
              "Set these in the server's .env — they never reach this device. The "
              'server signs a session token from the API key, and that is all this app '
              'ever holds.',
              style: theme.textTheme.bodySmall,
            ),
          ],

          const SizedBox(height: 24),
          FilledButton(
            onPressed: _ready ? _start : null,
            child: const Text('Start'),
          ),
          if (_config != null && _missing.isNotEmpty) ...[
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
