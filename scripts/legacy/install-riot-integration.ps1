param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Full-Path([string]$Value) {
  if (-not $Value -or -not [System.IO.Path]::IsPathRooted($Value)) { throw 'Manifest paths must be absolute' }
  return [System.IO.Path]::GetFullPath($Value)
}

function Hash-File([string]$File) {
  $stream = [System.IO.File]::OpenRead($File)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}

function Assert-RegularFile([string]$File) {
  $item = Get-Item -LiteralPath $File
  if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Expected a regular file, not a link or directory' }
}

function Write-AtomicText([string]$File, [string]$Text) {
  $tempFile = "$File.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllText($tempFile, $Text, (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $File) { throw 'Backup metadata already exists' }
    [System.IO.File]::Move($tempFile, $File)
  } finally {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
  }
}

function Replace-Checked([string]$From, [string]$To, [string]$ExpectedCurrent, [string]$ExpectedReplacement) {
  $tempFile = "$To.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    Copy-Item -LiteralPath $From -Destination $tempFile
    if ((Hash-File $tempFile) -ne $ExpectedReplacement) { throw 'Replacement copy did not match its prepared hash' }
    if ((Hash-File $To) -ne $ExpectedCurrent) { throw 'Riot Client changed before replacement; nothing was installed' }
    [System.IO.File]::Replace($tempFile, $To, [System.Management.Automation.Language.NullString]::Value)
    if ((Hash-File $To) -ne $ExpectedReplacement) { throw 'Installed archive did not match the prepared hash' }
  } finally {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
  }
}

try {
  $manifestFile = (Resolve-Path -LiteralPath $Manifest).ProviderPath
  Assert-RegularFile $manifestFile
  $plan = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  if ($plan.schemaVersion -ne 1 -or $plan.source.package.name -ne 'riot-client-ux' -or $plan.source.package.main -ne './dist/main/main.js') { throw 'Unsupported integration manifest' }
  if (($plan.PSObject.Properties.Name -contains 'mode') -and $plan.mode -eq 'private-host') { throw 'Private-host manifests cannot be installed into the Riot Client' }
  $sourceFile = Full-Path ([string]$plan.source.path)
  $candidateFile = Full-Path ([string]$plan.candidate.path)
  $originalHash = [string]$plan.source.sha256
  $candidateHash = [string]$plan.candidate.sha256
  if ($originalHash -notmatch '^[a-f0-9]{64}$' -or $candidateHash -notmatch '^[a-f0-9]{64}$' -or $originalHash -eq $candidateHash) { throw 'Invalid integration hashes' }
  if ($sourceFile -notmatch '(?i)[\\/]RiotClientElectron[\\/]resources[\\/]app\.asar$') { throw 'Target is not the Riot Client interface archive' }
  if ([System.IO.Path]::GetFileName($candidateFile) -ne 'app.asar' -or
      [System.IO.Path]::GetDirectoryName($candidateFile) -ne [System.IO.Path]::GetDirectoryName($manifestFile) -or
      $sourceFile -eq $candidateFile) { throw 'Candidate must be the prepared archive beside the manifest' }
  Assert-RegularFile $sourceFile
  $running = @(Get-Process -Name 'Riot Client','RiotClientServices','RiotClientUx','RiotClientUxRender','LeagueClient','LeagueClientUx','LeagueClientUxRender','League of Legends','VALORANT','VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue)
  if ($running.Count) { throw 'Close Riot Client, League of Legends and VALORANT before installing or restoring' }

  $backupFile = "$sourceFile.ram-backup"
  $backupMetadataFile = "$backupFile.json"
  if ($Restore) {
    Assert-RegularFile $backupFile
    if ((Hash-File $backupFile) -ne $originalHash) { throw 'Backup no longer matches the original client' }
    if ((Hash-File $sourceFile) -eq $originalHash) { Write-Output 'Original Riot Client is already installed'; exit 0 }
    if ((Hash-File $sourceFile) -ne $candidateHash) { throw 'Riot Client changed after installation; refusing to overwrite it during restore' }
    Replace-Checked $backupFile $sourceFile $candidateHash $originalHash
    Write-Output 'Original Riot Client restored; verified backup retained'
    exit 0
  }

  Assert-RegularFile $candidateFile
  if ((Hash-File $sourceFile) -ne $originalHash -or (Get-Item -LiteralPath $sourceFile).Length -ne $plan.source.size) { throw 'Installed Riot Client differs from the prepared source; prepare again' }
  if ((Hash-File $candidateFile) -ne $candidateHash -or (Get-Item -LiteralPath $candidateFile).Length -ne $plan.candidate.size) { throw 'Prepared candidate changed; refusing installation' }
  if (Test-Path -LiteralPath $backupFile) {
    Assert-RegularFile $backupFile
    if ((Hash-File $backupFile) -ne $originalHash) { throw 'A backup from a different client version exists; preserve it before proceeding' }
  } else {
    $backupTemp = "$backupFile.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
      Copy-Item -LiteralPath $sourceFile -Destination $backupTemp
      if ((Hash-File $backupTemp) -ne $originalHash) { throw 'Could not verify the original client backup' }
      [System.IO.File]::Move($backupTemp, $backupFile)
    } finally { if (Test-Path -LiteralPath $backupTemp) { Remove-Item -LiteralPath $backupTemp -Force } }
  }
  if (Test-Path -LiteralPath $backupMetadataFile) {
    Assert-RegularFile $backupMetadataFile
    $metadata = Get-Content -LiteralPath $backupMetadataFile -Raw | ConvertFrom-Json
    if ($metadata.originalSha256 -ne $originalHash -or $metadata.candidateSha256 -ne $candidateHash) { throw 'Existing backup metadata belongs to another prepared candidate' }
  } else {
    $metadata = @{ schemaVersion = 1; source = $sourceFile; originalSha256 = $originalHash; candidateSha256 = $candidateHash; manifest = $manifestFile; createdAt = [DateTime]::UtcNow.ToString('o') }
    Write-AtomicText $backupMetadataFile ($metadata | ConvertTo-Json)
  }
  try {
    Replace-Checked $candidateFile $sourceFile $originalHash $candidateHash
  } catch {
    $installError = $_
    if ((Test-Path -LiteralPath $sourceFile) -and (Hash-File $sourceFile) -eq $candidateHash) {
      Replace-Checked $backupFile $sourceFile $candidateHash $originalHash
    }
    throw $installError
  }
  Write-Output 'Riot Client login integration installed; original backup verified and retained'
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}
