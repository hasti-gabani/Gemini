# Sends one PDF through WhatsApp Desktop on this PC: opens the chat with -Phone, pastes the file and
# presses Enter. Keys are only pressed while WhatsApp is the window in front; otherwise nothing is sent.
# Exit codes: 0 sent, 2 WhatsApp did not come to the front, 3 another window came to the front.
param(
  [Parameter(Mandatory = $true)][string]$Pdf,
  [Parameter(Mandatory = $true)][string]$Phone
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GeminiWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
"@

function Test-WhatsAppInFront {
  $window = [GeminiWindow]::GetForegroundWindow()
  if ($window -eq [IntPtr]::Zero) { return $false }
  $processId = [uint32]0
  [void][GeminiWindow]::GetWindowThreadProcessId($window, [ref]$processId)
  try { return (Get-Process -Id $processId).ProcessName -like 'WhatsApp*' } catch { return $false }
}

$wasRunning = [bool](Get-Process -Name 'WhatsApp*' -ErrorAction SilentlyContinue)
$previousText = $null
try { $previousText = Get-Clipboard -Raw -ErrorAction Stop } catch { }

Set-Clipboard -Path $Pdf
Start-Process "whatsapp://send?phone=$Phone"

$shell = New-Object -ComObject WScript.Shell
$deadline = (Get-Date).AddSeconds(20)
while (-not (Test-WhatsAppInFront)) {
  if ((Get-Date) -gt $deadline) { exit 2 }
  [void]$shell.AppActivate('WhatsApp')
  Start-Sleep -Milliseconds 400
}

# Give the chat time to open (longer when WhatsApp had to start first).
Start-Sleep -Milliseconds $(if ($wasRunning) { 3000 } else { 8000 })
if (-not (Test-WhatsAppInFront)) { exit 3 }
$shell.SendKeys('^v')

# The PDF preview opens; Enter sends it.
Start-Sleep -Milliseconds 3000
if (-not (Test-WhatsAppInFront)) { exit 3 }
$shell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 1500

if ($previousText) { try { Set-Clipboard -Value $previousText } catch { } }
exit 0
