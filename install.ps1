<#
    Hammer 3.8 - One-paste installer
    Usage (run in PowerShell):
        irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/installer/install.ps1 | iex

    Downloads the Hammer 3.8 payload, installs it to
    "C:\Program Files (x86)\Hammer", creates a Desktop shortcut and
    registers an entry in Control Panel > Programs (Uninstall).
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Config -------------------------------------------------------------
$Branch     = 'installer'
$RepoRaw    = "https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/$Branch"
$InstallUrl = "$RepoRaw/install.ps1"
$InstallDir = "C:\Program Files (x86)\Hammer"
$AppName    = 'Hammer 3.8'
$Version    = '3.8'
$Publisher  = 'Hammer'
$Parts      = @('Hammer-3.8.zip.001', 'Hammer-3.8.zip.002')

# ---- Self-elevate to Administrator --------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Requesting administrator rights..." -ForegroundColor Yellow
    $cmd = "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; irm $InstallUrl | iex"
    $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$b64
        ) | Out-Null
    } catch {
        Write-Host "Administrator rights are required. Installation cancelled." -ForegroundColor Red
    }
    return
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Installing $AppName" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# ---- Workspace ----------------------------------------------------------
$work = Join-Path $env:TEMP ("hammer38_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$zipPath = Join-Path $work 'Hammer-3.8.zip'

function Get-File($url, $dest) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            return
        } catch {
            if ($try -eq 3) { throw }
            Write-Host "   retry $try ..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds 2
        }
    }
}

try {
    # ---- Download parts -------------------------------------------------
    Write-Host "Downloading payload ($($Parts.Count) parts)..." -ForegroundColor Green
    $partFiles = @()
    $i = 0
    foreach ($p in $Parts) {
        $i++
        $dest = Join-Path $work $p
        Write-Host ("  [{0}/{1}] {2}" -f $i, $Parts.Count, $p)
        Get-File "$RepoRaw/$p" $dest
        $partFiles += $dest
    }

    # ---- Reassemble zip -------------------------------------------------
    Write-Host "Reassembling package..." -ForegroundColor Green
    $out = [System.IO.File]::Create($zipPath)
    try {
        foreach ($pf in $partFiles) {
            $in = [System.IO.File]::OpenRead($pf)
            try { $in.CopyTo($out) } finally { $in.Close() }
        }
    } finally { $out.Close() }

    # ---- Stop running Hammer --------------------------------------------
    Get-Process -Name 'Hammer','SteamDbBridgeHost','packer' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    # ---- Extract --------------------------------------------------------
    Write-Host "Installing to $InstallDir ..." -ForegroundColor Green
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $zip.Entries) {
            $target = Join-Path $InstallDir $entry.FullName
            if ([string]::IsNullOrEmpty($entry.Name)) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                continue
            }
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }

    $exePath = Join-Path $InstallDir 'Hammer.exe'
    $icoPath = Join-Path $InstallDir 'hammer.ico'
    $unPath  = Join-Path $InstallDir 'Uninstall.exe'

    # ---- Desktop shortcut ----------------------------------------------
    Write-Host "Creating Desktop shortcut..." -ForegroundColor Green
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrEmpty($desktop)) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
    $lnk = Join-Path $desktop "$AppName.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $sc  = $wsh.CreateShortcut($lnk)
    $sc.TargetPath       = $exePath
    $sc.WorkingDirectory = $InstallDir
    if (Test-Path $icoPath) { $sc.IconLocation = $icoPath }
    $sc.Description      = $AppName
    $sc.Save()

    # ---- Control Panel uninstall entry ----------------------------------
    Write-Host "Registering uninstall entry..." -ForegroundColor Green
    $regKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Hammer'
    if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
    $size = [math]::Round(((Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue |
             Measure-Object Length -Sum).Sum / 1KB))
    New-ItemProperty -Path $regKey -Name 'DisplayName'     -Value $AppName    -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'DisplayVersion'  -Value $Version    -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'Publisher'       -Value $Publisher  -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'DisplayIcon'     -Value $icoPath    -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'InstallLocation' -Value $InstallDir -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'UninstallString' -Value ('"{0}"' -f $unPath) -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'EstimatedSize'   -Value $size       -PropertyType DWord  -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'NoModify'        -Value 1           -PropertyType DWord  -Force | Out-Null
    New-ItemProperty -Path $regKey -Name 'NoRepair'        -Value 1           -PropertyType DWord  -Force | Out-Null

    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "  $AppName installed successfully!" -ForegroundColor Green
    Write-Host "  Location : $InstallDir" -ForegroundColor Green
    Write-Host "  Shortcut : $lnk" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Press any key to exit..."
try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch {}
