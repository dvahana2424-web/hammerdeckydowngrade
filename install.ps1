# Hammer 4.1 bootstrap — fetches latest installer from CDN (same command URL on GitHub).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$CdnBase = 'https://hammer-cdn.monzikmonzik.workers.dev'
$Repo = 'dvahana2424-web/hammerdeckydowngrade'
$Branch = 'Hammer-3.8-obfuscated'
$ScriptName = 'install-full-v2.ps1'
$LogPath = Join-Path $env:TEMP 'hammer-install-last.log'

$Runner = @'
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$sources = @(
    ('{0}/v1/public/installer/{1}?cb={2}' -f $CdnBase, $ScriptName, $cb),
    ('https://raw.githubusercontent.com/{0}/{1}/{2}?cb={3}' -f $Repo, [uri]::EscapeDataString($Branch), $ScriptName, $cb),
    ('https://cdn.jsdelivr.net/gh/{0}@{1}/{2}?cb={3}' -f $Repo, $Branch, $ScriptName, $cb)
)
$script = $null
foreach ($src in $sources) {
    try {
        $script = Invoke-RestMethod -Uri $src -Headers @{'Cache-Control' = 'no-cache'}
        if ($script) { break }
    } catch {
        Write-Host ('  source unavailable: {0}' -f $src.Split('?')[0]) -ForegroundColor DarkYellow
    }
}
if (-not $script) { throw 'Could not download the installer from any source. Check your internet connection and try again.' }
$script | Invoke-Expression
'@

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host 'Requesting administrator rights...' -ForegroundColor Yellow
    $cmd = @"
`$CdnBase='$CdnBase'; `$Repo='$Repo'; `$Branch='$Branch'; `$ScriptName='$ScriptName'; `$log='$LogPath';
try {
$Runner
} catch {
  "`$(Get-Date -Format o) ERROR: `$(`$_.Exception.Message)``n`$(`$_.ScriptStackTrace)" | Out-File -LiteralPath `$log -Encoding UTF8;
  Write-Host "``nInstallation failed: `$(`$_.Exception.Message)" -ForegroundColor Red;
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

Invoke-Expression $Runner
