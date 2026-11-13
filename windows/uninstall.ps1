[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$KeepImage,
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $RepoRoot 'server'
$ComposeFile = Join-Path $RepoRoot 'compose.yaml'
$DataDir = Join-Path $ServerDir 'data'
$TrayDir = Join-Path $env:LOCALAPPDATA 'Yogganga'
$IniPath = Join-Path $TrayDir 'tray.ini'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor DarkGray }
function Write-Warn([string]$Message) { Write-Host "WARN: $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

# Keep harmless native stderr (Podman's Compose notice) from becoming a
# terminating error under $ErrorActionPreference = 'Stop'.
function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$Quiet
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($Quiet) { & $FilePath @Arguments *> $null }
        else { & $FilePath @Arguments 2>&1 | Out-Host }
        return $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previous }
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $DryRun -and -not (Test-Admin)) {
    Fail 'Run this script from an elevated PowerShell (right-click > Run as administrator).'
}

$engineName = ''
$engineExe = ''
if (Test-Path $IniPath) {
    foreach ($line in Get-Content $IniPath) {
        if ($line -match '^\s*engine\s*=\s*(.+)$') { $engineName = $Matches[1].Trim() }
        if ($line -match '^\s*engineExe\s*=\s*(.+)$') { $engineExe = $Matches[1].Trim() }
    }
}

if (-not $engineExe -or -not (Test-Path $engineExe)) {
    $docker = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($docker) { $engineName = 'docker'; $engineExe = $docker.Source }
    else {
        $podman = Get-Command podman -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($podman) { $engineName = 'podman'; $engineExe = $podman.Source }
        else {
            $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
            if (Test-Path $candidate) { $engineName = 'podman'; $engineExe = $candidate }
        }
    }
}
if (-not $engineName) { $engineName = 'docker' }

if ($DryRun) {
    Write-Step 'Dry run: no containers, files, firewall rules, or registry values will be changed.'
    Write-Note "Repo:    $RepoRoot"
    Write-Note "Engine:  $engineName ($engineExe)"
    Write-Note "Tray:    $TrayDir"
    if ($RemoveData) { Write-Note "Data:    $DataDir (WOULD BE DELETED)" }
    else { Write-Note "Data:    $DataDir (kept)" }
    if ($KeepImage) { Write-Note 'Image:   kept' }
    else { Write-Note 'Image:   yogganga-server:local would be removed' }
    Write-Note 'Actions: stop tray, compose down, remove firewall rule and tray autostart.'
    return
}

Write-Step 'Stopping the tray app...'
Get-Process -Name 'YoggangaTray' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if ($engineExe -and (Test-Path $engineExe)) {
    $engineReady = (Invoke-Native -FilePath $engineExe -Arguments @('info') -Quiet) -eq 0

    if ($engineReady) {
        Write-Step 'Removing the container...'
        if (Test-Path $ComposeFile) {
            Push-Location $RepoRoot
            try { $null = Invoke-Native -FilePath $engineExe -Arguments @('compose', '-f', $ComposeFile, 'down', '--remove-orphans') }
            finally { Pop-Location }
        }
        # Also handles a missing .env or a compose project that is already gone.
        $null = Invoke-Native -FilePath $engineExe -Arguments @('rm', '-f', 'yogganga') -Quiet

        if (-not $KeepImage) {
            Write-Step 'Removing the local image...'
            $null = Invoke-Native -FilePath $engineExe -Arguments @('rmi', 'yogganga-server:local') -Quiet
        }
    }
    else {
        Write-Warn "$engineName is not running. The container may still exist; start the engine and rerun this script."
    }
}

Write-Step 'Removing tray autostart and files...'
Remove-ItemProperty -Path $RunKey -Name 'YoggangaTray' -ErrorAction SilentlyContinue
if (Test-Path $TrayDir) { Remove-Item -Recurse -Force $TrayDir }
$trayBuild = Join-Path $PSScriptRoot 'tray\bin'
if (Test-Path $trayBuild) { Remove-Item -Recurse -Force $trayBuild }

Write-Step 'Removing the firewall rule...'
Get-NetFirewallRule -DisplayName 'Yogganga Server*' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

if ($RemoveData) {
    Write-Step 'Deleting server\data (database and downloaded chapters)...'
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
}
elseif (Test-Path $DataDir) {
    Write-Note "Kept $DataDir"
}

Write-Host ''
Write-Host 'Yogganga was removed.' -ForegroundColor Green
if (-not $RemoveData) {
    Write-Note 'Your data was kept. Delete server\data yourself, or rerun with -RemoveData.'
}
Write-Note 'Docker Desktop or Podman was not changed.'
