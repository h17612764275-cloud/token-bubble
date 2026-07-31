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

impl VoiceActivity {
    fn new(now: Instant, sensitivity: f32) -> Self {
        Self { active: false, last_voice_at: now, noise_floor: 0.003, sensitivity }
    }

    fn update(&mut self, level: f32, now: Instant) -> bool {
        let sensitivity = self.sensitivity.clamp(0.0, 100.0) / 100.0;
        let threshold = (self.noise_floor * (4.2 - 2.4 * sensitivity)).max(0.012 - 0.007 * sensitivity);
        if level >= threshold {
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
}

fn select_text_target(captured: usize, current: usize, before_first_partial: bool) -> usize {
    if before_first_partial && current != 0 { current } else { captured }
}

impl VoiceManager {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { running: Arc::new(AtomicBool::new(false)), model_dir, worker: Mutex::new(None) }
    }

    pub fn start(&self, app: AppHandle, target: usize, input_device: Option<String>, sensitivity: f32) -> Result<bool, String> {
        let mut worker = self.worker.lock().map_err(|_| "voice worker unavailable".to_string())?;
        if self.running.load(Ordering::Acquire) { return Ok(false); }
        if let Some(handle) = worker.take() { let _ = handle.join(); }
        self.running.store(true, Ordering::Release);
        let running = Arc::clone(&self.running);
        let model_dir = self.model_dir.clone();
        *worker = Some(thread::spawn(move || {
            let result = run_voice(app.clone(), model_dir, Arc::clone(&running), target, input_device, sensitivity);
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
        return Err(format!("本地语音模型缺少文件：{missing}"));
    }
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.paraformer.encoder = Some(model_dir.join(files[0]).to_string_lossy().into_owned());
    config.model_config.paraformer.decoder = Some(model_dir.join(files[1]).to_string_lossy().into_owned());
    config.model_config.tokens = Some(model_dir.join(files[2]).to_string_lossy().into_owned());
    config.model_config.num_threads = 1;
    config.model_config.provider = Some("cpu".into());
    config.enable_endpoint = true;
    config.rule1_min_trailing_silence = 2.4;
    config.rule2_min_trailing_silence = 1.4;
    config.rule3_min_utterance_length = 20.0;
    config.decoding_method = Some("greedy_search".into());
    OnlineRecognizer::create(&config).ok_or_else(|| "本地语音模型初始化失败".to_string())
}

fn punctuator(model_dir: &PathBuf) -> Result<OfflinePunctuation, String> {
    let model = model_dir.parent().unwrap_or(model_dir).join("punctuation").join("model.int8.onnx");
    if !model.is_file() { return Err("本地标点模型缺少文件：model.int8.onnx".into()); }
    let mut config = OfflinePunctuationConfig::default();
    config.model.ct_transformer = Some(model.to_string_lossy().into_owned());
    config.model.num_threads = 1;
    OfflinePunctuation::create(&config).ok_or_else(|| "本地标点模型初始化失败".to_string())
}

fn restore_punctuation(punctuator: &OfflinePunctuation, text: &str) -> String {
    punctuator.add_punctuation(text).unwrap_or_else(|| text.to_string()).trim().to_string()
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
        .map_err(|error| format!("无法读取语音输入设备：{error}"))?
        .filter_map(|device| device.name().ok())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    Ok(names)
}

fn run_voice(app: AppHandle, model_dir: PathBuf, running: Arc<AtomicBool>, mut target: usize, input_device: Option<String>, sensitivity: f32) -> Result<(), String> {
    let recognizer = recognizer(&model_dir)?;
    let punctuator = punctuator(&model_dir)?;
    let online_stream = recognizer.create_stream();
    let host = cpal::default_host();
    let device = if let Some(name) = input_device.as_deref() {
        host.input_devices()
            .map_err(|error| format!("无法读取语音输入设备：{error}"))?
            .find(|device| device.name().ok().as_deref() == Some(name))
            .ok_or_else(|| format!("语音输入设备不可用：{name}"))?
    } else {
        host.default_input_device().ok_or_else(|| "未找到系统默认麦克风".to_string())?
    };
    let supported = device.default_input_config().map_err(|error| format!("无法读取麦克风配置：{error}"))?;
    let sample_rate = supported.sample_rate().0 as i32;
    let channels = supported.channels() as usize;
    let config = supported.config();
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let error_app = app.clone();
    let error_callback = move |error| emit(&error_app, "error", 0.0, None, None, Some(format!("麦克风错误：{error}")));
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
        other => return Err(format!("不支持的麦克风采样格式：{other:?}")),
    }.map_err(|error| format!("无法启动麦克风：{error}"))?;

    if target == 0 { return Err("没有可输入文字的前台窗口".into()); }
    stream.play().map_err(|error| format!("无法开始录音：{error}"))?;
    emit(&app, "standby", 0.0, None, None, None);
    let mut last_partial = String::new();
    let mut last_level_at = Instant::now() - Duration::from_secs(1);
    let mut activity = VoiceActivity::new(Instant::now(), sensitivity);
    let mut visual_active = false;

    while running.load(Ordering::Acquire) {
        let samples = match rx.recv_timeout(Duration::from_millis(80)) {
            Ok(value) => value,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        if last_level_at.elapsed() >= Duration::from_millis(55) {
            let level = (samples.iter().map(|value| value * value).sum::<f32>() / samples.len().max(1) as f32).sqrt();
            let active = activity.update(level, Instant::now());
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
                    replace_partial(target, &last_partial, &text)?;
                    last_partial = text.clone();
                    emit(&app, "recognizing", 0.0, Some(text), None, None);
                }
            }
        }
        if recognizer.is_endpoint(&online_stream) {
            online_stream.set_option("is_final", "1");
            while recognizer.is_ready(&online_stream) { recognizer.decode(&online_stream); }
            let endpoint_text = recognizer.get_result(&online_stream)
                .map(|result| result.text)
                .unwrap_or_default();
            let final_text = restore_punctuation(
                &punctuator,
                &prefer_complete_endpoint_text(&last_partial, &endpoint_text),
            );
            if final_text != last_partial {
                target = select_text_target(target, active_external_window(), last_partial.is_empty());
                replace_partial(target, &last_partial, &final_text)?;
            }
            if !final_text.is_empty() { emit(&app, "standby", 0.0, None, Some(final_text), None); }
            last_partial.clear();
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
        let text = restore_punctuation(
            &punctuator,
            &prefer_complete_endpoint_text(&last_partial, result.text.trim()),
        );
        if text != last_partial {
            target = select_text_target(target, active_external_window(), last_partial.is_empty());
            replace_partial(target, &last_partial, &text)?;
        }
        if !text.is_empty() { emit(&app, "standby", 0.0, None, Some(text), None); }
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
    if foreground_window() != target { return Err("前台窗口已改变，语音输入已停止".into()); }
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
    Err("跨应用语音输入目前仅支持 Windows".into())
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
            return Err("无法向当前应用修改实时文字".into());
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
            return Err("无法向当前应用输入文字".into());
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
        Err("当前应用没有接收语音输入文字".into())
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
        prefer_complete_endpoint_text, punctuator, recognizer, restore_punctuation,
        select_text_target, VoiceActivity,
    };
    #[cfg(windows)]
    use super::{text_delivery_kind, TextDeliveryKind};
    use sherpa_onnx::Wave;
    use std::{env, path::PathBuf, time::{Duration, Instant}};

    #[test]
    fn partial_replacement_keeps_the_longest_common_prefix() {
        let previous = "今天天气";
        let next = "今天挺好";
        let common = previous.chars().zip(next.chars()).take_while(|(a, b)| a == b).count();
        assert_eq!(common, 2);
        assert_eq!(previous.chars().count() - common, 2);
        assert_eq!(next.chars().skip(common).collect::<String>(), "挺好");
    }

    #[test]
    fn endpoint_does_not_delete_a_recognized_tail_character() {
        assert_eq!(
            prefer_complete_endpoint_text(
                "请帮我回答这个问题",
                "请帮我回答这个问",
            ),
            "请帮我回答这个问题"
        );
        assert_eq!(
            prefer_complete_endpoint_text("今天挺好", "今天真好"),
            "今天真好"
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
    fn bundled_model_restores_chinese_punctuation() {
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("asr");
        let punctuation = punctuator(&model_dir).expect("create bundled punctuation model");
        let output = restore_punctuation(&punctuation, "我们都是木头人不会说话不会动");
        assert!(output.contains('，') && output.ends_with('。'), "unexpected punctuation output: {output}");
        let tail_output = restore_punctuation(&punctuation, "请帮我回答这个问题");
        assert!(tail_output.contains('题'), "punctuation deleted the tail character: {tail_output}");
    }

    #[test]
    fn text_target_can_change_before_the_first_partial_only() {
        assert_eq!(select_text_target(100, 200, true), 200);
        assert_eq!(select_text_target(100, 200, false), 100);
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

        replace_partial(hwnd as usize, "", "实时语音输入").expect("SendInput");
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
        assert_eq!(String::from_utf16_lossy(&buffer[..length.max(0) as usize]), "实时语音输入");
    }
}
