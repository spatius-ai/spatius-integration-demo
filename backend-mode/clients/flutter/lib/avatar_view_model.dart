import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' as ak;
import 'package:web_socket_channel/web_socket_channel.dart';

import 'config.dart';

class AvatarViewModel extends ChangeNotifier {
  // --- Public state ---
  String connectionState = 'disconnected';
  String conversationState = 'idle';
  String? errorMessage;
  ak.Avatar? avatar;

  bool backendConnected = false;
  bool backendConnecting = false;
  bool backendMicActive = false;

  // --- Private ---
  ak.AvatarController? _controller;
  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSubscription;
  /// The id `yieldAudioData` handed back, which the frames for the same reply need.
  ///
  /// One id, not a map keyed by the server's `turnId`: the SDK mints a fresh id as a
  /// reply goes on, and the latest is the one the frames belong to. Keeping the first
  /// leaves every later batch addressed to an id the SDK has moved past, and the clip
  /// never finishes playing.
  String? _conversationId;

  /// Serialises what reaches the SDK.
  ///
  /// `yieldAudioData` and `yieldAnimations` are asynchronous, and the messages arrive
  /// on the socket's own thread faster than the SDK drains them. Firing each without
  /// waiting lets them land out of order — stutter and static on the audio, and a
  /// conversation id overwritten by a stale one. Chaining through a single future
  /// keeps the order the server sent.
  ///
  /// Unlike Direct Mode, the chain is not optional here: the id the frames need is
  /// what `yieldAudioData` returns, so the frames genuinely have to wait for the
  /// audio message that precedes them.
  Future<void> _sdkQueue = Future<void>.value();

  /// Whether the agent has been asked for, and whether it can be spoken to yet.
  ///
  /// The server starts it asynchronously after `start_agent`, and audio pushed before
  /// `agent_ready` is dropped — a microphone that records and is never answered.
  bool agentConnecting = false;
  bool agentReady = false;

  /// Whether `start_agent` has been sent on this connection. Sent once, and only by
  /// the realtime scene: an agent costs a model session and a clip needs none.
  bool _agentStarted = false;

  /// What has been said so far, as (role, text).
  List<(String, String)> transcript = [];

  /// The clips the server can play, and which one is mid-flight.
  List<({String name, String clip})> clips = [];
  String? playingClip;

  /// Which language the realtime conversation runs in; set from the config screen.
  String language = 'en';

  /// Where the server is, as typed on the config screen.
  ///
  /// Not the compile-time constant: that defaults to localhost, which a real device
  /// cannot reach — the address has to be the one the user actually entered.
  String baseUrl = Config.backendModeURL;

  // Microphone
  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription? _micSubscription;

  // --- Controller ---

  void setAvatarController(ak.AvatarController controller) {
    _controller = controller;

    controller.onConnectionState = (state, errorMsg) {
      connectionState = state.name;
      if (state == ak.ConnectionState.connected) {
        // no-op for Backend Mode
      }
      notifyListeners();
    };

    controller.onConversationState = (state) {
      conversationState = state.name;
      notifyListeners();
    };

    controller.onError = (error) {
      errorMessage = error.name;
      notifyListeners();
    };
  }

  // --- Lifecycle ---

  void start() => _controller?.start();

  void pause() => _controller?.pause();

  void resume() => _controller?.resume();

  /// Cut off what the avatar is saying.
  ///
  /// The microphone stays open: interrupting means "stop talking", not "I am done
  /// talking" — closing it here made every interruption end the turn as well.
  void interrupt() {
    _controller?.interrupt();
  }

  // --- Backend Mode: WebSocket ---

  Uri get _backendWsUrl {
    final base = baseUrl
        .replaceFirst('http://', 'ws://')
        .replaceFirst('https://', 'wss://');
    return Uri.parse('$base/ws/agent');
  }

  void backendConnect() {
    if (_wsChannel != null || backendConnecting) return;
    backendConnecting = true;
    errorMessage = null;
    notifyListeners();

    try {
      final channel = WebSocketChannel.connect(_backendWsUrl);
      _wsChannel = channel;

      _wsSubscription = channel.stream.listen(
        (message) {
          if (message is String) _handleWsMessage(message);
        },
        onError: (error) {
          errorMessage = error.toString();
          _onWsDisconnected();
        },
        onDone: _onWsDisconnected,
      );
    } catch (e) {
      errorMessage = e.toString();
      backendConnecting = false;
      notifyListeners();
    }
  }

  void backendDisconnect() {
    _resetAgent();
    backendStopMic();
    _wsSubscription?.cancel();
    _wsSubscription = null;
    _wsChannel?.sink.close();
    _wsChannel = null;
    backendConnected = false;
    backendConnecting = false;
    _conversationId = null;
    notifyListeners();
  }

  void _onWsDisconnected() {
    _resetAgent();
    backendConnected = false;
    backendConnecting = false;
    backendMicActive = false;
    _wsChannel = null;
    _wsSubscription = null;
    _conversationId = null;
    notifyListeners();
  }

  void _sendWsMessage(Map<String, dynamic> msg) {
    _wsChannel?.sink.add(jsonEncode(msg));
  }

  void _handleWsMessage(String text) {
    final json = jsonDecode(text) as Map<String, dynamic>;
    final type = json['type'] as String?;
    if (type == null) return;

    // `ready` is handled before the controller check on purpose: it arrives while the
    // avatar may still be loading, and dropping it left the session connected in name
    // only — every control disabled, and the server never told which avatar to drive.
    // Only the frames actually need a controller.
    if (type == 'ready') {
      backendConnected = true;
      backendConnecting = false;
      notifyListeners();
      _sendWsMessage({'type': 'set_avatar', 'avatarId': avatar?.id ?? ''});
      return;
    }

    if (type == 'agent_ready') {
      agentConnecting = false;
      agentReady = true;
      notifyListeners();
      return;
    }

    if (type == 'transcript') {
      final said = json['text'] as String? ?? '';
      if (said.isNotEmpty) {
        transcript = [...transcript, (json['role'] as String? ?? 'user', said)];
        notifyListeners();
      }
      return;
    }

    final controller = _controller;
    if (controller == null) return;

    switch (type) {

      case 'avatar_audio':
        final audioB64 = json['audio'] as String? ?? '';
        final audioData =
            audioB64.isEmpty ? Uint8List(0) : base64Decode(audioB64);
        final isLast = json['isLast'] as bool? ?? false;
        _sdkQueue = _sdkQueue.then((_) async {
          _conversationId = await controller.yieldAudioData(audioData, end: isLast);
          if (isLast) {
            playingClip = null;
            notifyListeners();
          }
        });

      case 'avatar_frames':
        final framesArr = json['frames'] as List?;
        if (framesArr == null) return;
        final frames = framesArr
            .cast<String>()
            .map((f) => base64Decode(f))
            .toList();
        // Queued behind the audio: the id the frames need is what that call returns,
        // and the two messages are independent on the wire.
        _sdkQueue = _sdkQueue.then((_) async {
          final cid = _conversationId;
          if (cid != null && frames.isNotEmpty) {
            await controller.yieldAnimations(frames, conversationID: cid);
          }
        });

      case 'interrupt':
        _conversationId = null;
        playingClip = null;
        controller.interrupt();

      case 'error':
        playingClip = null;
        errorMessage = json['message'] as String? ?? 'Unknown error';
        notifyListeners();
    }
  }

  // --- Backend Mode: Microphone ---

  /// Ask the server to start the conversational agent, once per connection.
  void _ensureAgent() {
    if (_agentStarted || !backendConnected) return;
    _agentStarted = true;
    agentConnecting = true;
    notifyListeners();
    _sendWsMessage({'type': 'start_agent', 'language': language});
  }

  /// Forget the agent. It belongs to the socket, so a new connection needs a new one.
  void _resetAgent() {
    _agentStarted = false;
    agentConnecting = false;
    agentReady = false;
  }

  /// Ask the server to stream one of its clips into the avatar.
  ///
  /// The clips live on the server and never pass through this app: what arrives back
  /// is the same audio-plus-motion pair the realtime scene produces.
  void playSample(String clip) {
    if (!backendConnected) backendConnect();
    playingClip = clip;
    notifyListeners();
    _sendWsMessage({'type': 'play_sample', 'clip': clip});
  }

  Future<void> backendStartMic() async {
    // The server drops audio that arrives before the agent exists, so the mic
    // starting is what brings it up.
    _ensureAgent();
    if (!backendConnected || backendMicActive) return;

    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      errorMessage = 'Microphone permission denied';
      notifyListeners();
      return;
    }

    final stream = await _recorder.startStream(
      const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
        autoGain: true,
        echoCancel: true,
        noiseSuppress: true,
        // VOICE_COMMUNICATION, not the default MIC: `echoCancel` alone is a software
        // flag, and on Android the hardware canceller only engages on this source.
        // Without it the avatar's own voice comes back in through the microphone,
        // reaches the agent as user speech, and it answers itself.
        androidConfig: AndroidRecordConfig(
          audioSource: AndroidAudioSource.voiceCommunication,
        ),
      ),
    );

    backendMicActive = true;
    notifyListeners();

    _micSubscription = stream.listen((data) {
      if (_wsChannel == null) return;
      final b64 = base64Encode(data);
      _sendWsMessage({'type': 'mic_audio', 'audio': b64});
    });
  }

  void backendStopMic() {
    if (!backendMicActive) return;
    _micSubscription?.cancel();
    _micSubscription = null;
    _recorder.stop();
    backendMicActive = false;
    _sendWsMessage({'type': 'mic_end'});
    notifyListeners();
  }

  // --- Backend Mode: Text ---

  void backendSendText(String text) {
    // A typed line goes to the same agent the microphone talks to.
    _ensureAgent();
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    if (!backendConnected && !backendConnecting) {
      backendConnect();
    }

    // If already connected, send immediately; otherwise wait
    if (backendConnected && _wsChannel != null) {
      _sendWsMessage({'type': 'text', 'text': trimmed});
    } else {
      // Poll for connection (up to 3s)
      _waitAndSendText(trimmed);
    }
  }

  Future<void> _waitAndSendText(String text) async {
    for (var i = 0; i < 30; i++) {
      if (backendConnected) break;
      await Future.delayed(const Duration(milliseconds: 100));
    }
    if (backendConnected && _wsChannel != null) {
      _sendWsMessage({'type': 'text', 'text': text});
    }
  }

  // --- Cleanup ---

  void close() {
    backendDisconnect();
    _controller?.close();
  }

  @override
  void dispose() {
    close();
    _recorder.dispose();
    super.dispose();
  }
}
