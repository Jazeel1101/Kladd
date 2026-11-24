# Transcription

`TranscriberDarwin` runs `kladd-transcribe` (`packages/platform-darwin/native/Sources/KladdTranscribe`), which uses WhisperKit with Whisper large-v3-turbo (`openai_whisper-large-v3-v20240930_turbo_632MB`).

- **The model** comes from Hugging Face, `argmaxinc/whisperkit-coreml`, and lives in `<userData>/models/openai_whisper-large-v3-v20240930_turbo_632MB` (~630 MB). An interrupted download resumes from `models/.download`. The model counts as there only once `.ready` is written inside its folder.
- **The first load takes minutes**, because CoreML compiles the model for the Mac and caches that by the model's path, so copying or moving the folder costs it again. `prepare` does that load in place, after the download, so the first `transcribe` takes seconds.
- **A separate binary** from `kladd-capture`, so WhisperKit can't slow down or break recording. It needs two files beside it, which `package` copies to `Resources/capture`: `swift-transformers_Hub.bundle`, and `libswiftCompatibilitySpan.dylib`, which macOS 15 lacks and `build.sh` copies from the toolchain.

**Decision:** Kladd transcribes with Whisper large-v3-turbo on the same stack as Hex (WhisperKit, pinned to Hex's version), and downloads the model silently in the background instead of bundling it or asking. Apple's dictation garbled Norwegian, and Apple's newer `SpeechTranscriber` has no Norwegian, so a model download is the price of a usable Norwegian transcript.
