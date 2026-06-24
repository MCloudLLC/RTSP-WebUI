#!/usr/bin/env pwsh
# Download the go2rtc binary into .\bin for desktop / bare-metal use on Windows.
# Docker deployments do NOT need this (they use the alexxit/go2rtc image).
#
# This is the Windows counterpart of download-go2rtc.sh.
$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's directory.
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# Map the process architecture to a go2rtc release asset.
$arch = $env:PROCESSOR_ARCHITECTURE
switch -Wildcard ($arch) {
  'AMD64' { $asset = 'go2rtc_win64.zip' }
  'ARM64' { $asset = 'go2rtc_win_arm64.zip' }
  'x86'   { $asset = 'go2rtc_win32.zip' }
  default { Write-Error "Unsupported Windows arch: $arch"; exit 1 }
}

$url = "https://github.com/AlexxIT/go2rtc/releases/latest/download/$asset"
$zip = Join-Path ([System.IO.Path]::GetTempPath()) 'go2rtc.zip'
$out = Join-Path $binDir 'go2rtc.exe'

Write-Host "Downloading $asset..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

# The archive contains go2rtc.exe; extract just that file to .\bin.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("go2rtc_" + [System.Guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem -Path $tmp -Recurse -Filter 'go2rtc.exe' | Select-Object -First 1
  if (-not $exe) { Write-Error "go2rtc.exe not found in $asset"; exit 1 }
  Copy-Item -Path $exe.FullName -Destination $out -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Remove-Item -Force $zip -ErrorAction SilentlyContinue
}

Write-Host 'go2rtc installed:'
& $out -version 2>&1 | Select-Object -First 1
