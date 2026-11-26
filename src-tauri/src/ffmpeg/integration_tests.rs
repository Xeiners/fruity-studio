//! Tests d'integration du rendu avec un vrai FFmpeg.
//! Executes seulement si `FRUITY_TEST_FFMPEG_DIR` pointe vers un dossier
//! contenant ffmpeg(.exe) et ffprobe(.exe) ; sinon ils sont ignores (succes).

use std::path::{Path, PathBuf};

use super::probe::probe;
use super::render::{self, JobHandle, RenderInput, RenderOptions, Strategy};
use super::{command, detect, extract_thumbnail};

fn tools() -> Option<(PathBuf, PathBuf)> {
    let dir = PathBuf::from(std::env::var_os("FRUITY_TEST_FFMPEG_DIR")?);
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let ffmpeg = dir.join(format!("ffmpeg{ext}"));
    let ffprobe = dir.join(format!("ffprobe{ext}"));
    (ffmpeg.is_file() && ffprobe.is_file()).then_some((ffmpeg, ffprobe))
}

/// Genere un clip synthetique (mire + bip) avec les caracteristiques voulues.
fn synth(ffmpeg: &Path, out: &Path, w: u32, h: u32, fps: u32, secs: u32, audio: Option<(u32, u32)>) {
    let mut cmd = command(ffmpeg);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc2=size={w}x{h}:rate={fps}:duration={secs}"));
    if let Some((rate, channels)) = audio {
        cmd.args(["-f", "lavfi", "-i"])
            .arg(format!("sine=frequency=440:sample_rate={rate}:duration={secs}"))
            .args(["-ac", &channels.to_string(), "-c:a", "aac", "-b:a", "128k"]);
    }
    cmd.args(["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-shortest"]).arg(out);
    let status = cmd.status().expect("ffmpeg lance");
    assert!(status.success(), "generation du clip de test {}", out.display());
}

fn input(ffprobe: &Path, path: PathBuf) -> RenderInput {
    let probe = probe(ffprobe, &path).expect("probe");
    RenderInput { path, probe }
}

fn run_plan(ffmpeg: &Path, plan: &render::RenderPlan, list: &Path) -> f64 {
    if let Some(content) = &plan.concat_list {
        std::fs::write(list, content).unwrap();
    }
    let mut last = 0.0;
    render::run(ffmpeg, &plan.args, &JobHandle::default(), |s| last = s).expect("rendu ffmpeg");
    last
}

#[test]
fn detects_ffmpeg_from_custom_dir() {
    let Some((ffmpeg, _)) = tools() else { return };
    let info = detect(Some(ffmpeg.parent().unwrap().to_str().unwrap()), None);
    assert!(info.found, "{info:?}");
    assert_eq!(info.source.as_deref(), Some("custom"));
    assert!(info.h264_encoder.is_some());
    assert!(info.has_aac);
}

#[test]
fn reencode_normalizes_mixed_inputs_with_transitions() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("clip 1 (vertical).mp4");
    let b = dir.path().join("clip'2.mp4");
    let c = dir.path().join("clip3_paysage.mp4");
    synth(&ffmpeg, &a, 1080, 1920, 30, 3, Some((48000, 2)));
    synth(&ffmpeg, &b, 720, 1280, 25, 3, Some((44100, 1)));
    synth(&ffmpeg, &c, 1920, 1080, 24, 3, None);
    let inputs = vec![input(&ffprobe, a), input(&ffprobe, b), input(&ffprobe, c)];

    let opts = RenderOptions { transition: "fade".into(), transition_duration: 0.4, ..Default::default() };
    let out = dir.path().join("final.mp4");
    let plan = render::plan(&inputs, None, &opts, "libx264", &out, &dir.path().join("list.txt"), false);
    assert_eq!(plan.strategy, Strategy::Reencode);
    let progressed = run_plan(&ffmpeg, &plan, &dir.path().join("list.txt"));
    assert!(progressed > 1.0, "progression recue");

    let result = probe(&ffprobe, &out).unwrap();
    assert_eq!(result.width, Some(1080));
    assert_eq!(result.height, Some(1920));
    assert_eq!(result.video_codec.as_deref(), Some("h264"));
    assert_eq!(result.audio_codec.as_deref(), Some("aac"));
    assert_eq!(result.channels, Some(2));
    assert!((result.fps.unwrap() - 30.0).abs() < 0.05, "fps {:?}", result.fps);
    assert!((result.duration - 8.2).abs() < 0.35, "duree {}", result.duration);

    let thumb = dir.path().join("thumb.jpg");
    extract_thumbnail(&ffmpeg, &out, &thumb, 1.0).unwrap();
    assert!(thumb.is_file());
}

#[test]
fn compatible_inputs_are_concatenated_without_video_reencode() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.mp4");
    let b = dir.path().join("b.mp4");
    synth(&ffmpeg, &a, 1080, 1920, 30, 2, Some((48000, 2)));
    synth(&ffmpeg, &b, 1080, 1920, 30, 2, Some((48000, 2)));
    let inputs = vec![input(&ffprobe, a), input(&ffprobe, b)];
    let out = dir.path().join("final.mp4");
    let list = dir.path().join("list.txt");
    let plan = render::plan(&inputs, None, &RenderOptions::default(), "libx264", &out, &list, false);
    assert_eq!(plan.strategy, Strategy::Copy);
    run_plan(&ffmpeg, &plan, &list);
    let result = probe(&ffprobe, &out).unwrap();
    assert!((result.duration - 4.0).abs() < 0.3, "duree {}", result.duration);
    assert_eq!(result.width, Some(1080));
    assert!(result.has_audio);
}

#[test]
fn background_music_is_mixed_and_trimmed() {
    let Some((ffmpeg, ffprobe)) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.mp4");
    synth(&ffmpeg, &a, 1080, 1920, 30, 3, Some((48000, 2)));
    let music = dir.path().join("music.m4a");
    let status = command(&ffmpeg)
        .args(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1.3", "-c:a", "aac"])
        .arg(&music)
        .status()
        .unwrap();
    assert!(status.success());
    let inputs = vec![input(&ffprobe, a)];
    let out = dir.path().join("final.mp4");
    let opts = RenderOptions { fit_mode: "fill".into(), ..Default::default() };
    let plan = render::plan(&inputs, Some(&music), &opts, "libx264", &out, &dir.path().join("l.txt"), false);
    run_plan(&ffmpeg, &plan, &dir.path().join("l.txt"));
    let result = probe(&ffprobe, &out).unwrap();
    assert!(result.has_audio);
    assert!((result.duration - 3.0).abs() < 0.3, "la musique bouclee est coupee a la duree video : {}", result.duration);
}

#[test]
fn cancellation_stops_ffmpeg() {
    let Some((ffmpeg, _)) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("long.mp4");
    let job = JobHandle::default();
    let job2 = job.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        job2.cancel();
    });
    let args: Vec<String> = [
        "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-f", "lavfi", "-i",
        "testsrc2=size=1080x1920:rate=30:duration=600", "-c:v", "libx264", "-preset", "veryslow",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain([out.to_string_lossy().to_string()])
    .collect();
    let result = render::run(&ffmpeg, &args, &job, |_| {});
    canceller.join().unwrap();
    assert!(matches!(result, Err(crate::error::AppError::Cancelled(_))), "{result:?}");
}
