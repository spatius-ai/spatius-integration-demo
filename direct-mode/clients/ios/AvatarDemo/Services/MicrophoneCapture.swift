import AVFoundation

/// Microphone capture at the rate the SDK was initialized with.
///
/// PCM16 mono, delivered in small blocks — the agent decides on its own when a turn
/// has ended, so nothing here buffers a whole utterance.
///
/// The tap runs at the hardware's own rate, whatever that is, so a converter sits in
/// between: asking the engine for a different format outright is refused on most
/// devices.
final class MicrophoneCapture {

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetSampleRate: Double

    private(set) var isActive = false

    init(sampleRate: Int = 16000) {
        targetSampleRate = Double(sampleRate)
    }

    func start(onChunk: @escaping (Data) -> Void) throws {
        guard !isActive else { return }

        // .voiceChat asks for the echo-cancelling route, which keeps the avatar's own
        // voice out of the microphone.
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setActive(true)

        let input = engine.inputNode

        // The session mode alone does not switch cancellation on: the AEC lives in the
        // input's IO unit and starts disabled, so without this the microphone picks up
        // whatever the speaker is playing and the agent transcribes the avatar's own
        // reply back to itself. Browsers do this for you — getUserMedia's
        // echoCancellation is on by default — which is why the Web client needs no
        // equivalent.
        //
        // Only the input node. The avatar is played by the SDK's own AVAudioEngine, so
        // enabling processing on this engine's output would cancel against silence —
        // the reference signal it needs is on the other engine entirely. What keeps
        // this working is that the voice-processing IO unit takes its reference from
        // the session's mixed output, which the SDK's playback goes through too.
        //
        // Set before the tap is installed: toggling it reconfigures the node, and the
        // format read below has to be the one that ends up in effect.
        if #available(iOS 13.0, *) {
            try? input.setVoiceProcessingEnabled(true)
        }

        let inputFormat = input.outputFormat(forBus: 0)
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: targetSampleRate,
            channels: 1,
            interleaved: true
        ) else {
            throw NSError(domain: "MicrophoneCapture", code: 0, userInfo: [
                NSLocalizedDescriptionKey: "Could not open the microphone",
            ])
        }
        converter = AVAudioConverter(from: inputFormat, to: outputFormat)

        input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
            guard let self, let converter = self.converter else { return }

            let ratio = outputFormat.sampleRate / inputFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
            guard let out = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }

            var consumed = false
            var error: NSError?
            converter.convert(to: out, error: &error) { _, status in
                // One input buffer per call: handing the same one back would make the
                // converter loop on it forever.
                if consumed {
                    status.pointee = .noDataNow
                    return nil
                }
                consumed = true
                status.pointee = .haveData
                return buffer
            }
            guard error == nil, out.frameLength > 0,
                  let channel = out.int16ChannelData else { return }

            let bytes = Int(out.frameLength) * MemoryLayout<Int16>.size
            onChunk(Data(bytes: channel[0], count: bytes))
        }

        engine.prepare()
        try engine.start()
        isActive = true
    }

    func stop() {
        guard isActive else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // Turned back off with the tap: voice processing stays on the node otherwise,
        // and it keeps the session in its duplex route — which thins out the avatar's
        // voice on the next clip even though nothing is recording.
        if #available(iOS 13.0, *) {
            try? engine.inputNode.setVoiceProcessingEnabled(false)
        }
        converter = nil
        isActive = false
        // Handed back so the avatar's own playback is not stuck in the recording
        // category once the microphone is closed.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
