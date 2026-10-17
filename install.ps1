# Spotify Reimagined (CD Shelf) installer for Windows.
#   iwr -useb https://raw.githubusercontent.com/OWNER/spotify-reimagined/main/install.ps1 | iex
# Needs Spicetify (https://spicetify.app). Set $env:CDS_ZIP to install a specific build.
$ErrorActionPreference = 'Stop'
$repo = 'OWNER/spotify-reimagined'
$zipUrl = if ($env:CDS_ZIP) { $env:CDS_ZIP } else { "https://github.com/$repo/releases/latest/download/cd-shelf.zip" }

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
  throw "Spicetify isn't installed. Install it first: https://spicetify.app/docs/getting-started"
}
$configDir = Split-Path (spicetify -c)
$appDir = Join-Path $configDir 'CustomApps\cd-shelf'
$zip = Join-Path $env:TEMP 'cd-shelf.zip'

Write-Host 'Downloading CD Shelf...'
if ($zipUrl -match '^https?://') { Invoke-WebRequest -UseBasicParsing $zipUrl -OutFile $zip } else { Copy-Item $zipUrl $zip -Force }
New-Item -ItemType Directory -Force $appDir | Out-Null
Expand-Archive $zip $appDir -Force
Remove-Item $zip

Write-Host 'Registering it with Spicetify...'
if (-not ((spicetify config custom_apps) -match 'cd-shelf')) { spicetify config custom_apps cd-shelf | Out-Null }
spicetify apply

Write-Host 'Done. Open Spotify: CD Shelf is your new home page.'
