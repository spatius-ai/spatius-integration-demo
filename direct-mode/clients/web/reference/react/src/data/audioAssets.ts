/**
 * Shown next to the clip list so nobody reads the bundled files as the limit of
 * what Direct Mode accepts.
 */
export const AUDIO_SOURCE_HINT =
  'These clips are bundled samples, not a limitation. send() takes any PCM16 audio ' +
  'at the configured sample rate — stream it live from a microphone, a TTS service, ' +
  'or your own pipeline the same way. The demo ships files so it runs without extra setup.'

export const PCM_ASSETS = [
  { name: 'Comparison Of Vernacular And Refined Speech', path: '/audio/1 Comparison Of Vernacular And Refined Speech.pcm' },
  { name: 'Simple, Natural Vernacular Speaking', path: '/audio/2 Simple, Natural Vernacular Speakin.pcm' },
  { name: 'Speaking With Projection', path: '/audio/3 Speaking With Projection.pcm' },
  { name: 'Speaking With Line', path: '/audio/4 Speaking With Line.pcm' },
  { name: 'The Downward Sigh', path: '/audio/6 The Downward Sigh.pcm' },
  { name: 'Demo Audio 1', path: '/audio/demo_pcm_audio1.pcm' },
  { name: 'Demo Audio 2', path: '/audio/demo_pcm_audio2.pcm' },
  { name: 'Demo Audio 3', path: '/audio/demo_pcm_audio3.pcm' },
  { name: 'Speech', path: '/audio/speech.pcm' },
  { name: 'Test Resampled', path: '/audio/test_resampled0.pcm' },
]
