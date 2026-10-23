# Gemini - one-time setup on Windows (PowerShell 5.1+).
# Creates backend\venv, installs Python and npm packages and prepares the database.
#   .\install.ps1
$ErrorActionPreference = "Stop"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Host "Python 3.11+ is required: https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}
& $python.Source (Join-Path $PSScriptRoot "scripts\runner.py") install
exit $LASTEXITCODE
