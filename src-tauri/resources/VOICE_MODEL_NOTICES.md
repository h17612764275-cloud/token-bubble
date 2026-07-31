# Voice model notices

Token Bubble bundles int8 models for local, offline Chinese-English speech recognition and punctuation restoration.

- Runtime: [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), Apache License 2.0.
- Streaming ASR: `sherpa-onnx-streaming-paraformer-bilingual-zh-en`, converted from ModelScope `speech_paraformer_asr_nat-zh-cn-16k-common-vocab8404-online`, Apache License 2.0.
- Punctuation: `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8`, converted from ModelScope `punc_ct-transformer_zh-cn-common-vocab272727-pytorch`, Apache License 2.0.

The models run on-device. Token Bubble does not upload or retain microphone audio.
