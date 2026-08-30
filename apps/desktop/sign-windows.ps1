param(
  [string]$Installer = "$PSScriptRoot\src-tauri\target\release\bundle\nsis\Kond Design_0.1.0_x64-setup.exe",
  [switch]$TrustForCurrentUser
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Installer)) {
  throw "Installer not found: $Installer. Run build-windows.cmd first."
}

$subject = "CN=Kond Design Development"
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
  $_.Subject -eq $subject -and $_.HasPrivateKey -and $_.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3"
} | Select-Object -First 1

if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(2)
}

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse |
  Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "Windows SDK signtool.exe was not found." }

& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /d "Kond Design" /tr http://timestamp.digicert.com /td SHA256 $Installer
if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }

if ($TrustForCurrentUser) {
  $cer = Join-Path $env:TEMP "kond-design-development.cer"
  Export-Certificate -Cert $cert -FilePath $cer -Force | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Remove-Item -LiteralPath $cer -Force
}

Get-AuthenticodeSignature -FilePath $Installer | Format-List Status,StatusMessage,SignerCertificate
Write-Host "Signed: $Installer"
