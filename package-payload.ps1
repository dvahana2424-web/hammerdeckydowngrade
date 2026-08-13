#Requires -Version 5.1
<#
 Build Hammer 4.0 installer payload from Program Files install.
 Output: Hammer-4.0.zip.001, .002, ... (90 MB parts) for GitHub release.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$SourceDir = 'C:\Program Files (x86)\Hammer'
$OutDir = Join-Path $PSScriptRoot 'payload-out'
$ZipName = 'Hammer-4.0.zip'
$PartSizeBytes = 90MB

$ExcludeDirs = @('capsule_cache')
$ExcludeFiles = @(
    'steampath.txt', 'hammer_settings.cfg', 'hammer.ver',
    'LOGS.txt', 'sojo_network_log.txt', 'sojo_downloader_log.txt'
)

if (-not (Test-Path (Join-Path $SourceDir 'Hammer.exe'))) {
    throw "Hammer.exe not found in $SourceDir"
}

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$staging = Join-Path $env:TEMP ("hammer40_pkg_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Host "Staging from $SourceDir ..." -ForegroundColor Cyan
Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
    if ($ExcludeDirs -contains $_.Name) { return }
    if ($_.Name -like 'Hammer.exe.bak-*') { return }
    if ($_.PSIsContainer) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $staging $_.Name) -Recurse -Force
    } elseif ($ExcludeFiles -notcontains $_.Name) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $staging $_.Name) -Force
    }
}

$zipPath = Join-Path $env:TEMP ("hammer40_" + [Guid]::NewGuid().ToString('N') + '.zip')
Write-Host "Creating zip ..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$zipLen = (Get-Item -LiteralPath $zipPath).Length
Write-Host "Zip size: $([math]::Round($zipLen/1MB,1)) MB" -ForegroundColor Green

Get-ChildItem $OutDir -Filter 'Hammer-4.0.zip.*' -ErrorAction SilentlyContinue | Remove-Item -Force

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
        Write-Host "  part $partNum : $([math]::Round($plen/1MB,1)) MB" -ForegroundColor DarkGray
        $partNum++
    }
} finally {
    $fs.Close()
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$parts = Get-ChildItem $OutDir -Filter 'Hammer-4.0.zip.*' | Sort-Object Name
Write-Host "Created $($parts.Count) parts in $OutDir" -ForegroundColor Green
$parts | ForEach-Object { Write-Host "  $($_.Name)" }
