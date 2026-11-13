[CmdletBinding()]
param(
    [string]$ServerUrl = '',
    [switch]$SkipFirewall,
    [switch]$SkipTray,
    [switch]$NoTrayLaunch,
    [switch]$DryRun,
    [ValidateSet('auto', 'docker', 'podman')]
    [string]$Engine = 'auto'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $RepoRoot 'server'
$ComposeFile = Join-Path $RepoRoot 'compose.yaml'
$Dockerfile = Join-Path $RepoRoot 'Dockerfile'
$EnvFile = Join-Path $ServerDir '.env'
$DataDir = Join-Path $ServerDir 'data'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor DarkGray }
function Write-Warn([string]$Message) { Write-Host "WARN: $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

# Native stderr is an error record in Windows PowerShell, and Stop turns
# harmless notices (Podman's "using external compose provider") into failures.
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

function Get-NativeText {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { return ((& $FilePath @Arguments 2>$null) -join [Environment]::NewLine) }
    finally { $ErrorActionPreference = $previous }
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$isAdmin = Test-Admin
if (-not $DryRun -and -not $isAdmin) {
    Fail 'Run this script from an elevated PowerShell (right-click > Run as administrator).'
}

function Get-ApplicationPath([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Get-EngineInfo {
    $requested = $Engine.ToLowerInvariant()
    $docker = $null
    $podman = $null

    if ($requested -eq 'auto' -or $requested -eq 'docker') {
        $docker = Get-ApplicationPath 'docker'
        if (-not $docker) {
            $candidate = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
            if (Test-Path $candidate) { $docker = $candidate }
        }
        if (-not $docker) {
            $candidate = Join-Path $env:LOCALAPPDATA 'Docker\Docker\resources\bin\docker.exe'
            if (Test-Path $candidate) { $docker = $candidate }
        }
    }

    if ($requested -eq 'auto' -or $requested -eq 'podman') {
        $podman = Get-ApplicationPath 'podman'
        if (-not $podman) {
            $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
            if (Test-Path $candidate) { $podman = $candidate }
        }
    }

    if ($requested -eq 'docker') {
        if (-not $docker) { Fail 'Docker was not found. Install Docker Desktop, or use -Engine podman.' }
        return @{ Name = 'docker'; Exe = $docker; Label = 'Docker' }
    }
    if ($requested -eq 'podman') {
        if (-not $podman) { Fail 'Podman was not found. Install Podman, or use -Engine docker.' }
        return @{ Name = 'podman'; Exe = $podman; Label = 'Podman' }
    }

    if ($docker) { return @{ Name = 'docker'; Exe = $docker; Label = 'Docker' } }
    if ($podman) { return @{ Name = 'podman'; Exe = $podman; Label = 'Podman' } }
    Fail 'Neither Docker nor Podman was found. Install Docker Desktop (WSL 2 backend) first.'
}

function Get-DockerDesktopPath {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
        (Join-Path $env:LOCALAPPDATA 'Docker\Docker\Docker Desktop.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return ''
}

function Test-EngineReady($EngineInfo) {
    return (Invoke-Native -FilePath $EngineInfo.Exe -Arguments @('info') -Quiet) -eq 0
}

function Test-Compose($EngineInfo) {
    return (Invoke-Native -FilePath $EngineInfo.Exe -Arguments @('compose', 'version') -Quiet) -eq 0
}

function Start-Engine($EngineInfo) {
    if ($EngineInfo.Name -eq 'docker') {
        $desktop = Get-DockerDesktopPath
        if (-not $desktop) { return $false }
        Write-Step 'Starting Docker Desktop...'
        if ($isAdmin) {
            # Do not start Docker Desktop with an elevated token; ask Explorer.
            Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $desktop + '"') | Out-Null
        }
        else {
            Start-Process -FilePath $desktop | Out-Null
        }
    }
    else {
        Write-Step 'Starting the Podman machine...'
        $null = Invoke-Native -FilePath $EngineInfo.Exe -Arguments @('machine', 'start')
    }

    Write-Note 'Waiting for the container engine...'
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-EngineReady $EngineInfo) { return $true }
    }
    return $false
}

function Get-ServerPort {
    $port = 8787
    if (Test-Path $EnvFile) {
        $match = Select-String -Path $EnvFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -Last 1
        if ($match) { $port = [int]$match.Matches[0].Groups[1].Value }
    }
    return $port
}

function Get-ServerHost {
    $cli = Get-ApplicationPath 'tailscale'
    if (-not $cli) {
        $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
        if (Test-Path $candidate) { $cli = $candidate }
    }
    if ($cli) {
        try {
            $json = Get-NativeText -FilePath $cli -Arguments @('status', '--json')
            $status = $json | ConvertFrom-Json
            if ($status.Self.DNSName) { return $status.Self.DNSName.TrimEnd('.') }
        }
        catch { }
    }
    return $env:COMPUTERNAME.ToLowerInvariant()
}

if (-not (Test-Path $ComposeFile)) { Fail "compose.yaml not found at $ComposeFile" }
if (-not (Test-Path $Dockerfile)) { Fail "Dockerfile not found at $Dockerfile" }
if (-not (Test-Path $ServerDir)) { Fail "server directory not found at $ServerDir" }

$engineInfo = Get-EngineInfo
$port = Get-ServerPort
if ($port -ne 8787) {
    Fail 'compose.yaml publishes port 8787 and the image listens on 8787. Set PORT=8787 in server\.env, or edit compose.yaml and this script together.'
}
if (-not $ServerUrl) {
    $ServerUrl = 'http://' + (Get-ServerHost) + ':' + $port
}

if (-not (Test-Compose $engineInfo)) {
    Fail "$($engineInfo.Label) Compose is not available. Update $($engineInfo.Label) so 'compose' works."
}

$engineReady = Test-EngineReady $engineInfo

if ($DryRun) {
    Write-Step 'Dry run: no files, containers, firewall rules, or registry values will be changed.'
    Write-Note "Repo:      $RepoRoot"
    Write-Note "Engine:    $($engineInfo.Label) ($($engineInfo.Exe))"
    Write-Note "Engine up: $engineReady"
    Write-Note "Server:    $ServerUrl"
    Write-Note "Port:      $port"
    if (Test-Path $EnvFile) { Write-Note "Env file:  $EnvFile" }
    else { Write-Note 'Env file:  missing (would be created from .env.example)' }
    Write-Note "Data:      $DataDir"
    Write-Note "Compose:   $ComposeFile"
    if ($SkipTray) { Write-Note 'Tray:      skipped' }
    else { Write-Note "Tray:      $(Join-Path $env:LOCALAPPDATA 'Yogganga\YoggangaTray.exe')" }
    if ($SkipFirewall) { Write-Note 'Firewall:  skipped' }
    else { Write-Note "Firewall:  would allow TCP $port on Private/Domain" }
    Write-Note 'Actions:   build image, compose up -d, wait for /api/health, register tray at sign-in'

    if (Test-Path $EnvFile) {
        Push-Location $RepoRoot
        try {
            $configExit = Invoke-Native -FilePath $engineInfo.Exe -Arguments @('compose', '-f', $ComposeFile, 'config') -Quiet
            if ($configExit -ne 0) { Fail 'compose config validation failed. See the output above.' }
        }
        finally { Pop-Location }
        Write-Note 'compose config: valid'
    }
    return
}

if (-not $engineReady) {
    Write-Step "$($engineInfo.Label) is not running; starting it..."
    if (-not (Start-Engine $engineInfo)) {
        Fail "$($engineInfo.Label) did not become ready. Start it manually, then rerun this script."
    }
}

if (-not (Test-Path $EnvFile)) {
    Write-Step 'Creating server\.env from .env.example...'
    Copy-Item (Join-Path $ServerDir '.env.example') $EnvFile
    Write-Warn 'server\.env was created. Set MANGA_INVITE_CODE, then rerun this installer to apply it.'
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

Push-Location $RepoRoot
try {
    Write-Step 'Building the server image...'
    $buildExit = Invoke-Native -FilePath $engineInfo.Exe -Arguments @('compose', '-f', $ComposeFile, 'build')
    if ($buildExit -ne 0) { Fail 'Image build failed. See the output above.' }

    Write-Step 'Starting the container...'
    $upExit = Invoke-Native -FilePath $engineInfo.Exe -Arguments @('compose', '-f', $ComposeFile, 'up', '-d', '--force-recreate')
    if ($upExit -ne 0) { Fail 'Container start failed. See the output above.' }
}
finally { Pop-Location }

Write-Step "Waiting for http://127.0.0.1:$port/api/health ..."
$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
        if ($health.ok) { $healthy = $true; break }
    }
    catch { }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Warn 'The container started but the health check did not pass.'
    $null = Invoke-Native -FilePath $engineInfo.Exe -Arguments @('logs', '--tail', '40', 'yogganga')
    Fail 'Fix the error above, then rerun this script.'
}

if (-not $SkipFirewall) {
    Write-Step "Allowing TCP $port on Private and Domain networks..."
    Get-NetFirewallRule -DisplayName 'Yogganga Server*' -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule `
        -DisplayName "Yogganga Server (TCP $port)" `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Private,Domain | Out-Null
}

if (-not $SkipTray) {
    Write-Step 'Building the tray app...'
    & (Join-Path $PSScriptRoot 'tray\build.ps1') -OutputDir (Join-Path $PSScriptRoot 'tray\bin')
    $traySource = Join-Path $PSScriptRoot 'tray\bin\YoggangaTray.exe'
    if (-not (Test-Path $traySource)) { Fail 'The tray executable was not built.' }

    $trayDir = Join-Path $env:LOCALAPPDATA 'Yogganga'
    New-Item -ItemType Directory -Path $trayDir -Force | Out-Null
    $trayExe = Join-Path $trayDir 'YoggangaTray.exe'
    Get-Process -Name 'YoggangaTray' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Copy-Item $traySource $trayExe -Force

    $engineStart = ''
    if ($engineInfo.Name -eq 'docker') { $engineStart = Get-DockerDesktopPath }
    $iniLines = @(
        "engine=$($engineInfo.Name)"
        "engineExe=$($engineInfo.Exe)"
        "engineStart=$engineStart"
        "url=$ServerUrl"
        "repo=$RepoRoot"
        "data=$DataDir"
    )
    [IO.File]::WriteAllLines(
        (Join-Path $trayDir 'tray.ini'),
        $iniLines,
        (New-Object System.Text.UTF8Encoding($false))
    )

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
    Set-ItemProperty -Path $runKey -Name 'YoggangaTray' -Value ('"' + $trayExe + '"')

    if (-not $NoTrayLaunch) {
        if ($isAdmin) {
            # Let Explorer start it at normal integrity instead of elevated.
            try {
                Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $trayExe + '"') | Out-Null
            }
            catch {
                Write-Warn "Could not start the tray. Launch it from $trayExe."
            }
        }
        else {
            Start-Process -FilePath $trayExe | Out-Null
        }
    }
}

Write-Host ''
Write-Host 'Yogganga is running.' -ForegroundColor Green
Write-Note "Server:  $ServerUrl"
Write-Note "Local:   http://127.0.0.1:$port"
Write-Note "Data:    $DataDir"
Write-Note "Logs:    $($engineInfo.Name) logs --tail 200 yogganga"
if (-not $SkipTray) { Write-Note 'Tray:    starts at sign-in and controls the container.' }
Write-Host ''
Write-Host 'This is a container, not a Windows service: the tray starts the engine and container at sign-in.' -ForegroundColor Yellow
Write-Host 'Nothing runs before a user signs in. See windows\README.md for the tradeoff and uninstall steps.'
