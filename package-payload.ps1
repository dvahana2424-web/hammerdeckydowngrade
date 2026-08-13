#Requires -Version 5.1
<#
  Build Hammer 4.1 installer payload (includes offmode\dlhost.exe for Download Mode 2).
  Output: Hammer-4.1.zip.001, .002, ... (90 MB parts) for CDN / branch push.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$SourceDir = 'C:\Program Files (x86)\Hammer'
$PublishDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'hammer 3.9 beta\publish\Hammer3.9-obfuscated'
$OutDir = Join-Path $PSScriptRoot 'payload-out'
$ZipName = 'Hammer-4.1.zip'
$PartSizeBytes = 90MB

$IncludeFiles = @('Hammer.exe', 'hammer.ico')
$OffmodeFiles = @('dlhost.exe')
$DlhostFallbacks = @(
    'C:\Program Files (x86)\Hammerbkp4.0\offmode\dlhost.exe',
    'C:\Program Files (x86)\Hammer\offmode\dlhost.exe'
)

if (Test-Path (Join-Path $PublishDir 'Hammer.exe')) {
    $SourceDir = $PublishDir
    Write-Host "Using publish build: $SourceDir" -ForegroundColor Cyan
} elseif (Test-Path (Join-Path $SourceDir 'Hammer.exe')) {
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
            $alt = Join-Path $PSScriptRoot 'hammer.ico'
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
        throw "Missing required file: offmode\$name"
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $offmodeStaging $name) -Force
    $len = (Get-Item $src).Length
    Write-Host "  staged offmode\$name ($([math]::Round($len/1MB,1)) MB)" -ForegroundColor DarkGray
}

$zipPath = Join-Path $env:TEMP ('hammer41_' + [Guid]::NewGuid().ToString('N') + '.zip')
Write-Host 'Creating zip ...' -ForegroundColor Cyan
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$zipLen = (Get-Item -LiteralPath $zipPath).Length
Write-Host "Zip size: $([math]::Round($zipLen / 1MB, 1)) MB" -ForegroundColor Green

Get-ChildItem $OutDir -Filter 'Hammer-4.1.zip.*' -ErrorAction SilentlyContinue | Remove-Item -Force

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
} finally {
    $fs.Close()
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$parts = Get-ChildItem $OutDir -Filter 'Hammer-4.1.zip.*' | Sort-Object Name
Write-Host "Created $($parts.Count) parts in $OutDir" -ForegroundColor Green
$parts | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length/1MB,1)) MB)" }
