import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:web_socket_channel/web_socket_channel.dart';

/// The realtime scene's agent connection.
///
/// Direct Mode drives the avatar from this device, so what comes back here is plain
/// audio: the agent does ASR → LLM → TTS and returns PCM, and the caller feeds it to
/// the controller exactly as it would a bundled clip. The avatar never joins anything.
class RealtimeClient {
  RealtimeClient({
    required this.onAudio,
    required this.onTurnEnd,
    required this.onInterrupt,
    required this.onTranscript,
    required this.onError,
    this.onClosed,
  });

  /// A chunk of the agent's reply, PCM16 at the configured sample rate.
  final void Function(Uint8List) onAudio;

  /// The reply is complete.
  final void Function() onTurnEnd;

  /// The agent cut itself off because the user started talking.
  final void Function() onInterrupt;

  /// What was said, as (role, text).
  final void Function(String role, String text) onTranscript;

  final void Function(String message) onError;

  /// The socket went away. Whatever was gated on the agent has to be un-gated, or the
  /// microphone stays lit against a connection that no longer exists.
  final void Function()? onClosed;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;

  /// Whether the agent has answered `ready`. Audio sent before then is dropped.
  bool isReady = false;

  bool get isConnected => _channel != null;

  /// Connect and wait for the agent to report ready.
  ///
  /// Returns once `ready` arrives: audio pushed before that is discarded by the
  /// server, which presents as a microphone that records and is never answered.
  Future<void> connect(String url, {String language = 'en', Duration timeout = const Duration(seconds: 20)}) async {
    await close();

    final ready = Completer<void>();
    final channel = WebSocketChannel.connect(Uri.parse(url));
    _channel = channel;

    _subscription = channel.stream.listen(
      (raw) {
        final message = _decode(raw);
        if (message == null) return;
        switch (message['type'] as String? ?? '') {
          case 'ready':
            isReady = true;
            if (!ready.isCompleted) ready.complete();
          case 'audio':
            final encoded = message['audio'] as String? ?? '';
            if (encoded.isNotEmpty) onAudio(base64Decode(encoded));
          case 'turn_end':
            onTurnEnd();
          case 'interrupt':
            onInterrupt();
          case 'transcript':
            onTranscript(
              message['role'] as String? ?? 'user',
              message['text'] as String? ?? '',
            );
          case 'error':
            final text = message['message'] as String? ?? 'Agent error';
            onError(text);
            if (!ready.isCompleted) ready.completeError(StateError(text));
        }
      },
      onError: (Object error) {
        isReady = false;
        if (!ready.isCompleted) {
          ready.completeError(StateError('Cannot reach the agent at $url'));
        } else {
          onError(error.toString());
        }
      },
      onDone: () {
        isReady = false;
        if (!ready.isCompleted) {
          ready.completeError(StateError('The agent closed the connection'));
        } else {
          onClosed?.call();
        }
      },
      cancelOnError: false,
    );

    channel.sink.add(jsonEncode({'type': 'start', 'language': language}));
    await ready.future.timeout(
      timeout,
      onTimeout: () => throw StateError('The agent did not become ready in time'),
    );
  }

  /// Push a chunk of microphone audio. Dropped until the agent is ready.
  void sendMicAudio(Uint8List pcm) {
    if (!isReady) return;
    _channel?.sink.add(jsonEncode({'type': 'mic_audio', 'audio': base64Encode(pcm)}));
  }

  /// Have the agent speak a typed line.
  void sendText(String text) {
    if (!isReady) return;
    _channel?.sink.add(jsonEncode({'type': 'text', 'text': text}));
  }

  void interrupt() {
    if (!isReady) return;
    _channel?.sink.add(jsonEncode({'type': 'interrupt'}));
  }

  Future<void> close() async {
    isReady = false;
    await _subscription?.cancel();
    _subscription = null;
    await _channel?.sink.close();
    _channel = null;
  }

  static Map<String, dynamic>? _decode(dynamic raw) {
    if (raw is! String) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}
