//! Assemblage final : construction du plan FFmpeg (fonctions pures, testees)
//! et execution avec suivi de progression et annulation.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::command;
use super::probe::ProbeInfo;
use crate::error::{AppError, AppResult};
use crate::util::path_to_string;

pub const LOUDNORM: &str = "loudnorm=I=-14:LRA=11:TP=-1.5";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RenderOptions {
    pub output_dir: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// "blur" (fond flou), "fill" (recadrage) ou "fit" (bandes noires).
    pub fit_mode: String,
    /// "none" ou un nom de transition xfade (fade, fadeblack, fadewhite, slideup, smoothleft...).
    pub transition: String,
    pub transition_duration: f64,
    pub normalize_audio: bool,
    pub clip_volume: f64,
    pub music_asset_id: Option<String>,
    pub music_volume: f64,
    pub music_ducking: bool,
    pub music_fade_out: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            output_dir: String::new(),
            file_name: String::new(),
            width: 1080,
            height: 1920,
            fps: 30,
            fit_mode: "blur".into(),
            transition: "none".into(),
            transition_duration: 0.4,
            normalize_audio: true,
            clip_volume: 1.0,
            music_asset_id: None,
            music_volume: 0.25,
            music_ducking: true,
            music_fade_out: true,
        }
    }
}

const TRANSITIONS: &[&str] = &[
    "fade", "fadeblack", "fadewhite", "dissolve", "slideup", "slidedown", "slideleft", "slideright",
    "smoothleft", "smoothright", "smoothup", "smoothdown", "circleopen", "wipeleft", "wiperight",
];

impl RenderOptions {
    pub fn validate(&self) -> AppResult<()> {
        if self.width % 2 != 0 || self.height % 2 != 0 || self.width < 240 || self.height < 240 {
            return Err(AppError::validation("Résolution de sortie invalide (dimensions paires requises)."));
        }
        if !(12..=60).contains(&self.fps) {
            return Err(AppError::validation("Fréquence d'images invalide."));
        }
        if !matches!(self.fit_mode.as_str(), "blur" | "fill" | "fit") {
            return Err(AppError::validation("Mode de cadrage inconnu."));
        }
        if self.transition != "none" && !TRANSITIONS.contains(&self.transition.as_str()) {
            return Err(AppError::validation("Transition inconnue."));
        }
        if !(0.0..=4.0).contains(&self.clip_volume) || !(0.0..=2.0).contains(&self.music_volume) {
            return Err(AppError::validation("Volume hors limites."));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct RenderInput {
    pub path: PathBuf,
    pub probe: ProbeInfo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Strategy {
    /// Concatenation sans reencodage video (flux deja conformes).
    Copy,
    /// Normalisation complete (resolution, cadence, audio) puis encodage H.264/AAC.
    Reencode,
}

#[derive(Debug, Clone)]
pub struct RenderPlan {
    pub strategy: Strategy,
    pub args: Vec<String>,
    pub total_duration: f64,
    /// Contenu du fichier de liste pour le demuxer concat (strategie Copy).
    pub concat_list: Option<String>,
}

fn fmt(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    if s.is_empty() || s == "-0" { "0".into() } else { s }
}

fn even(v: u32) -> u32 {
    let v = v.max(2);
    v - (v % 2)
}

/// Les flux sont-ils deja conformes (H.264 yuv420p, bonne resolution/cadence,
/// AAC homogene) pour une concatenation sans reencodage video ?
pub fn can_stream_copy(inputs: &[RenderInput], opts: &RenderOptions, has_music: bool) -> bool {
    if inputs.is_empty() || has_music || opts.transition != "none" || (opts.clip_volume - 1.0).abs() > 1e-6 {
        return false;
    }
    let first = &inputs[0].probe;
    inputs.iter().all(|input| {
        let p = &input.probe;
        p.video_codec.as_deref() == Some("h264")
            && p.pix_fmt.as_deref() == Some("yuv420p")
            && p.width == Some(opts.width as i64)
            && p.height == Some(opts.height as i64)
            && p.fps.is_some_and(|f| (f - opts.fps as f64).abs() < 0.01)
            && p.has_audio
            && p.audio_codec.as_deref() == Some("aac")
            && p.sample_rate == first.sample_rate
            && p.channels == first.channels
            && p.profile == first.profile
            && p.time_base == first.time_base
    })
}

/// Echappe un chemin pour le fichier de liste `ffconcat`.
pub fn concat_entry(path: &Path) -> String {
    let p = path_to_string(path).replace('\\', "/").replace('\'', "'\\''");
    format!("file '{p}'")
}

pub fn effective_transition(inputs: &[RenderInput], opts: &RenderOptions) -> f64 {
    if opts.transition == "none" || inputs.len() < 2 {
        return 0.0;
    }
    let shortest = inputs.iter().map(|i| i.probe.duration).fold(f64::INFINITY, f64::min);
    opts.transition_duration.clamp(0.1, 2.0).min((shortest / 2.0 - 0.05).max(0.0))
}

/// Construit le filtergraph de normalisation + assemblage. Renvoie (graph, duree totale).
pub fn build_filter_graph(inputs: &[RenderInput], opts: &RenderOptions, music_index: Option<usize>) -> (String, f64) {
    let (w, h, f) = (opts.width, opts.height, opts.fps);
    let mut parts: Vec<String> = Vec::new();

    for (i, input) in inputs.iter().enumerate() {
        let d = fmt(input.probe.duration);
        let tail = format!("setsar=1,fps={f},format=yuv420p,trim=duration={d},setpts=PTS-STARTPTS[v{i}]");
        let video = match opts.fit_mode.as_str() {
            "fill" => format!(
                "[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},{tail}"
            ),
            "fit" => format!(
                "[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,\
                 pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,{tail}"
            ),
            _ => {
                // Fond flou calcule en basse resolution (rapide) puis agrandi.
                let (bw, bh) = (even(w / 8), even(h / 8));
                format!(
                    "[{i}:v:0]split=2[bgs{i}][fgs{i}];\
                     [bgs{i}]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},boxblur=6:2,scale={w}:{h}[bg{i}];\
                     [fgs{i}]scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg{i}];\
                     [bg{i}][fg{i}]overlay=(W-w)/2:(H-h)/2,{tail}"
                )
            }
        };
        parts.push(video);

        let audio = if input.probe.has_audio {
            format!(
                "[{i}:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,\
                 volume={},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]",
                fmt(opts.clip_volume)
            )
        } else {
            format!(
                "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={d},\
                 aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]"
            )
        };
        parts.push(audio);
    }

    let n = inputs.len();
    let t = effective_transition(inputs, opts);
    let sum: f64 = inputs.iter().map(|i| i.probe.duration).sum();
    let total = sum - t * (n.saturating_sub(1)) as f64;

    if n == 1 {
        parts.push("[v0]null[vout]".into());
        parts.push("[a0]anull[acat]".into());
    } else if t > 0.0 {
        let mut prev_v = "v0".to_string();
        let mut prev_a = "a0".to_string();
        let mut cumulative = inputs[0].probe.duration;
        for k in 1..n {
            let last = k == n - 1;
            let out_v = if last { "vout".to_string() } else { format!("vx{k}") };
            let out_a = if last { "acat".to_string() } else { format!("ax{k}") };
            let offset = cumulative - t * k as f64;
            parts.push(format!(
                "[{prev_v}][v{k}]xfade=transition={}:duration={}:offset={}[{out_v}]",
                opts.transition,
                fmt(t),
                fmt(offset.max(0.0))
            ));
            parts.push(format!("[{prev_a}][a{k}]acrossfade=d={}:c1=tri:c2=tri[{out_a}]", fmt(t)));
            prev_v = out_v;
            prev_a = out_a;
            cumulative += inputs[k].probe.duration;
        }
    } else {
        let joined: String = (0..n).map(|i| format!("[v{i}][a{i}]")).collect();
        parts.push(format!("{joined}concat=n={n}:v=1:a=1[vout][acat]"));
    }

    let mut audio_label = "acat".to_string();
    if let Some(m) = music_index {
        let mut music = format!(
            "[{m}:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume={},\
             atrim=duration={},asetpts=PTS-STARTPTS,afade=t=in:d=0.5",
            fmt(opts.music_volume),
            fmt(total)
        );
        if opts.music_fade_out && total > 2.5 {
            music.push_str(&format!(",afade=t=out:st={}:d=2", fmt(total - 2.0)));
        }
        music.push_str("[mus]");
        parts.push(music);
        if opts.music_ducking {
            // Le dialogue des clips abaisse automatiquement la musique (sidechain).
            parts.push("[acat]asplit=2[dlg][sc]".into());
            parts.push("[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[musd]".into());
            parts.push("[dlg][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]".into());
        } else {
            parts.push("[acat][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]".into());
        }
        audio_label = "amix".into();
    }

    if opts.normalize_audio {
        parts.push(format!("[{audio_label}]{LOUDNORM},aresample=48000[aout]"));
    } else if music_index.is_some() {
        parts.push(format!("[{audio_label}]alimiter=limit=0.97[aout]"));
    } else {
        parts.push(format!("[{audio_label}]anull[aout]"));
    }

    (parts.join(";"), total)
}

pub fn encoder_args(encoder: &str, fps: u32) -> Vec<String> {
    let mut args: Vec<String> = match encoder {
        "libx264" => vec!["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p"],
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21", "-b:v", "0", "-pix_fmt", "yuv420p"],
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-global_quality", "21", "-pix_fmt", "nv12"],
        "h264_amf" => vec!["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-pix_fmt", "yuv420p"],
        _ => vec!["-c:v", "h264_mf", "-b:v", "12M", "-pix_fmt", "yuv420p"],
    }
    .into_iter()
    .map(String::from)
    .collect();
    args.extend(["-r".to_string(), fps.to_string(), "-g".to_string(), (fps * 2).to_string()]);
    args
}

fn base_args() -> Vec<String> {
    ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
        .into_iter()
        .map(String::from)
        .collect()
}

pub fn plan(
    inputs: &[RenderInput],
    music: Option<&Path>,
    opts: &RenderOptions,
    encoder: &str,
    output: &Path,
    concat_list_path: &Path,
    force_reencode: bool,
) -> RenderPlan {
    let mut args = base_args();
    if !force_reencode && can_stream_copy(inputs, opts, music.is_some()) {
        let list = std::iter::once("ffconcat version 1.0".to_string())
            .chain(inputs.iter().map(|i| concat_entry(&i.path)))
            .collect::<Vec<_>>()
            .join("\n");
        args.extend(["-f", "concat", "-safe", "0", "-i"].map(String::from));
        args.push(path_to_string(concat_list_path));
        args.extend(["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"].map(String::from));
        if opts.normalize_audio {
            args.extend(["-af".to_string(), format!("{LOUDNORM},aresample=48000")]);
            args.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "48000"].map(String::from));
        } else {
            args.extend(["-c:a", "copy"].map(String::from));
        }
        args.extend(["-movflags", "+faststart", "-f", "mp4"].map(String::from));
        args.push(path_to_string(output));
        let total = inputs.iter().map(|i| i.probe.duration).sum();
        return RenderPlan { strategy: Strategy::Copy, args, total_duration: total, concat_list: Some(list) };
    }

    for input in inputs {
        args.push("-i".into());
        args.push(path_to_string(&input.path));
    }
    let music_index = music.map(|m| {
        args.extend(["-stream_loop", "-1", "-i"].map(String::from));
        args.push(path_to_string(m));
        inputs.len()
    });
    let (graph, total) = build_filter_graph(inputs, opts, music_index);
    args.push("-filter_complex".into());
    args.push(graph);
    args.extend(["-map", "[vout]", "-map", "[aout]"].map(String::from));
    args.extend(encoder_args(encoder, opts.fps));
    args.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"].map(String::from));
    args.extend(["-movflags", "+faststart", "-f", "mp4"].map(String::from));
    args.push(path_to_string(output));
    RenderPlan { strategy: Strategy::Reencode, args, total_duration: total, concat_list: None }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/// Poignee d'un rendu en cours (annulation depuis une autre commande).
#[derive(Clone, Default)]
pub struct JobHandle {
    pub child: Arc<Mutex<Option<Child>>>,
    pub cancelled: Arc<AtomicBool>,
}

impl JobHandle {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

pub fn parse_progress_seconds(line: &str) -> Option<f64> {
    let value = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    value.trim().parse::<i64>().ok().filter(|v| *v >= 0).map(|us| us as f64 / 1_000_000.0)
}

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// Lance FFmpeg et appelle `on_progress(secondes)` a chaque mise a jour.
/// Renvoie la sortie d'erreur complete (pour le journal) en cas de succes.
pub fn run(
    ffmpeg: &Path,
    args: &[String],
    job: &JobHandle,
    mut on_progress: impl FnMut(f64),
) -> AppResult<String> {
    let mut child = command(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Ffmpeg(format!("Impossible de lancer FFmpeg : {e}")))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Ffmpeg("Sortie FFmpeg indisponible".into()))?;
    let stderr = child.stderr.take().ok_or_else(|| AppError::Ffmpeg("Sortie FFmpeg indisponible".into()))?;
    *job.child.lock().map_err(|_| AppError::Other("Verrou du rendu corrompu".into()))? = Some(child);

    let stderr_thread = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        text
    });

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(seconds) = parse_progress_seconds(&line) {
            on_progress(seconds);
        }
    }

    let status = loop {
        {
            let mut guard = job.child.lock().map_err(|_| AppError::Other("Verrou du rendu corrompu".into()))?;
            match guard.as_mut() {
                Some(child) => {
                    if let Some(status) = child.try_wait()? {
                        guard.take();
                        break status;
                    }
                }
                None => return Err(AppError::Ffmpeg("Processus FFmpeg perdu".into())),
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    let stderr_text = stderr_thread.join().unwrap_or_default();

    if job.is_cancelled() {
        return Err(AppError::Cancelled("Rendu annulé.".into()));
    }
    if !status.success() {
        let detail = tail(&stderr_text, 12);
        let hint = if detail.contains("Unknown encoder") || detail.contains("Encoder not found") {
            "\nL'encodeur requis est absent de cette version de FFmpeg."
        } else {
            ""
        };
        return Err(AppError::Ffmpeg(format!(
            "FFmpeg s'est arrêté avec une erreur (code {}).{hint}\n{detail}",
            status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into())
        )));
    }
    Ok(stderr_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, duration: f64, w: i64, h: i64, fps: f64, audio: bool) -> RenderInput {
        RenderInput {
            path: PathBuf::from(format!("C:/clips/{name}.mp4")),
            probe: ProbeInfo {
                duration,
                width: Some(w),
                height: Some(h),
                fps: Some(fps),
                video_codec: Some("h264".into()),
                pix_fmt: Some("yuv420p".into()),
                profile: Some("High".into()),
                time_base: Some("1/15360".into()),
                has_video: true,
                has_audio: audio,
                audio_codec: audio.then(|| "aac".into()),
                sample_rate: audio.then_some(48000),
                channels: audio.then_some(2),
            },
        }
    }

    #[test]
    fn copy_strategy_when_streams_match() {
        let inputs = vec![input("a", 10.0, 1080, 1920, 30.0, true), input("b", 10.0, 1080, 1920, 30.0, true)];
        let opts = RenderOptions::default();
        let plan = plan(&inputs, None, &opts, "libx264", Path::new("out.mp4"), Path::new("list.txt"), false);
        assert_eq!(plan.strategy, Strategy::Copy);
        assert!(plan.args.iter().any(|a| a == "copy"));
        assert!(plan.concat_list.unwrap().contains("file 'C:/clips/a.mp4'"));
        assert!((plan.total_duration - 20.0).abs() < 1e-9);
    }

    #[test]
    fn reencode_when_resolution_or_fps_differs() {
        let inputs = vec![input("a", 8.0, 720, 1280, 24.0, true), input("b", 8.0, 1080, 1920, 30.0, false)];
        let opts = RenderOptions::default();
        assert!(!can_stream_copy(&inputs, &opts, false));
        let plan = plan(&inputs, None, &opts, "libx264", Path::new("out.mp4"), Path::new("list.txt"), false);
        assert_eq!(plan.strategy, Strategy::Reencode);
        let graph = &plan.args[plan.args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("anullsrc"), "le clip sans audio recoit un silence");
        assert!(graph.contains("concat=n=2:v=1:a=1[vout][acat]"));
        assert!(graph.contains("loudnorm"));
    }

    #[test]
    fn transitions_shorten_total_and_offsets_accumulate() {
        let inputs = vec![
            input("a", 10.0, 1080, 1920, 30.0, true),
            input("b", 10.0, 1080, 1920, 30.0, true),
            input("c", 10.0, 1080, 1920, 30.0, true),
        ];
        let opts = RenderOptions { transition: "fade".into(), transition_duration: 0.5, ..Default::default() };
        let (graph, total) = build_filter_graph(&inputs, &opts, None);
        assert!((total - 29.0).abs() < 1e-9);
        assert!(graph.contains("xfade=transition=fade:duration=0.5:offset=9.5[vx1]"));
        assert!(graph.contains("xfade=transition=fade:duration=0.5:offset=19[vout]"));
        assert!(graph.contains("acrossfade=d=0.5"));
    }

    #[test]
    fn music_is_mixed_with_ducking() {
        let inputs = vec![input("a", 10.0, 1080, 1920, 30.0, true)];
        let opts = RenderOptions::default();
        let plan = plan(&inputs, Some(Path::new("C:/music.mp3")), &opts, "libx264", Path::new("o.mp4"), Path::new("l.txt"), false);
        assert_eq!(plan.strategy, Strategy::Reencode);
        assert!(plan.args.windows(2).any(|w| w[0] == "-stream_loop" && w[1] == "-1"));
        let graph = &plan.args[plan.args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("sidechaincompress"));
        assert!(graph.contains("[1:a:0]"));
    }

    #[test]
    fn concat_entry_escapes_quotes() {
        assert_eq!(concat_entry(Path::new(r"C:\a\l'clip.mp4")), r"file 'C:/a/l'\''clip.mp4'");
    }

    #[test]
    fn progress_parsing() {
        assert_eq!(parse_progress_seconds("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_seconds("out_time_ms=2000000"), Some(2.0));
        assert_eq!(parse_progress_seconds("out_time_us=N/A"), None);
        assert_eq!(parse_progress_seconds("progress=end"), None);
    }

    #[test]
    fn number_formatting() {
        assert_eq!(fmt(10.0), "10");
        assert_eq!(fmt(9.5), "9.5");
        assert_eq!(fmt(0.0), "0");
        assert_eq!(fmt(1.23456), "1.235");
    }
}
