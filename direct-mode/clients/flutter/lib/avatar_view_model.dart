import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:spatius_avatarkit/spatius_avatarkit.dart' as ak;

import 'realtime_client.dart';

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

  /// Set by the page so failures and blocked actions surface in the UI
  /// instead of only reaching [errorMessage].
  void Function(ToastMessage)? onToast;

  // --- Conversation ---
  /// Whether the agent socket is being opened, and whether it is ready to be spoken
  /// to. Audio pushed before ready is dropped, which presents as a microphone that
  /// records and is never answered.
  bool agentConnecting = false;
  bool agentReady = false;
  bool micActive = false;

  /// What has been said so far, as (role, text).
  List<(String, String)> transcript = [];

  /// Where the agent socket lives, as the server reported it. The language, the
  /// models and the voice are the server's `.env` — all three are fixed when it
  /// builds the agent session, so none of them is a client setting.
  String realtimeUrl = '';

  // --- Private ---
  ak.AvatarController? _controller;

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
    _controller?.interrupt();
  }

  // --- Conversation ---

  /// Open the agent socket, once per session.
  ///
  /// Opening the microphone is what brings it up: an agent costs a model session,
  /// so it is not started before there is something to say to it.
  Future<void> _ensureAgent() async {
    if (agentReady || agentConnecting || realtimeUrl.isEmpty) return;
    agentConnecting = true;
    notifyListeners();

    final client = RealtimeClient(
      // Direct Mode drives from here: what the agent returns is plain PCM, fed to
      // the controller exactly as any other PCM16 source would be.
      onAudio: (pcm) async {
        // send(), not yieldAudioData(): that one is Backend Mode's, for audio the
        // server has already driven. Direct Mode drives from here, so the agent's
        // reply goes through send() like any other PCM16 source — `end` stays
        // false, since a turn is many of these and turn_end closes it.
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
      // No settings travel with it: the language, the models and the voice are the
      // server's, fixed when it builds the agent session.
      await client.connect(realtimeUrl);
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

  /// Have the agent speak a typed line — a way to try it without a microphone.
  Future<void> sendText(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    await _ensureAgent();
    _realtime?.sendText(trimmed);
  }

  void close() {
    _controller?.close();
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
