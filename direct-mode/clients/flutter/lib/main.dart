import 'package:flutter/material.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' hide ConnectionState, Transform;

import 'backend_client.dart';
import 'config.dart';
import 'playground_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AvatarSdkDemoApp());
}

class AvatarSdkDemoApp extends StatelessWidget {
  const AvatarSdkDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AvatarKit SDK Demo',
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
      home: const BootPage(),
    );
  }
}

/// What is on screen while the server is being reached, and when it cannot be.
///
/// There is nothing to fill in — everything lives in the server's `.env`. On launch
/// this fetches `/api/config`, mints a Session Token, initializes the SDK, and hands
/// over to the playground. The API key never reaches the device.
class BootPage extends StatefulWidget {
  const BootPage({super.key});

  @override
  State<BootPage> createState() => _BootPageState();
}

class _BootPageState extends State<BootPage> {
  ServerConfig? _config;
  bool _booting = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  /// Fetch the configuration, mint a token, initialize the SDK.
  ///
  /// The whole of the credential path in a Direct Mode app: the server exchanges the
  /// `SPATIUS_API_KEY` in its own `.env` for a short-lived Session Token, and that
  /// token is what the SDK gets.
  Future<void> _boot() async {
    setState(() {
      _booting = true;
      _errorMessage = null;
    });

    try {
      final config = await BackendClient.fetchConfig(directModeUrl);
      final token = await BackendClient.fetchSessionToken(directModeUrl);

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
      setState(() {
        _config = config;
        _booting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _booting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = _config;
    if (config != null) {
      return PlaygroundPage(
        realtimeUrl: config.realtimeUrl,
        configuredAvatarId: config.avatarId,
      );
    }

    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: _booting
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 16),
                    Text(
                      'Connecting to the Direct Mode server…',
                      style: theme.textTheme.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Cannot start', style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 16),
                    Text(
                      _errorMessage ?? 'Could not reach the Direct Mode server',
                      style: theme.textTheme.bodyMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Check that the server is running, that its .env is filled in, '
                      'and that directModeUrl in lib/config.dart points at it.',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.outline),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(onPressed: _boot, child: const Text('Retry')),
                  ],
                ),
        ),
      ),
    );
  }
}
