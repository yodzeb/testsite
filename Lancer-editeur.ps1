# Lance l'éditeur du site (serveur Flask local) et ouvre l'interface dans le navigateur.
# Utilisation : clic droit > "Exécuter avec PowerShell", ou :  powershell -ExecutionPolicy Bypass -File .\Lancer-editeur.ps1

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$script = Join-Path $PSScriptRoot 'tools\editor\run.py'

# Cherche Python : lanceur "py" de Windows, sinon "python"
$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) { $python = @('py', '-3') }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $python = @('python') }

if (-not $python) {
    Write-Host "Python est introuvable." -ForegroundColor Red
    Write-Host "Installez-le depuis https://www.python.org/downloads/ (cochez 'Add Python to PATH'), puis relancez."
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

# run.py prépare l'environnement (première fois seulement), démarre le serveur
# Flask sur un port libre et ouvre automatiquement le navigateur.
$exe  = $python[0]
$args = @($python | Select-Object -Skip 1) + @($script)
& $exe @args
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host "L'éditeur s'est arrêté avec une erreur (code $code)." -ForegroundColor Red
    Read-Host "Appuyez sur Entrée pour fermer"
}
exit $code
