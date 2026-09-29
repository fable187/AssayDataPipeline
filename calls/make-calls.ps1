# Turns each call script in calls/scripts into a two-voice WAV in calls/audio, using the
# text-to-speech voices built into Windows. Run with: npm run calls
#
# Script format: "voices: firm=Zira caller=David" once, then lines starting "F:" (firm) or
# "C:" (caller). Lines starting "#" are notes and are not spoken.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root 'audio'
New-Item -ItemType Directory -Force $outDir | Out-Null

$voiceNames = @{ Zira = 'Microsoft Zira Desktop'; David = 'Microsoft David Desktop' }
# 16 kHz mono is plenty for speech and keeps each file small.
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($script in Get-ChildItem (Join-Path $root 'scripts') -Filter *.txt) {
  $voices = @{ F = $voiceNames.Zira; C = $voiceNames.David }
  $prompt = New-Object System.Speech.Synthesis.PromptBuilder
  foreach ($line in Get-Content $script.FullName) {
    if ($line -match '^voices:\s*firm=(\w+)\s+caller=(\w+)') {
      $voices = @{ F = $voiceNames[$Matches[1]]; C = $voiceNames[$Matches[2]] }
    } elseif ($line -match '^([FC]):\s*(.+)$') {
      $prompt.StartVoice($voices[$Matches[1]])
      $prompt.AppendText($Matches[2])
      $prompt.EndVoice()
      $prompt.AppendBreak([TimeSpan]::FromMilliseconds(700))
    }
  }
  $wav = Join-Path $outDir ($script.BaseName + '.wav')
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SetOutputToWaveFile($wav, $format)
  $synth.Speak($prompt)
  $synth.Dispose()
  '{0,-28} {1,6:N0} KB' -f ($script.BaseName + '.wav'), ((Get-Item $wav).Length / 1KB)
}
