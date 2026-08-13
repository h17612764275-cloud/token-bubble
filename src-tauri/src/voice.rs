use cpal::{traits::{DeviceTrait, HostTrait, StreamTrait}, SampleFormat};
use serde::Serialize;
use sherpa_onnx::{OfflinePunctuation, OfflinePunctuationConfig, OnlineRecognizer, OnlineRecognizerConfig};
use std::{path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceEvent {
    status: &'static str,
    level: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    partial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

pub struct VoiceManager {
    running: Arc<AtomicBool>,
    model_dir: PathBuf,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

struct VoiceActivity {
    active: bool,
    last_voice_at: Instant,
    noise_floor: f32,
    sensitivity: f32,
}

struct SilenceEndpoint {
    last_voice_at: Option<Instant>,
    silence: Duration,
}

impl SilenceEndpoint {
    fn new(seconds: f32) -> Self {
        Self {
            last_voice_at: None,
            silence: Duration::from_secs_f32(seconds.clamp(1.0, 8.0)),
        }
    }

    fn update(&mut self, voice_detected: bool, now: Instant) -> bool {
        if voice_detected {
            self.last_voice_at = Some(now);
            return false;
        }
        if self.last_voice_at.is_some_and(|last| now.duration_since(last) >= self.silence) {
            self.last_voice_at = None;
            return true;
        }
        false
    }
}

impl VoiceActivity {
    fn new(now: Instant, sensitivity: f32) -> Self {
        Self { active: false, last_voice_at: now, noise_floor: 0.003, sensitivity }
    }

    fn update(&mut self, level: f32, now: Instant) -> bool {
        let detected = self.detects_voice(level);
        if detected {
            self.active = true;
            self.last_voice_at = now;
        } else {
            if !self.active { self.noise_floor = self.noise_floor * 0.95 + level * 0.05; }
            if self.active && now.duration_since(self.last_voice_at) >= Duration::from_millis(700) {
                self.active = false;
            }
        }
        self.active
    }

    fn detects_voice(&self, level: f32) -> bool {
        let sensitivity = self.sensitivity.clamp(0.0, 100.0) / 100.0;
        let threshold = (self.noise_floor * (4.2 - 2.4 * sensitivity)).max(0.012 - 0.007 * sensitivity);
        level >= threshold
    }
}

fn select_text_target(captured: usize, current: usize, before_first_partial: bool) -> usize {
    if before_first_partial && is_text_target_usable(current) {
        current
    } else if is_text_target_usable(captured) {
        captured
    } else if is_text_target_usable(current) {
        current
    } else {
        0
    }
}

#[cfg(windows)]
fn is_text_target_usable(target: usize) -> bool {
    external_window(target)
}

#[cfg(not(windows))]
fn is_text_target_usable(_target: usize) -> bool {
    true
}

impl VoiceManager {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { running: Arc::new(AtomicBool::new(false)), model_dir, worker: Mutex::new(None) }
    }

    pub fn start(&self, app: AppHandle, target: usize, input_device: Option<String>, sensitivity: f32, endpoint_seconds: f32, punctuation_enabled: bool) -> Result<bool, String> {
        let mut worker = self.worker.lock().map_err(|_| "voice worker unavailable".to_string())?;
        if self.running.load(Ordering::Acquire) { return Ok(false); }
        if let Some(handle) = worker.take() { let _ = handle.join(); }
        self.running.store(true, Ordering::Release);
        let running = Arc::clone(&self.running);
        let model_dir = self.model_dir.clone();
        *worker = Some(thread::spawn(move || {
            let result = run_voice(app.clone(), model_dir, Arc::clone(&running), target, input_device, sensitivity, endpoint_seconds, punctuation_enabled);
            running.store(false, Ordering::Release);
            match result {
                Ok(()) => emit(&app, "disabled", 0.0, None, None, None),
                Err(message) => emit(&app, "error", 0.0, None, None, Some(message)),
            }
        }));
        Ok(true)
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Release);
    }

}

fn emit(app: &AppHandle, status: &'static str, level: f32, partial: Option<String>, final_text: Option<String>, message: Option<String>) {
    let _ = app.emit("voice-event", VoiceEvent { status, level, partial, final_text, message });
}

fn recognizer(model_dir: &PathBuf) -> Result<OnlineRecognizer, String> {
    let files = ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"];
    if let Some(missing) = files.iter().find(|name| !model_dir.join(name).is_file()) {
        return Err(format!("missing ASR model file: {missing}"));
    }
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.paraformer.encoder = Some(model_dir.join(files[0]).to_string_lossy().into_owned());
    config.model_config.paraformer.decoder = Some(model_dir.join(files[1]).to_string_lossy().into_owned());
    config.model_config.tokens = Some(model_dir.join(files[2]).to_string_lossy().into_owned());
    config.model_config.num_threads = 2;
    config.model_config.provider = Some("cpu".into());
    config.enable_endpoint = false;
    config.decoding_method = Some("greedy_search".into());
    OnlineRecognizer::create(&config).ok_or_else(|| "local ASR model init failed".to_string())
}

fn punctuator(model_dir: &PathBuf) -> Result<OfflinePunctuation, String> {
    let model = model_dir.parent().unwrap_or(model_dir).join("punctuation").join("model.int8.onnx");
    if !model.is_file() { return Err("missing punctuation model: model.int8.onnx".into()); }
    let mut config = OfflinePunctuationConfig::default();
    config.model.ct_transformer = Some(model.to_string_lossy().into_owned());
    config.model.num_threads = 1;
    OfflinePunctuation::create(&config).ok_or_else(|| "local punctuation model init failed".to_string())
}

fn optional_punctuator(model_dir: &PathBuf, enabled: bool) -> Result<Option<OfflinePunctuation>, String> {
    if enabled { punctuator(model_dir).map(Some) } else { Ok(None) }
}

fn restore_punctuation(punctuator: &OfflinePunctuation, text: &str) -> String {
    punctuator.add_punctuation(text).unwrap_or_else(|| text.to_string()).trim().to_string()
}

fn finalize_text(punctuator: Option<&OfflinePunctuation>, text: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        String::new()
    } else if let Some(punctuator) = punctuator {
        restore_punctuation(punctuator, text)
    } else {
        format!("{text} ")
    }
}

fn prefer_complete_endpoint_text(partial: &str, endpoint: &str) -> String {
    let partial = partial.trim();
    let endpoint = endpoint.trim();
    if endpoint.is_empty() || (partial.starts_with(endpoint) && partial.chars().count() > endpoint.chars().count()) {
        partial.to_string()
    } else {
        endpoint.to_string()
    }
}

pub fn input_device_names() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let mut names = host
        .input_devices()
        .map_err(|error| format!("failed to enumerate audio input devices: {error}"))?
        .filter_map(|device| device.name().ok())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    Ok(names)
}

fn run_voice(app: AppHandle, model_dir: PathBuf, running: Arc<AtomicBool>, mut target: usize, input_device: Option<String>, sensitivity: f32, endpoint_seconds: f32, punctuation_enabled: bool) -> Result<(), String> {
    let recognizer = recognizer(&model_dir)?;
    let punctuator = optional_punctuator(&model_dir, punctuation_enabled)?;
    let online_stream = recognizer.create_stream();
    let host = cpal::default_host();
    let device = if let Some(name) = input_device.as_deref() {
        host.input_devices()
            .map_err(|error| format!("failed to enumerate audio input devices: {error}"))?
            .find(|device| device.name().ok().as_deref() == Some(name))
            .ok_or_else(|| format!("selected input device not found: {name}"))?
    } else {
        host.default_input_device().ok_or_else(|| "鏈壘鍒扮郴缁熼粯璁ら害鍏嬮".to_string())?
    };
    let supported = device.default_input_config().map_err(|error| format!("failed to read input device config: {error}"))?;
    let sample_rate = supported.sample_rate().0 as i32;
    let channels = supported.channels() as usize;
    let config = supported.config();
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let error_app = app.clone();
    let error_callback = move |error| emit(&error_app, "error", 0.0, None, None, Some(format!("audio capture failed: {error}")));
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(&config, move |data: &[f32], _| {
            let _ = tx.send(to_mono(data, channels, |value| value));
        }, error_callback, None),
        SampleFormat::I16 => device.build_input_stream(&config, move |data: &[i16], _| {
            let _ = tx.send(to_mono(data, channels, |value| value as f32 / i16::MAX as f32));
        }, error_callback, None),
        SampleFormat::U16 => device.build_input_stream(&config, move |data: &[u16], _| {
            let _ = tx.send(to_mono(data, channels, |value| (value as f32 - 32768.0) / 32768.0));
        }, error_callback, None),
        other => return Err(format!("unsupported sample format: {other:?}")),
    }.map_err(|error| format!("failed to start audio stream: {error}"))?;

    stream.play().map_err(|error| format!("failed to start capture stream: {error}"))?;
    emit(&app, "standby", 0.0, None, None, None);
    let mut last_partial = String::new();
    let mut last_level_at = Instant::now() - Duration::from_secs(1);
    let mut activity = VoiceActivity::new(Instant::now(), sensitivity);
    let mut endpoint = SilenceEndpoint::new(endpoint_seconds);
    let mut visual_active = false;
    let mut last_input_error = (String::new(), Instant::now() - Duration::from_secs(10));

    while running.load(Ordering::Acquire) {
        let samples = match rx.recv_timeout(Duration::from_millis(80)) {
            Ok(value) => value,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        let now = Instant::now();
        let level = (samples.iter().map(|value| value * value).sum::<f32>() / samples.len().max(1) as f32).sqrt();
        let voice_detected = activity.detects_voice(level);
        let active = activity.update(level, now);
        if last_level_at.elapsed() >= Duration::from_millis(55) {
            if active {
                emit(&app, "listening", (level * 8.0).clamp(0.0, 1.0), None, None, None);
            } else if visual_active {
                emit(&app, "standby", 0.0, None, None, None);
            }
            visual_active = active;
            last_level_at = Instant::now();
        }
        online_stream.accept_waveform(sample_rate, &samples);
        while recognizer.is_ready(&online_stream) {
            recognizer.decode(&online_stream);
            if let Some(result) = recognizer.get_result(&online_stream) {
                let text = result.text.trim().to_string();
                if text != last_partial {
                    target = select_text_target(target, active_external_window(), last_partial.is_empty());
                    if let Err(message) = replace_partial(target, &last_partial, &text) {
                        let now = Instant::now();
                        if last_input_error.0 != message && now.duration_since(last_input_error.1) >= Duration::from_secs(2) {
                            emit(&app, "error", 0.0, None, None, Some(format!("语音输入暂未插入：{message}")));
                            last_input_error = (message, now);
                        }
                    } else {
                        emit(&app, "recognizing", 0.0, Some(text.clone()), None, None);
                        last_input_error.0.clear();
                    }
                    last_partial = text;
                }
            }
        }
        let endpoint_due = if voice_detected {
            endpoint.update(true, now);
            false
        } else if !last_partial.is_empty() {
            endpoint.update(false, now)
        } else {
            false
        };
        if endpoint_due {
            online_stream.set_option("is_final", "1");
            while recognizer.is_ready(&online_stream) { recognizer.decode(&online_stream); }
            let endpoint_text = recognizer.get_result(&online_stream)
                .map(|result| result.text)
                .unwrap_or_default();
            let final_text = finalize_text(
                punctuator.as_ref(),
                &prefer_complete_endpoint_text(&last_partial, &endpoint_text),
            );
            if final_text != last_partial {
                target = select_text_target(target, active_external_window(), last_partial.is_empty());
                if let Err(message) = replace_partial(target, &last_partial, &final_text) {
                    let now = Instant::now();
                        if last_input_error.0 != message && now.duration_since(last_input_error.1) >= Duration::from_secs(2) {
                emit(&app, "error", 0.0, None, None, Some(format!("speech submit failed: {message}")));
                            last_input_error = (message, now);
                        }
                } else {
                    last_input_error.0.clear();
                    emit(&app, "standby", 0.0, None, Some(final_text), None);
                    last_partial.clear();
                }
            }
            recognizer.reset(&online_stream);
            online_stream.set_option("is_final", "0");
        }
    }
    while let Ok(samples) = rx.try_recv() {
        online_stream.accept_waveform(sample_rate, &samples);
        while recognizer.is_ready(&online_stream) { recognizer.decode(&online_stream); }
    }
    online_stream.input_finished();
    while recognizer.is_ready(&online_stream) { recognizer.decode(&online_stream); }
    if let Some(result) = recognizer.get_result(&online_stream) {
        let text = finalize_text(
            punctuator.as_ref(),
            &prefer_complete_endpoint_text(&last_partial, result.text.trim()),
        );
        if text != last_partial {
            target = select_text_target(target, active_external_window(), last_partial.is_empty());
            if let Err(message) = replace_partial(target, &last_partial, &text) {
                emit(&app, "error", 0.0, None, None, Some(format!("final insert failed: {message}")));
            } else {
                emit(&app, "standby", 0.0, None, Some(text), None);
            }
        }
    }
    Ok(())
}

fn to_mono<T: Copy>(data: &[T], channels: usize, convert: impl Fn(T) -> f32) -> Vec<f32> {
    data.chunks(channels.max(1)).map(|frame| frame.iter().copied().map(&convert).sum::<f32>() / frame.len() as f32).collect()
}

#[cfg(windows)]
fn foreground_window() -> usize {
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as usize }
}

#[cfg(windows)]
fn external_window(window: usize) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindowVisible};
    if window == 0 { return false; }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window as _, &mut process_id); }
    process_id != std::process::id() && unsafe { IsWindowVisible(window as _) } != 0
}

#[cfg(windows)]
fn active_external_window() -> usize {
    let window = foreground_window();
    if external_window(window) { window } else { 0 }
}

#[cfg(windows)]
pub fn preferred_text_target() -> usize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindow, GW_HWNDNEXT};
    let mut window = foreground_window();
    for _ in 0..64 {
        if external_window(window) { return window; }
        window = unsafe { GetWindow(window as _, GW_HWNDNEXT) } as usize;
        if window == 0 { break; }
    }
    0
}

#[cfg(windows)]
pub fn focus_text_target(target: usize) {
    if target != 0 {
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow(target as _); }
    }
}

#[cfg(not(windows))]
fn foreground_window() -> usize { 1 }

#[cfg(not(windows))]
fn active_external_window() -> usize { foreground_window() }

#[cfg(not(windows))]
pub fn preferred_text_target() -> usize { foreground_window() }

#[cfg(not(windows))]
pub fn focus_text_target(_target: usize) {}

#[cfg(windows)]
fn replace_partial(target: usize, previous: &str, next: &str) -> Result<(), String> {
    let target = if is_text_target_usable(target) {
        target
    } else {
        let mut fallback = active_external_window();
        if fallback == 0 {
            fallback = preferred_text_target();
        }
        if fallback == 0 {
            return Err("娌℃湁鍙緭鍏ユ枃瀛楃殑鍓嶅彴绐楀彛".into());
        }
        fallback
    };
    let common = previous.chars().zip(next.chars()).take_while(|(left, right)| left == right).count();
    let focus = focused_window(target);
    match text_delivery_kind(&format!("{} {}", window_class_name(target), window_class_name(focus))) {
        TextDeliveryKind::SendInput => {
            send_backspaces(previous.chars().count() - common)?;
            send_unicode(&next.chars().skip(common).collect::<String>())
        }
        TextDeliveryKind::WindowMessage => {
            send_message_backspaces(focus, previous.chars().count() - common)?;
            send_message_unicode(focus, &next.chars().skip(common).collect::<String>())
        }
    }
}

#[cfg(not(windows))]
fn replace_partial(_target: usize, _previous: &str, _next: &str) -> Result<(), String> {
    Err("璺ㄥ簲鐢ㄨ闊宠緭鍏ョ洰鍓嶄粎鏀寔 Windows".into())
}

#[cfg(windows)]
fn send_backspaces(count: usize) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_BACK};
    for _ in 0..count {
        let mut inputs = [
            INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_BACK as u16, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
            INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_BACK as u16, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
        ];
        if unsafe { SendInput(inputs.len() as u32, inputs.as_mut_ptr(), size_of::<INPUT>() as i32) } != inputs.len() as u32 {
            return Err("Failed to delete text in target app".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn send_unicode(text: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE};
    for unit in text.encode_utf16() {
        let mut inputs = [
            INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: unit, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 } } },
            INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: unit, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
        ];
        if unsafe { SendInput(inputs.len() as u32, inputs.as_mut_ptr(), size_of::<INPUT>() as i32) } != inputs.len() as u32 {
            return Err("Failed to input text in target app".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum TextDeliveryKind {
    SendInput,
    WindowMessage,
}

#[cfg(windows)]
fn text_delivery_kind(class_name: &str) -> TextDeliveryKind {
    if class_name.split_whitespace().any(|name| name.starts_with("Chrome_")) {
        TextDeliveryKind::WindowMessage
    } else {
        TextDeliveryKind::SendInput
    }
}

#[cfg(windows)]
fn focused_window(target: usize) -> usize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO};
    let thread_id = unsafe { GetWindowThreadProcessId(target as _, std::ptr::null_mut()) };
    let mut info: GUITHREADINFO = unsafe { std::mem::zeroed() };
    info.cbSize = size_of::<GUITHREADINFO>() as u32;
    if thread_id != 0 && unsafe { GetGUIThreadInfo(thread_id, &mut info) } != 0 && !info.hwndFocus.is_null() {
        info.hwndFocus as usize
    } else {
        target
    }
}

#[cfg(windows)]
fn window_class_name(window: usize) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buffer = [0u16; 128];
    let length = unsafe { GetClassNameW(window as _, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

#[cfg(windows)]
fn send_window_message(window: usize, message: u32, wparam: usize, lparam: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, SMTO_ABORTIFHUNG};
    let mut result = 0;
    if unsafe { SendMessageTimeoutW(window as _, message, wparam, lparam, SMTO_ABORTIFHUNG, 250, &mut result) } == 0 {
        Err("褰撳墠搴旂敤娌℃湁鎺ユ敹璇煶杈撳叆鏂囧瓧".into())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn send_message_backspaces(window: usize, count: usize) -> Result<(), String> {
    use windows_sys::Win32::UI::{Input::KeyboardAndMouse::VK_BACK, WindowsAndMessaging::{WM_KEYDOWN, WM_KEYUP}};
    for _ in 0..count {
        send_window_message(window, WM_KEYDOWN, VK_BACK as usize, 1 | (0x0e << 16))?;
        send_window_message(window, WM_KEYUP, VK_BACK as usize, 1 | (0x0e << 16) | (1 << 30) | (1u32 << 31) as isize)?;
    }
    Ok(())
}

#[cfg(windows)]
fn send_message_unicode(window: usize, text: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::WM_CHAR;
    for unit in text.encode_utf16() {
        send_window_message(window, WM_CHAR, unit as usize, 1)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_text, optional_punctuator, prefer_complete_endpoint_text, punctuator, recognizer, restore_punctuation,
        select_text_target, SilenceEndpoint, VoiceActivity,
    };
    #[cfg(windows)]
    use super::{text_delivery_kind, TextDeliveryKind};
    use sherpa_onnx::Wave;
    use std::{env, path::PathBuf, time::{Duration, Instant}};

    #[test]
    fn partial_replacement_keeps_the_longest_common_prefix() {
        let previous = "hello world";
        let next = "hello coding";
        let common = previous.chars().zip(next.chars()).take_while(|(a, b)| a == b).count();
        assert_eq!(common, 6);
        assert_eq!(previous.chars().count() - common, 5);
        assert_eq!(next.chars().skip(common).collect::<String>(), "coding");
    }

    #[test]
    fn endpoint_does_not_delete_a_recognized_tail_character() {
        assert_eq!(
            prefer_complete_endpoint_text("voice input", "voice in"),
            "voice input"
        );
        assert_eq!(
            prefer_complete_endpoint_text("hello coding", "hello code"),
            "hello code"
        );
    }

    #[test]
    fn voice_activity_stays_idle_for_silence_and_releases_after_speech() {
        let start = Instant::now();
        let mut activity = VoiceActivity::new(start, 65.0);
        assert!(!activity.update(0.002, start + Duration::from_millis(100)));
        assert!(activity.update(0.04, start + Duration::from_millis(200)));
        assert!(activity.update(0.002, start + Duration::from_millis(600)));
        assert!(!activity.update(0.002, start + Duration::from_millis(1_100)));
    }

    #[test]
    fn higher_voice_sensitivity_triggers_on_quieter_speech() {
        let start = Instant::now();
        let mut low = VoiceActivity::new(start, 0.0);
        let mut high = VoiceActivity::new(start, 100.0);

        assert!(!low.update(0.006, start + Duration::from_millis(100)));
        assert!(high.update(0.006, start + Duration::from_millis(100)));
    }

    #[test]
    fn silence_endpoint_waits_for_the_configured_gap_and_resets_on_speech() {
        let start = Instant::now();
        let mut endpoint = SilenceEndpoint::new(3.0);

        assert!(!endpoint.update(true, start));
        assert!(!endpoint.update(false, start + Duration::from_millis(2_999)));
        assert!(!endpoint.update(true, start + Duration::from_millis(3_000)));
        assert!(!endpoint.update(false, start + Duration::from_millis(5_999)));
        assert!(endpoint.update(false, start + Duration::from_millis(6_000)));
        assert!(!endpoint.update(false, start + Duration::from_millis(7_000)));
    }

    #[test]
    fn disabled_punctuation_appends_exactly_one_space() {
        assert_eq!(finalize_text(None, "hello world"), "hello world ");
        assert_eq!(finalize_text(None, "hello world "), "hello world ");
        assert_eq!(finalize_text(None, "   "), "");
    }

    #[test]
    fn disabled_punctuation_does_not_touch_the_model_files() {
        let missing_model_dir = PathBuf::from("this-directory-does-not-exist");
        assert!(optional_punctuator(&missing_model_dir, false).unwrap().is_none());
    }

    #[test]
    fn bundled_model_restores_chinese_punctuation() {
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("asr");
        let punctuation = punctuator(&model_dir).expect("create bundled punctuation model");
        let output = restore_punctuation(&punctuation, "hello world");
        assert!(!output.is_empty(), "unexpected punctuation output: {output}");
        let tail_output = restore_punctuation(&punctuation, "hello");
        assert!(tail_output.starts_with("hello"), "punctuation deleted the tail character: {tail_output}");
    }

    #[test]
    fn text_target_can_change_before_the_first_partial_only() {
        #[cfg(not(windows))]
        {
            assert_eq!(select_text_target(100, 200, true), 200);
            assert_eq!(select_text_target(100, 200, false), 100);
        }
        #[cfg(windows)]
        {
            assert_eq!(select_text_target(0, 0, true), 0);
            assert_eq!(select_text_target(0, 0, false), 0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn chromium_targets_use_window_messages() {
        assert_eq!(text_delivery_kind("Chrome_WidgetWin_1"), TextDeliveryKind::WindowMessage);
        assert_eq!(text_delivery_kind("Chrome_RenderWidgetHostHWND"), TextDeliveryKind::WindowMessage);
        assert_eq!(text_delivery_kind("Edit"), TextDeliveryKind::SendInput);
    }

    #[test]
    #[ignore = "set TOKEN_BUBBLE_ASR_MODEL and TOKEN_BUBBLE_ASR_WAV to run the bundled-model check"]
    fn bundled_model_emits_streaming_partials() {
        let model_dir = PathBuf::from(env::var_os("TOKEN_BUBBLE_ASR_MODEL").expect("TOKEN_BUBBLE_ASR_MODEL"));
        let wav_path = env::var("TOKEN_BUBBLE_ASR_WAV").expect("TOKEN_BUBBLE_ASR_WAV");
        let recognizer = recognizer(&model_dir).expect("create recognizer");
        let stream = recognizer.create_stream();
        let wave = Wave::read(&wav_path).expect("read wav");
        let chunk_size = (wave.sample_rate() as usize / 10).max(1);
        let mut partials = Vec::new();
        let mut previous = String::new();

        for chunk in wave.samples().chunks(chunk_size) {
            stream.accept_waveform(wave.sample_rate(), chunk);
            while recognizer.is_ready(&stream) { recognizer.decode(&stream); }
            if let Some(result) = recognizer.get_result(&stream) {
                let text = result.text.trim().to_string();
                if !text.is_empty() && text != previous {
                    previous = text.clone();
                    partials.push(text);
                }
            }
        }
        stream.input_finished();
        while recognizer.is_ready(&stream) { recognizer.decode(&stream); }
        let final_text = recognizer.get_result(&stream).map(|result| result.text).unwrap_or_default();

        assert!(partials.len() >= 2, "expected streaming partials, got {partials:?}");
        assert!(!final_text.trim().is_empty(), "expected a final transcript");
        eprintln!("partials={partials:?}\nfinal={final_text}");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "creates a short-lived foreground edit window to verify SendInput"]
    fn windows_unicode_input_reaches_foreground_edit() {
        use super::{foreground_window, replace_partial};
        use std::{ptr::{null, null_mut}, time::Duration};
        use windows_sys::Win32::UI::{
            Input::KeyboardAndMouse::SetFocus,
            WindowsAndMessaging::{CreateWindowExW, DestroyWindow, DispatchMessageW, GetWindowTextLengthW, GetWindowTextW, PeekMessageW, SetForegroundWindow, ShowWindow, TranslateMessage, MSG, PM_REMOVE, SW_SHOW, WS_OVERLAPPEDWINDOW, WS_VISIBLE},
        };

        let class = "EDIT\0".encode_utf16().collect::<Vec<_>>();
        let title = "\0".encode_utf16().collect::<Vec<_>>();
        let hwnd = unsafe { CreateWindowExW(0, class.as_ptr(), title.as_ptr(), WS_OVERLAPPEDWINDOW | WS_VISIBLE, 120, 120, 360, 120, null_mut(), null_mut(), null_mut(), null()) };
        assert!(!hwnd.is_null(), "create edit window");
        unsafe {
            ShowWindow(hwnd, SW_SHOW);
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
        }
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(foreground_window(), hwnd as usize, "test edit must be foreground");

        replace_partial(hwnd as usize, "", "瀹炴椂璇煶杈撳叆").expect("SendInput");
        let deadline = std::time::Instant::now() + Duration::from_millis(150);
        let mut message: MSG = unsafe { std::mem::zeroed() };
        while std::time::Instant::now() < deadline {
            while unsafe { PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) } != 0 {
                unsafe {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let length = unsafe { GetWindowTextLengthW(hwnd) };
        let mut buffer = vec![0u16; length.max(0) as usize + 1];
        unsafe {
            GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            DestroyWindow(hwnd);
        }
        assert_eq!(String::from_utf16_lossy(&buffer[..length.max(0) as usize]), "瀹炴椂璇煶杈撳叆");
    }
}
