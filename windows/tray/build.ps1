[CmdletBinding()]
param(
    [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $OutputDir) {
    $OutputDir = Join-Path $PSScriptRoot 'bin'
}

$candidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
    throw 'The .NET Framework 4.x C# compiler (csc.exe) was not found. Windows 11 includes it.'
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$output = Join-Path $OutputDir 'YoggangaTray.exe'
$source = Join-Path $PSScriptRoot 'YoggangaTray.cs'

$cscArgs = @(
    '/nologo'
    '/target:winexe'
    '/optimize+'
    '/platform:anycpu'
    "/out:$output"
    '/r:System.dll'
    '/r:System.Drawing.dll'
    '/r:System.Windows.Forms.dll'
    $source
)

& $csc $cscArgs
if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE"
}

Write-Host "Built $output"
