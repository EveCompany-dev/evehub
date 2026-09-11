<#
.SYNOPSIS
  Agenda o builder noturno no Agendador de Tarefas do Windows.

.DESCRIPTION
  Cria uma tarefa que roda night-build.ps1 de segunda a sexta no horario
  escolhido. Nao precisa de admin: a tarefa roda como voce, com os seus
  acessos (Claude Code, git, gh).

  Para remover: Unregister-ScheduledTask -TaskName 'EveHub - Night Build'

.PARAMETER At
  Horario de inicio, formato 24h. Padrao 20:30.
#>
[CmdletBinding()]
param(
  [string]$At = '20:30',
  [string]$TaskName = 'EveHub - Night Build'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = Join-Path $ScriptDir 'night-build.ps1'

if (-not (Test-Path $Target)) { throw "Nao achei night-build.ps1 em $ScriptDir" }

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Target`"" `
  -WorkingDirectory $ScriptDir

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At

# A maquina fica ligada de qualquer jeito (Postgres e Redis rodam nela), mas
# estas opcoes garantem que a tarefa nao seja pulada por causa de energia.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "Tarefa '$TaskName' agendada para $At, de segunda a sexta."
Write-Host ''
Write-Host 'Teste antes de confiar na automacao:'
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$Target`" -DryRun"
Write-Host ''
Write-Host 'Rodar agora, de verdade:'
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
