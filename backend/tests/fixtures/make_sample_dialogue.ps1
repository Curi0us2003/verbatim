# Generates sample_dialogue.wav: a short fictional counselling exchange with two synthetic voices
# (Windows text-to-speech), used by the pipeline tests. Run from this folder:
#   powershell -ExecutionPolicy Bypass -File make_sample_dialogue.ps1
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "sample_dialogue.wav"
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$counsellor = ($voices | Where-Object { $_ -match "David" } | Select-Object -First 1)
$client = ($voices | Where-Object { $_ -match "Zira" } | Select-Object -First 1)
if (-not $counsellor) { $counsellor = $voices[0] }
if (-not $client) { $client = $voices[-1] }

$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($out, $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
$lines = @(
  @($counsellor, "Hello, thanks for coming in today. How have you been feeling this week?"),
  @($client, "Um, honestly, it has been hard. I keep worrying about my exams, and I, I can't really sleep."),
  @($counsellor, "That sounds really tiring. What goes through your mind at night?"),
  @($client, "Mostly that I will fail and let my parents down. Yeah. That's the main thing.")
)
$i = 0
foreach ($line in $lines) {
  $pb.StartVoice($line[0]); $pb.AppendText($line[1]); $pb.EndVoice()
  # A 3-second silence after the second line exercises the [pause Ns] marker.
  if ($i -eq 1) { $pb.AppendBreak([TimeSpan]::FromSeconds(3)) } else { $pb.AppendBreak([TimeSpan]::FromMilliseconds(700)) }
  $i++
}
$synth.Speak($pb)
$synth.Dispose()
Write-Output "Wrote $out using voices: $counsellor / $client"
