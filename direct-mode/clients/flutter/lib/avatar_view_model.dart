import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:record/record.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' as ak;

import 'realtime_client.dart';

/// Shown next to the clip list so nobody reads the bundled files as the limit of
/// what Direct Mode accepts.
const audioSourceHint =
    'These clips are bundled samples, not a limitation. send() takes any PCM16 audio '
    'at the configured sample rate — stream it live from a microphone, a TTS service, '
    'or your own pipeline the same way. The demo ships files so it runs without extra setup.';

const _audioFiles = [
  'demo_pcm_audio1.pcm',
  'demo_pcm_audio2.pcm',
  'demo_pcm_audio3.pcm',
  'speech.pcm',
];

enum ToastKind { error, warning }

class ToastMessage {
  const ToastMessage(this.text, {this.kind = ToastKind.error});

  final String text;
  final ToastKind kind;
}

class AvatarViewModel extends ChangeNotifier {
  // --- Public state ---
  String connectionState = 'disconnected';
  String conversationState = 'idle';
  String? errorMessage;
  /// onFrameRateInfo — null until the monitor has reported once.
  int? fps;
  ak.Avatar? avatar;
  bool isSendingAudio = false;
  String? currentlyPlayingFile;

  /// Set by the page so failures and blocked actions surface in the UI
  /// instead of only reaching [errorMessage].
  void Function(ToastMessage)? onToast;

  List<String> get audioFiles => _audioFiles;

  // --- Realtime scene ---
  /// Whether the agent socket is being opened, and whether it is ready to be spoken
  /// to. Audio pushed before ready is dropped, which presents as a microphone that
  /// records and is never answered.
  bool agentConnecting = false;
  bool agentReady = false;
  bool micActive = false;

  /// What has been said so far, as (role, text).
  List<(String, String)> transcript = [];

  /// Where the agent socket lives and which language it runs in; both come from the
  /// configuration screen.
  String realtimeUrl = '';
  String language = 'en';

  // --- Private ---
  ak.AvatarController? _controller;
  bool _isConnected = false;
  Completer<void>? _sendCanceller;

  RealtimeClient? _realtime;

  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription<Uint8List>? _micSubscription;


  // --- Controller ---

  void setAvatarController(ak.AvatarController controller) {
    _controller = controller;

    // Off by default and free while off; the status bar is what asks for it.
    controller.setFrameRateMonitorEnabled(true);
    controller.onFrameRateInfo = (info) {
      // displayFps, not productionFps: what reached the screen, which is what a
      // reader comparing devices is actually asking about.
      fps = info.displayFps.round();
      notifyListeners();
    };

    controller.onConnectionState = (state, errorMsg) {
      connectionState = state.name;
      _isConnected = state == ak.ConnectionState.connected;
      if (state == ak.ConnectionState.disconnected ||
          state == ak.ConnectionState.failed) {
        _cancelSending();
      }
      notifyListeners();
    };

    controller.onConversationState = (state) {
      conversationState = state.name;
      notifyListeners();
    };

    controller.onError = (error) {
      errorMessage = error.name;
      onToast?.call(ToastMessage(error.name));
      notifyListeners();
    };
  }

  // --- Lifecycle ---

  void start() => _controller?.start();

  void pause() => _controller?.pause();

  void resume() => _controller?.resume();

  void interrupt() {
    _cancelSending();
    _controller?.interrupt();
  }

  // --- Realtime scene ---

  /// Open the agent socket, once per session.
  ///
  /// Only the realtime scene calls this: an agent costs a model session, and a
  /// pre-recorded clip needs none.
  Future<void> _ensureAgent() async {
    if (agentReady || agentConnecting || realtimeUrl.isEmpty) return;
    agentConnecting = true;
    notifyListeners();

    final client = RealtimeClient(
      // Direct Mode drives from here: what the agent returns is plain PCM, fed to the
      // controller exactly as a bundled clip would be.
      onAudio: (pcm) async {
        // send(), not yieldAudioData(): that one is Backend Mode's, for audio the
        // server has already driven. Direct Mode drives from here, so the agent's
        // reply goes through the same call the pre-recorded clips end at — `end`
        // stays false, since a turn is many of these and turn_end closes it.
        // Not awaited, and not chained behind the previous chunk: Dart runs this
        // isolate's callbacks one at a time, so the calls reach the platform channel
        // in the order they were made. Waiting for each `send` to return before
        // issuing the next paces the stream to however long the SDK takes to accept
        // a chunk, which comes out as speech that stops between words. The iOS
        // client hands each chunk to the main actor the same way.
        _controller?.send(pcm, end: false);
      },
      onTurnEnd: () async {
        // The empty final send is what tells the SDK the turn is over, so the
        // avatar returns to idle rather than holding the last shape. Queued behind
        // the audio, or it would close a turn whose chunks have not landed yet.
        _controller?.send(Uint8List(0), end: true);
      },
      onInterrupt: () {
        _controller?.interrupt();
      },
      onTranscript: (role, text) {
        if (text.isEmpty) return;
        transcript = [...transcript, (role, text)];
        notifyListeners();
      },
      onError: (message) {
        errorMessage = message;
        onToast?.call(ToastMessage(message));
        notifyListeners();
      },
      onClosed: () {
        agentReady = false;
        micActive = false;
        notifyListeners();
      },
    );

    try {
      await client.connect(realtimeUrl, language: language);
      _realtime = client;
      agentReady = true;
    } catch (e) {
      await client.close();
      errorMessage = e.toString();
      onToast?.call(ToastMessage(e.toString()));
    } finally {
      agentConnecting = false;
      notifyListeners();
    }
  }

  Future<void> startMic() async {
    // The agent drops audio that arrives before it is ready, so opening the mic is
    // what brings it up.
    await _ensureAgent();
    if (!agentReady || micActive) return;

    if (!await _recorder.hasPermission()) {
      errorMessage = 'Microphone permission denied';
      onToast?.call(const ToastMessage('Microphone permission denied'));
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

    micActive = true;
    notifyListeners();
    _micSubscription = stream.listen((data) => _realtime?.sendMicAudio(data));
  }

  Future<void> stopMic() async {
    if (!micActive) return;
    await _micSubscription?.cancel();
    _micSubscription = null;
    await _recorder.stop();
    micActive = false;
    notifyListeners();
  }

  /// Have the agent speak a typed line — a way to try the scene without a microphone.
  Future<void> sendText(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    await _ensureAgent();
    _realtime?.sendText(trimmed);
  }

  void close() {
    _cancelSending();
    _controller?.close();
  }

  // --- Audio file sending ---

  /// Streams a bundled clip to the avatar.
  ///
  /// The chunking is what matters, not the file: [ak.AvatarController.send] accepts
  /// any PCM16 at the configured sample rate, so a microphone or TTS stream feeds it
  /// the same way — hand it bytes as they arrive and mark the final chunk with `end`.
  Future<void> sendAudioFile(String filename) async {
    // Direct Mode has no session until start() runs, so audio sent now would
    // be dropped silently. Say so instead of leaving a dead button.
    if (!_isConnected) {
      onToast?.call(const ToastMessage(
        'Please tap Start to connect before sending audio.',
        kind: ToastKind.warning,
      ));
      return;
    }

    final controller = _controller;
    if (controller == null) return;

    _cancelSending();
    controller.interrupt();

    Uint8List audioData;
    try {
      final byteData = await rootBundle.load('assets/$filename');
      audioData = byteData.buffer.asUint8List();
    } catch (e) {
      errorMessage = 'Cannot read $filename';
      onToast?.call(ToastMessage('Cannot read $filename'));
      notifyListeners();
      return;
    }

    isSendingAudio = true;
    currentlyPlayingFile = filename;
    notifyListeners();

    final canceller = Completer<void>();
    _sendCanceller = canceller;

    // 1 second of 16kHz 16-bit mono = 32000 bytes
    const chunkSize = 32000;
    var offset = 0;

    while (offset < audioData.length && !canceller.isCompleted && _isConnected) {
      final end = (offset + chunkSize).clamp(0, audioData.length);
      final isLast = end >= audioData.length;
      final chunk = audioData.sublist(offset, end);
      controller.send(chunk, end: isLast);
      offset = end;
      if (!isLast) {
        await Future.delayed(const Duration(milliseconds: 100));
      }
    }

    if (!canceller.isCompleted) {
      isSendingAudio = false;
      currentlyPlayingFile = null;
      notifyListeners();
    }
  }

  void _cancelSending() {
    _sendCanceller?.complete();
    _sendCanceller = null;
    isSendingAudio = false;
    currentlyPlayingFile = null;
  }

  Future<void> closeRealtime() async {
    await stopMic();
    await _realtime?.close();
    _realtime = null;
    agentReady = false;
    agentConnecting = false;
    transcript = [];
  }

  @override
  void dispose() {
    close();
    super.dispose();
  }
}
