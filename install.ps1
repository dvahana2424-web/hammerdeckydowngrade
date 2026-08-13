<#
    Hammer 4.1 - One-paste installer bootstrap
    Usage (run in PowerShell):
        irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-obfuscated/install.ps1 | iex

    Fetches the latest full installer from Cloudflare CDN (no stale GitHub cache).
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$CdnBase = 'https://hammer-cdn.monzikmonzik.workers.dev'
$LogPath = Join-Path $env:TEMP 'hammer-install-last.log'

function Invoke-HammerInstallScript {
    $cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $url = '{0}/v1/public/installer/install-full.ps1?cb={1}' -f $CdnBase, $cb
    Invoke-RestMethod -Uri $url -Headers @{'Cache-Control' = 'no-cache'} | Invoke-Expression
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host 'Requesting administrator rights...' -ForegroundColor Yellow
    $cmd = @"
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;
`$log='$LogPath';
`$CdnBase='$CdnBase';
try {
  `$cb=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds();
  `$url='{0}/v1/public/installer/install-full.ps1?cb={1}' -f `$CdnBase,`$cb;
  Invoke-RestMethod -Uri `$url -Headers @{'Cache-Control'='no-cache'} | Invoke-Expression
} catch {
  "`$(Get-Date -Format o) ERROR: `$(`$_.Exception.Message)`n`$(`$_.ScriptStackTrace)" | Out-File -LiteralPath `$log -Encoding UTF8;
  Write-Host "`nInstallation failed: `$(`$_.Exception.Message)" -ForegroundColor Red;
  Write-Host "Log saved to: `$log" -ForegroundColor Yellow;
  Read-Host 'Press Enter to close';
  exit 1
}
"@
    $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-EncodedCommand', $b64
        ) | Out-Null
    } catch {
        Write-Host 'Administrator rights are required. Installation cancelled.' -ForegroundColor Red
    }
    return
}

Invoke-HammerInstallScript
