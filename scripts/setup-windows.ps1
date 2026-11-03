# Verbatim one-time setup for Windows (run by "Setup Verbatim.bat").
# Checks for Node.js, a suitable Python and Ollama, offers to install what is missing (winget),
# then installs the app itself and puts a "Verbatim" shortcut on the desktop.
#   -CheckOnly   only report what is installed; change nothing
param([switch]$CheckOnly)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Ask($question) {
    if ($CheckOnly) { return $false }
    $a = Read-Host "$question [Y/n]"
    return ($a -eq "" -or $a -match "^[Yy]")
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Has-Winget { return [bool](Get-Command winget -ErrorAction SilentlyContinue) }
function Winget-Install($id, $name) {
    if (-not (Has-Winget)) {
        Say "  winget is not available. Please install $name yourself, then run this setup again." Yellow
        return $false
    }
    Say "  Installing $name (a Windows prompt may ask for permission)..." Cyan
    winget install -e --id $id --accept-source-agreements --accept-package-agreements
    Refresh-Path
    return $true
}
function Python-Ok {
    foreach ($v in "3.12", "3.13", "3.11", "3.10") {
        try { & py "-$v" --version *> $null; if ($LASTEXITCODE -eq 0) { return "py -$v" } } catch {}
    }
    try {
        $out = & python --version 2>&1
        if ($out -match "Python 3\.1[0-3]\.") { return "python" }
    } catch {}
    return $null
}

Say ""
Say "  ==============================================" Green
Say "   Verbatim setup" Green
Say "  ==============================================" Green
Say "  This installs everything Verbatim needs on this computer."
Say "  It can take 10-30 minutes and needs about 10 GB of disk space."
Say ""

# 1. Node.js
Refresh-Path
if (Get-Command node -ErrorAction SilentlyContinue) {
    Say ("  [ok] Node.js " + (node --version)) Green
} else {
    Say "  [missing] Node.js (runs the app)" Yellow
    if ((Ask "  Install Node.js LTS now?") -and (Winget-Install "OpenJS.NodeJS.LTS" "Node.js")) {}
    elseif (-not $CheckOnly) { Start-Process "https://nodejs.org"; throw "Please install Node.js LTS from nodejs.org, then run Setup Verbatim again." }
}

# 2. Python 3.10-3.13 (the speech models do not support 3.14 yet)
$py = Python-Ok
if ($py) {
    Say ("  [ok] Python (" + $py + ")") Green
} else {
    Say "  [missing] Python 3.10-3.13 (runs the speech models)" Yellow
    if ((Ask "  Install Python 3.12 now?") -and (Winget-Install "Python.Python.3.12" "Python 3.12")) {}
    elseif (-not $CheckOnly) { Start-Process "https://www.python.org/downloads/release/python-3129/"; throw "Please install Python 3.12 (tick 'Add to PATH'), then run Setup Verbatim again." }
}

# 3. Ollama (local AI insights) - optional but recommended
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama -and (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if ($ollama) {
    Say "  [ok] Ollama (AI insights)" Green
} else {
    Say "  [optional] Ollama is not installed: transcripts work, AI insights will not." Yellow
    if (Ask "  Install Ollama now (about 1.5 GB, plus 4.7 GB for the AI model)?") {
        if (Winget-Install "Ollama.Ollama" "Ollama") { $ollama = "ollama" }
    }
}

if ($CheckOnly) { Say "`n  Check finished (nothing was changed)." Cyan; exit 0 }

# 4. The app itself: Python environment, speech models' software, website packages, .env with a key
Say "`n  Installing Verbatim itself. This is the long part..." Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed (see the messages above)." }
npm run setup
if ($LASTEXITCODE -ne 0) { throw "Setup failed (see the messages above)." }

# 5. The AI model for insights
if ($ollama) {
    $models = & $ollama list 2>$null
    if ($models -notmatch "qwen2.5:7b") {
        if (Ask "  Download the AI model for insights now (qwen2.5:7b, 4.7 GB)?") { & $ollama pull qwen2.5:7b }
    }
}

# 6. Desktop shortcut to "Start Verbatim"
if (Ask "  Put a 'Verbatim' shortcut on the desktop?") {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Verbatim.lnk"))
    $link.TargetPath = Join-Path $Root "Start Verbatim.bat"
    $link.WorkingDirectory = $Root
    $link.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,168"
    $link.Description = "Start Verbatim and open it in the browser"
    $link.Save()
    Say "  [ok] Shortcut created on the desktop." Green
}

Say ""
Say "  ==============================================" Green
Say "   Setup finished!" Green
Say "  ==============================================" Green
Say "  Start the app with 'Start Verbatim' (or the desktop shortcut)."
Say "  Optional, for the best speaker separation: add your free Hugging Face token"
Say "  to the .env file in this folder (HF_TOKEN=...). See README, step 4."
Say "  IMPORTANT: back up the ENCRYPTION_KEY line from .env - without it, recordings cannot be opened."
Say ""
