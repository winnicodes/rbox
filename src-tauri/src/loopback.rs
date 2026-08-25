//! System audio capture, piped into ffmpeg over a local TCP socket.
//!
//! Windows exposes no loopback input ffmpeg can open, which is why this used to
//! need Stereo Mix or VB-Cable installed on every machine. Opening the default
//! *output* device as a capture device makes WASAPI hand back what is playing
//! (cpal sets AUDCLNT_STREAMFLAGS_LOOPBACK for us), so nothing has to be
//! installed on the client. ffmpeg then reads the samples as raw PCM from
//! `tcp://127.0.0.1:PORT`.

use std::collections::VecDeque;
use std::io::Write;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Data, SampleFormat, StreamConfig};
use serde::Serialize;

/// How far behind the wall clock the socket is written. Absorbs callback
/// jitter, so a late buffer still lands in its own slot instead of being
/// overwritten with silence.
const LAG: f64 = 0.2;

/// Everything ffmpeg needs to open the stream as an input.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudio {
    port: u16,
    /// ffmpeg demuxer for the raw samples, e.g. "f32le".
    format: &'static str,
    sample_rate: u32,
    channels: u16,
}

/// Holds the stop flag of the running capture, if any.
#[derive(Default)]
pub struct Loopback(Mutex<Option<Arc<AtomicBool>>>);

/// Only formats whose silence is all-zero bytes, because the pacer below pads
/// gaps with zeros. The WASAPI shared-mode mix format is f32 in practice.
fn ffmpeg_format(f: SampleFormat) -> Option<&'static str> {
    match f {
        SampleFormat::F32 => Some("f32le"),
        SampleFormat::I16 => Some("s16le"),
        SampleFormat::I32 => Some("s32le"),
        _ => None,
    }
}

/// Bytes that should have reached ffmpeg after `elapsed`, rounded down to a
/// whole frame so a sample is never split across writes.
fn paced_bytes(elapsed: Duration, byte_rate: usize, frame: usize) -> u64 {
    let secs = elapsed.as_secs_f64() - LAG;
    if secs <= 0.0 {
        return 0;
    }
    let bytes = (secs * byte_rate as f64) as u64;
    bytes - bytes % frame as u64
}

#[tauri::command]
pub fn system_audio_start(state: tauri::State<Loopback>) -> Result<SystemAudio, String> {
    // A previous recording that ended badly must not keep writing.
    stop(&state);

    let device = cpal::default_host()
        .default_output_device()
        .ok_or("no audio output device")?;
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let sample_format = supported.sample_format();
    let format = ffmpeg_format(sample_format)
        .ok_or_else(|| format!("unsupported sample format {sample_format:?}"))?;
    let config = supported.config();
    let channels = config.channels;
    let sample_rate = config.sample_rate;
    let frame = channels as usize * sample_format.sample_size();

    // Port 0 lets the OS pick a free one, so two rbox instances cannot collide.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let flag = Arc::new(AtomicBool::new(false));
    let stop_flag = flag.clone();
    std::thread::spawn(move || {
        // The cpal stream is not Send, so it is built and dropped in here.
        if let Err(e) = pump(listener, device, config, sample_format, frame, &stop_flag) {
            eprintln!("[loopback] {e}");
        }
    });

    *state.0.lock().unwrap() = Some(flag);
    Ok(SystemAudio {
        port,
        format,
        sample_rate,
        channels,
    })
}

#[tauri::command]
pub fn system_audio_stop(state: tauri::State<Loopback>) {
    stop(&state);
}

fn stop(state: &Loopback) {
    if let Some(flag) = state.0.lock().unwrap().take() {
        flag.store(true, Ordering::Relaxed);
    }
}

fn pump(
    listener: TcpListener,
    device: cpal::Device,
    config: StreamConfig,
    sample_format: SampleFormat,
    frame: usize,
    flag: &AtomicBool,
) -> Result<(), String> {
    let byte_rate = config.sample_rate as usize * frame;

    // ffmpeg connects when it opens the input. Bounded, so a recording that
    // never starts cannot leak this thread.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut socket = loop {
        if flag.load(Ordering::Relaxed) {
            return Ok(());
        }
        match listener.accept() {
            Ok((s, _)) => break s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("ffmpeg never connected".into());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    // Windows hands out an accepted socket in the listener's non-blocking mode,
    // where a momentarily full send buffer fails the write instead of waiting —
    // that closed the stream a second in and cut the audio track short. Blocking
    // writes with a timeout keep ffmpeg fed and still let go if it dies.
    socket.set_nonblocking(false).map_err(|e| e.to_string())?;
    socket
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    socket.set_nodelay(true).ok();

    let queue: Arc<Mutex<VecDeque<u8>>> = Arc::default();
    let sink = queue.clone();
    // Two seconds of slack. Past that ffmpeg is not keeping up and the oldest
    // audio is worth less than bounded memory.
    let max = byte_rate * 2;
    let stream = device
        .build_input_stream_raw(
            config,
            sample_format,
            move |data: &Data, _| {
                let mut q = sink.lock().unwrap();
                q.extend(data.bytes());
                let over = q.len().saturating_sub(max);
                if over > 0 {
                    q.drain(..over);
                }
            },
            |e| eprintln!("[loopback] stream error: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    // WASAPI loopback delivers nothing at all while the output is idle, so
    // writing only what arrives would make the audio track shorter than the
    // video and drift out of sync at the first silent stretch. Pace the socket
    // off the wall clock instead and pad whatever is missing with silence.
    // ponytail: fixed LAG budget; make it adaptive only if a slow machine still
    // drops audio.
    let start = Instant::now();
    let mut written: u64 = 0;
    let mut chunk: Vec<u8> = Vec::new();
    while !flag.load(Ordering::Relaxed) {
        let target = paced_bytes(start.elapsed(), byte_rate, frame);
        if target > written {
            let want = (target - written) as usize;
            {
                let mut q = queue.lock().unwrap();
                let take = want.min(q.len() - q.len() % frame);
                chunk.clear();
                chunk.extend(q.drain(..take));
            }
            let pad = want - chunk.len();
            if socket.write_all(&chunk).is_err() {
                break;
            }
            if pad > 0 && socket.write_all(&vec![0u8; pad]).is_err() {
                break;
            }
            written = target;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacing_lags_the_clock_and_keeps_whole_frames() {
        // 48 kHz stereo f32.
        let (byte_rate, frame) = (48_000 * 8, 8);
        assert_eq!(paced_bytes(Duration::from_millis(100), byte_rate, frame), 0);
        assert_eq!(
            paced_bytes(Duration::from_secs(1), byte_rate, frame),
            (0.8 * byte_rate as f64) as u64
        );
        assert_eq!(
            paced_bytes(Duration::from_micros(1_200_003), byte_rate, frame) % frame as u64,
            0
        );
    }
}
