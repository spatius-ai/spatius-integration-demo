import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart';

import 'config.dart';
import 'playground_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AvatarBackendDemoApp());
}

class AvatarBackendDemoApp extends StatelessWidget {
  const AvatarBackendDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AvatarKit Backend Mode Demo',
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
      home: const BootPage(),
    );
  }
}

/// What `/api/config` reports, and the whole of it.
///
/// No credentials: in Backend Mode the server holds the Motion Server connection, so
/// this app never talks to Spatius and has no use for a key. The app id and region go
/// to [AvatarSDK.initialize], the avatar id is the character the playground opens
/// with, the rate describes the PCM on the WebSocket.
typedef BackendConfig = ({
  String appId,
  String avatarId,
  String region,
  int inputSampleRate,
});

/// The whole boot path.
///
/// There is no configuration screen: in Backend Mode the server holds the Motion
/// Server connection and every credential with it, and its address is fixed at build
/// time in [Config.backendModeURL]. So the only startup work is reading
/// `/api/config` and initializing the SDK with what comes back.
class BootPage extends StatefulWidget {
  const BootPage({super.key});

  @override
  State<BootPage> createState() => _BootPageState();
}

class _BootPageState extends State<BootPage> {
  BackendConfig? _config;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_boot());
  }

  Future<void> _boot() async {
    if (_config != null) return;
    setState(() => _error = null);

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
    try {
      final base = Config.backendModeURL.replaceAll(RegExp(r'/+$'), '');
      final request = await client.getUrl(Uri.parse('$base/api/config'));
      final response = await request.close();
      if (response.statusCode != 200) {
        throw Exception('HTTP ${response.statusCode} from /api/config');
      }
      final body = await response.transform(utf8.decoder).join();
      final json = jsonDecode(body) as Map<String, dynamic>;
      final config = (
        appId: json['appId'] as String? ?? '',
        avatarId: json['avatarId'] as String? ?? '',
        region: json['region'] as String? ?? 'us-west',
        inputSampleRate: (json['inputSampleRate'] as num?)?.toInt() ?? 16000,
      );

      await AvatarSDK.initialize(
        appID: config.appId,
        configuration: Configuration(
          region: config.region,
          audioFormat: AudioFormat(sampleRate: config.inputSampleRate),
          drivingServiceMode: DrivingServiceMode.backend,
          logLevel: LogLevel.all,
        ),
      );

      if (!mounted) return;
      setState(() => _config = config);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      client.close();
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = _config;
    if (config != null) {
      return PlaygroundPage(configuredAvatarId: config.avatarId);
    }
    return Scaffold(body: Center(child: _error == null ? _starting() : _bootError(_error!)));
  }

  Widget _starting() {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 10),
        Text('Starting…', style: theme.textTheme.bodySmall),
      ],
    );
  }

  /// The address is fixed at build time, so a failure here is not something the user
  /// can type their way out of — the fix is in `lib/config.dart` or in the server's
  /// `.env`, and this says which.
  Widget _bootError(String message) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Cannot reach the Backend Mode server',
            style: theme.textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
              fontFamily: 'monospace',
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            'Trying ${Config.backendModeURL} — set backendModeURL in lib/config.dart, '
            "or run ../../start.sh to fill in this machine's LAN address. Start the "
            'server with: cd servers/python && uv run python -m app.main',
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _boot, child: const Text('Retry')),
        ],
      ),
    );
  }
}
