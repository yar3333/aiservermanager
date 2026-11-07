<#
.SYNOPSIS
  Fetch the pinned WinSW host that ai server manager uses to run custom
  services on Windows, and verify it against the published checksum.

.DESCRIPTION
  WinSW is placed in backend/src/files/winsw/ so the build copies it to
  dist/files/ and the npm package ships it (same pattern as wmiGpuQuery.ps1).
  Re-run this script after changing $Version to upgrade the wrapper.

.EXAMPLE
  pwsh scripts/get-winsw.ps1
#>
[CmdletBinding()]
param(
  [string]$Version = '2.12.0',
  # Default is resolved in the body: $PSScriptRoot is still empty during parameter binding.
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Destination) {
  $Destination = Join-Path $PSScriptRoot '..\backend\src\files\winsw'
}

# SHA-256 of the official WinSW-x64.exe release asset for $Version.
$ExpectedSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$Uri = "https://github.com/winsw/winsw/releases/download/v$Version/WinSW-x64.exe"
$LicenseUri = "https://raw.githubusercontent.com/winsw/winsw/v$Version/LICENSE.txt"

$target = Join-Path $Destination 'WinSW-x64.exe'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Write-Host "Downloading WinSW $Version from $Uri"
Invoke-WebRequest -Uri $Uri -OutFile $target -UseBasicParsing

$actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) {
  Remove-Item -Path $target -Force
  throw "SHA-256 mismatch for WinSW $Version.`n  expected: $ExpectedSha256`n  actual:   $actual"
}

Invoke-WebRequest -Uri $LicenseUri -OutFile (Join-Path $Destination 'LICENSE-WinSW.txt') -UseBasicParsing
Unblock-File -Path $target

$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "WinSW $Version verified ($sizeMb MB, SHA-256 $actual)"
Write-Host "Installed to $target"
