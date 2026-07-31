# Local streaming bilingual speech model

Token Bubble runs this streaming Chinese-English Paraformer int8 model through the Apache-2.0 sherpa-onnx runtime.

Source archive: `sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2`

Downloaded archive SHA-256: `5462A1FCE42693DEAE572AF1E8C4687124B12AA85FE61FF4D3168BB5280E205F`

Verify the upstream model terms before redistributing a public build.

Expected runtime files:

- `encoder.int8.onnx`
- `decoder.int8.onnx`
- `tokens.txt`

Model source: `sherpa-onnx-streaming-paraformer-bilingual-zh-en` from the k2-fsa/sherpa-onnx `asr-models` release.
