#Requires -Version 5.1
<#
.SYNOPSIS
  Build Hammer 4.1 installer payload for Cloudflare CDN upload.

.USAGE
  powershell -ExecutionPolicy Bypass -File .\installer\package-payload.ps1

.OUTPUT
  installer\payload-out\Hammer-4.1.2.zip  (single file when under 100 MB)
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root = Split-Path $PSScriptRoot -Parent
$PublishDir = Join-Path $Root 'publish\Hammer3.9-obfuscated'
$FallbackDir = 'C:\Program Files (x86)\Hammer'
$OutDir = Join-Path $PSScriptRoot 'payload-out'
$ZipName = 'Hammer-4.1.3.zip'
$PartSizeBytes = 90MB
$MaxSingleFileBytes = 100MB

$IncludeFiles = @('Hammer.exe', 'hammer.ico')
$OffmodeFiles = @('dlhost.exe')
$ApplistGamesUrl = 'https://raw.githubusercontent.com/H-Chris233/steamappidlist/master/data/games_appid.json'
$ApplistFallbacks = @(
    (Join-Path $FallbackDir 'steam_applist.json'),
    'C:\Program Files (x86)\Hammerbkp4.0\steam_applist.json'
)
$DlhostFallbacks = @(
    'C:\Program Files (x86)\Hammerbkp4.0\offmode\dlhost.exe',
    'C:\Program Files (x86)\Hammer\offmode\dlhost.exe'
)

if (Test-Path (Join-Path $PublishDir 'Hammer.exe')) {
    $SourceDir = $PublishDir
    Write-Host "Using publish build: $SourceDir" -ForegroundColor Cyan
} elseif (Test-Path (Join-Path $FallbackDir 'Hammer.exe')) {
    $SourceDir = $FallbackDir
    Write-Host "Using installed build: $SourceDir" -ForegroundColor Yellow
} else {
    throw "Hammer.exe not found. Run publish-obfuscated.ps1 first."
}

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$staging = Join-Path $env:TEMP ('hammer41_pkg_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

foreach ($name in $IncludeFiles) {
    $src = Join-Path $SourceDir $name
    if (-not (Test-Path $src)) {
        if ($name -eq 'hammer.ico') {
            $alt = Join-Path $Root 'hammer.ico'
            if (Test-Path $alt) { $src = $alt } else { continue }
        } else {
            throw "Missing required file: $name"
        }
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $staging $name) -Force
    Write-Host "  staged $name" -ForegroundColor DarkGray
}

$offmodeStaging = Join-Path $staging 'offmode'
New-Item -ItemType Directory -Path $offmodeStaging -Force | Out-Null
foreach ($name in $OffmodeFiles) {
    $src = $null
    $candidates = @(
        (Join-Path (Join-Path $SourceDir 'offmode') $name)
    ) + $DlhostFallbacks
    foreach ($c in $candidates) {
        if (Test-Path $c) { $src = $c; break }
    }
    if (-not $src) {
        throw "Missing required file: offmode\$name (check Hammerbkp4.0\offmode or install offmode folder)"
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $offmodeStaging $name) -Force
    $len = (Get-Item $src).Length
    Write-Host "  staged offmode\$name ($([math]::Round($len/1MB,1)) MB)" -ForegroundColor DarkGray
}

function Build-SteamApplistFromGames([string]$gamesJsonPath, [string]$destPath) {
    Write-Host 'Building steam_applist.json (games-only, Steam v2 format) ...' -ForegroundColor Cyan
    $games = Get-Content -LiteralPath $gamesJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $apps = foreach ($g in $games) {
        if ($null -ne $g.appid -and -not [string]::IsNullOrWhiteSpace($g.name)) {
            @{ appid = [int]$g.appid; name = [string]$g.name }
        }
    }
    $wrapper = @{ applist = @{ apps = @($apps) } }
    $json = $wrapper | ConvertTo-Json -Depth 5 -Compress
    [System.IO.File]::WriteAllText($destPath, $json, [System.Text.UTF8Encoding]::new($false))
    $count = @($apps).Count
    $bytes = (Get-Item -LiteralPath $destPath).Length
    Write-Host "  steam_applist.json: $count games, $([math]::Round($bytes / 1MB, 1)) MB" -ForegroundColor DarkGray
}

$applistDest = Join-Path $staging 'steam_applist.json'
$applistReady = $false
$applistTemp = Join-Path $env:TEMP ('hammer_games_appid_' + [Guid]::NewGuid().ToString('N') + '.json')
try {
    Write-Host 'Fetching games_appid.json for autocomplete ...' -ForegroundColor Cyan
    curl.exe -fL -sS -o $applistTemp $ApplistGamesUrl
    if ((Test-Path $applistTemp) -and ((Get-Item $applistTemp).Length -gt 0)) {
        Build-SteamApplistFromGames $applistTemp $applistDest
        $applistReady = $true
    }
} catch {
    Write-Host "  fetch failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
} finally {
    Remove-Item $applistTemp -Force -ErrorAction SilentlyContinue
}

if (-not $applistReady) {
    foreach ($fb in $ApplistFallbacks) {
        if (Test-Path $fb) {
            Copy-Item -LiteralPath $fb -Destination $applistDest -Force
            $applistReady = $true
            Write-Host "  using fallback steam_applist: $fb" -ForegroundColor Yellow
            break
        }
    }
}

if (-not $applistReady) {
    throw 'steam_applist.json not available. Check internet or install Hammer with steam_applist.json present.'
}

$zipPath = Join-Path $env:TEMP ('hammer41_' + [Guid]::NewGuid().ToString('N') + '.zip')
Write-Host 'Creating zip ...' -ForegroundColor Cyan
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$zipLen = (Get-Item -LiteralPath $zipPath).Length
Write-Host "Zip size: $([math]::Round($zipLen / 1MB, 1)) MB" -ForegroundColor Green

Get-ChildItem $OutDir -Filter 'Hammer-4.1*.zip*' -ErrorAction SilentlyContinue | Remove-Item -Force

if ($zipLen -le $MaxSingleFileBytes) {
    $singlePath = Join-Path $OutDir $ZipName
    Copy-Item -LiteralPath $zipPath -Destination $singlePath -Force
    Write-Host "  single file: $([math]::Round($zipLen / 1MB, 1)) MB (no split)" -ForegroundColor DarkGray
} else {
    $partNum = 1
    $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $buf = New-Object byte[] (4MB)
        while ($fs.Position -lt $fs.Length) {
            $partPath = Join-Path $OutDir ("{0}.{1:D3}" -f $ZipName, $partNum)
            $out = [System.IO.File]::Create($partPath)
            try {
                $written = [int64]0
                while ($written -lt $PartSizeBytes -and $fs.Position -lt $fs.Length) {
                    $toRead = [Math]::Min($buf.Length, [int]($PartSizeBytes - $written))
                    if ($toRead -gt ($fs.Length - $fs.Position)) { $toRead = [int]($fs.Length - $fs.Position) }
                    $n = $fs.Read($buf, 0, $toRead)
                    if ($n -le 0) { break }
                    $out.Write($buf, 0, $n)
                    $written += $n
                }
            } finally { $out.Close() }
            $plen = (Get-Item $partPath).Length
            Write-Host "  part $partNum : $([math]::Round($plen / 1MB, 1)) MB" -ForegroundColor DarkGray
            $partNum++
        }
    } finally { $fs.Close() }
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$parts = Get-ChildItem $OutDir -Filter 'Hammer-4.1*.zip*' | Sort-Object Name
Write-Host "Created $($parts.Count) parts in $OutDir" -ForegroundColor Green
$parts | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1MB,1)) MB)" }
Write-Host ''
Write-Host 'Next: upload to sojorepo via upload-payload.ps1' -ForegroundColor Cyan
