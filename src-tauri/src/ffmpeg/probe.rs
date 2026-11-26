//! Analyse des fichiers media avec ffprobe.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::command;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    /// Duree en secondes (conteneur, sinon flux video).
    pub duration: f64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub pix_fmt: Option<String>,
    pub profile: Option<String>,
    pub time_base: Option<String>,
    pub has_video: bool,
    pub has_audio: bool,
    pub audio_codec: Option<String>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
}

fn parse_rate(raw: Option<&str>) -> Option<f64> {
    let raw = raw?;
    let (num, den) = raw.split_once('/').unwrap_or((raw, "1"));
    let num: f64 = num.trim().parse().ok()?;
    let den: f64 = den.trim().parse().ok()?;
    if num <= 0.0 || den <= 0.0 {
        return None;
    }
    Some(((num / den) * 1000.0).round() / 1000.0)
}

fn as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// Interprete la sortie JSON de `ffprobe -show_format -show_streams`.
pub fn parse_probe_json(json: &Value) -> AppResult<ProbeInfo> {
    let streams = json.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut info = ProbeInfo::default();

    let video = streams.iter().find(|s| {
        s.get("codec_type").and_then(Value::as_str) == Some("video")
            && s.pointer("/disposition/attached_pic").and_then(Value::as_i64).unwrap_or(0) == 0
    });
    if let Some(v) = video {
        info.has_video = true;
        info.width = v.get("width").and_then(Value::as_i64);
        info.height = v.get("height").and_then(Value::as_i64);
        info.video_codec = v.get("codec_name").and_then(Value::as_str).map(str::to_string);
        info.pix_fmt = v.get("pix_fmt").and_then(Value::as_str).map(str::to_string);
        info.profile = v.get("profile").and_then(Value::as_str).map(str::to_string);
        info.time_base = v.get("time_base").and_then(Value::as_str).map(str::to_string);
        info.fps = parse_rate(v.get("avg_frame_rate").and_then(Value::as_str))
            .or_else(|| parse_rate(v.get("r_frame_rate").and_then(Value::as_str)));
    }
    if let Some(a) = streams.iter().find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio")) {
        info.has_audio = true;
        info.audio_codec = a.get("codec_name").and_then(Value::as_str).map(str::to_string);
        info.sample_rate = a.get("sample_rate").and_then(as_f64).map(|v| v as i64);
        info.channels = a.get("channels").and_then(Value::as_i64);
    }

    let format_duration = json.pointer("/format/duration").and_then(as_f64);
    let stream_duration = video.and_then(|v| v.get("duration")).and_then(as_f64);
    info.duration = format_duration.or(stream_duration).unwrap_or(0.0);
    Ok(info)
}

pub fn probe(ffprobe: &Path, file: &Path) -> AppResult<ProbeInfo> {
    let output = command(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(file)
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Ffmpeg(format!(
            "Fichier illisible par ffprobe ({}) : {}",
            file.display(),
            stderr.trim()
        )));
    }
    let json: Value = serde_json::from_slice(&output.stdout)?;
    parse_probe_json(&json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_video_and_audio_streams() {
        let json = json!({
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 720, "height": 1280,
                 "pix_fmt": "yuv420p", "avg_frame_rate": "30000/1001", "r_frame_rate": "30000/1001",
                 "profile": "High", "time_base": "1/30000", "duration": "8.0"},
                {"codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2}
            ],
            "format": {"duration": "8.024"}
        });
        let info = parse_probe_json(&json).unwrap();
        assert_eq!(info.width, Some(720));
        assert_eq!(info.fps, Some(29.97));
        assert!(info.has_audio);
        assert_eq!(info.sample_rate, Some(48000));
        assert!((info.duration - 8.024).abs() < 1e-9);
    }

    #[test]
    fn ignores_cover_art_and_handles_missing_audio() {
        let json = json!({
            "streams": [
                {"codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}},
                {"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920, "avg_frame_rate": "0/0", "r_frame_rate": "25/1"}
            ],
            "format": {}
        });
        let info = parse_probe_json(&json).unwrap();
        assert_eq!(info.video_codec.as_deref(), Some("h264"));
        assert_eq!(info.fps, Some(25.0));
        assert!(!info.has_audio);
    }
}
