<#
  stop.ps1 — libera los puertos de desarrollo de este proyecto.

  Uso rápido:
    .\stop                 # cierra 4130 y 4120
    .\stop 4130            # sólo ese puerto
    .\stop 4130 4120 4110  # los que indiques

  Sólo cierra procesos que estén escuchando en esos puertos; no toca nada más.
  Usa `netstat` en vez de Get-NetTCPConnection porque en esta máquina el cmdlet
  tarda ~40 s por consulta.
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [int[]] $Ports = @(4130, 4120)
)

$wanted = @{}
foreach ($port in $Ports) { $wanted[[int]$port] = $true }

# PID -> lista de puertos que tiene escuchando.
$hits = @{}
foreach ($line in (netstat -ano -p TCP)) {
  $parts = ($line -replace '\s+', ' ').Trim().Split(' ')
  if ($parts.Count -lt 5 -or $parts[0] -ne 'TCP') { continue }
  # Sólo sockets escuchando; evita TIME_WAIT/FIN_WAIT_2 del servidor anterior.
  if ($parts[3] -notmatch 'LISTEN|ESCUCH') { continue }

  $local = $parts[1]
  $colon = $local.LastIndexOf(':')
  if ($colon -lt 0) { continue }

  $localPort = 0
  if (-not [int]::TryParse($local.Substring($colon + 1), [ref]$localPort)) { continue }
  if (-not $wanted.ContainsKey($localPort)) { continue }

  $ownerId = 0
  if (-not [int]::TryParse($parts[4], [ref]$ownerId) -or $ownerId -le 0) { continue }

  if (-not $hits.ContainsKey($ownerId)) {
    $hits[$ownerId] = [System.Collections.Generic.List[int]]::new()
  }
  if (-not $hits[$ownerId].Contains($localPort)) {
    $hits[$ownerId].Add($localPort)
  }
}

if ($hits.Count -eq 0) {
  Write-Host "No habia nada escuchando en: $($Ports -join ', ')"
  return
}

foreach ($processId in $hits.Keys) {
  $portsText = ($hits[$processId] | Sort-Object) -join ', '
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) {
    Write-Host "  - PID $processId ya no existe (puertos $portsText)"
    continue
  }

  try {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Write-Host "  x puerto(s) $portsText cerrado(s) (PID $processId, $($process.ProcessName))"
  }
  catch {
    Write-Host "  ! no se pudo cerrar el PID $processId (puertos $portsText)"
  }
}
