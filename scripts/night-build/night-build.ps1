<#
.SYNOPSIS
  Constroi um modulo da fila por noite, numa branch propria, e abre um PR.

.DESCRIPTION
  Roda sem ninguem olhando, entao as garantias importam mais que a velocidade:

    - um modulo por execucao, nunca a fila inteira;
    - nunca escreve em main: sempre branch feat/night-<slug>;
    - o agente NAO tem acesso ao git. Ele so edita arquivos e roda pnpm; todo
      branch/commit/push/PR e feito por este script. Assim o pior caso e uma
      branch ruim, nunca um main quebrado;
    - lint, typecheck e testes rodam de verdade; se falharem, o agente ganha UMA
      chance de corrigir com os erros na mao. Se ainda falhar, o PR e aberto como
      rascunho com o log anexado, em vez de fingir que deu certo;
    - a fila so avanca quando o modulo e concluido, entao um fracasso nao consome
      o item seguinte.

.PARAMETER DryRun
  Mostra o que faria e sai, sem chamar o modelo nem tocar em git.

.PARAMETER Slug
  Forca um modulo especifico em vez do proximo da fila.

.EXAMPLE
  .\night-build.ps1 -DryRun
  .\night-build.ps1
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$Slug,
  [int]$TimeoutMinutes = 90,
  [string]$Model = 'sonnet'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..\..')
$LogDir = Join-Path $ScriptDir 'logs'
$StatePath = Join-Path $ScriptDir 'state.json'
$QueuePath = Join-Path $ScriptDir 'queue.json'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir ("{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
  Write-Host $line
  Add-Content -Path $LogPath -Value $line -Encoding utf8
}

function Invoke-Step {
  <# Roda um comando e devolve exit code + saida, sem abortar o script. #>
  param([string]$Command)
  Write-Log "> $Command"
  $output = & cmd /c "$Command 2>&1"
  return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($output -join "`n") }
}

Set-Location $RepoRoot
Write-Log "Repositorio: $RepoRoot"

# --- verificacoes antes de mexer em qualquer coisa -------------------------

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Log 'Claude Code nao esta no PATH. Abortando.' 'ERRO'
  exit 1
}

$dirty = (& git status --porcelain)
if ($dirty) {
  # Trabalho nao commitado seria varrido para dentro do commit da noite.
  Write-Log 'Working tree sujo. Commite ou guarde suas mudancas antes. Abortando.' 'ERRO'
  Write-Log $dirty
  exit 1
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
  Write-Log "HEAD esta em '$branch', nao em main. Abortando para nao ramificar do lugar errado." 'ERRO'
  exit 1
}

Write-Log 'Atualizando main...'
$pull = Invoke-Step 'git pull --ff-only origin main'
if ($pull.Code -ne 0) {
  Write-Log "git pull falhou:`n$($pull.Output)" 'ERRO'
  exit 1
}

# --- escolhe o modulo -------------------------------------------------------

$queue = Get-Content $QueuePath -Raw -Encoding utf8 | ConvertFrom-Json
$state = if (Test-Path $StatePath) { Get-Content $StatePath -Raw -Encoding utf8 | ConvertFrom-Json } else { [pscustomobject]@{ done = @() } }
$done = @($state.done)

$module = $null
if ($Slug) {
  $module = $queue.modules | Where-Object { $_.slug -eq $Slug } | Select-Object -First 1
  if (-not $module) { Write-Log "Modulo '$Slug' nao esta na fila." 'ERRO'; exit 1 }
} else {
  foreach ($candidate in $queue.modules) {
    $isSkipped = ($candidate.PSObject.Properties.Name -contains 'skip') -and $candidate.skip
    if ($done -notcontains $candidate.slug -and -not $isSkipped) { $module = $candidate; break }
  }
}

if (-not $module) {
  Write-Log 'Fila vazia: todos os modulos ja foram construidos. Nada a fazer.'
  exit 0
}

Write-Log "Modulo da noite: $($module.slug) - $($module.title)"

if ($DryRun) {
  Write-Log 'DryRun ligado. Nada foi alterado.'
  Write-Log "Branch que seria criada: feat/night-$($module.slug)"
  exit 0
}

# --- branch ----------------------------------------------------------------

$branchName = "feat/night-$($module.slug)"
$existing = (& git branch --list $branchName)
if ($existing) {
  $branchName = "$branchName-" + (Get-Date -Format 'MMdd-HHmm')
  Write-Log "Branch ja existia; usando $branchName"
}

$null = Invoke-Step "git switch -c $branchName"

# --- prompt ----------------------------------------------------------------

$conventions = @'
Voce esta trabalhando no Eve Hub, um monorepo pnpm + Turborepo. Regras nao negociaveis:

- Leia readme.md e eve-hub-v0.0.3-escopo.md antes de comecar.
- Codigo, identificadores, tabelas e comentarios em INGLES. Strings visiveis ao
  usuario em pt-BR, sempre via packages/ui/src/strings.ts. Nunca texto solto na UI.
- Todo connector implementa EveConnector de @eve/connector-sdk. Use
  packages/connectors/demo como referencia: runtime em src/connector.ts,
  parte client-safe em src/shared.ts exportada como "./shared".
- @eve/core e SERVIDOR. Componente client importa @eve/core/dashboard, nunca o
  barrel — senao Prisma/argon2/ioredis vao parar no bundle do browser e o build quebra.
- Widget nunca importa o modulo de runtime do connector, so o "./shared".
- Se declarar capabilities.write, implemente write() E readVersion(). O registry
  cobra isso no import.
- Mudou schema.prisma? Rode: pnpm exec prisma migrate dev --name <nome>
- Escreva testes junto com o codigo, nunca depois. Vitest, arquivos *.test.ts.
- Antes de terminar, rode e deixe verde: pnpm lint, pnpm typecheck, pnpm test.
- NAO use git. Nada de commit, branch ou push: quem cuida disso e o script que te
  chamou. Seu trabalho e deixar os arquivos certos no disco.
- Nao toque em .env nem em nenhum segredo.
'@

$prompt = @"
$conventions

TAREFA DE HOJE — $($module.title)

$($module.brief)

Implemente por completo. Ao final, escreva um resumo curto do que fez, do que
deixou de fora e de qualquer coisa que um humano precise revisar com atencao.
"@

$promptFile = Join-Path $LogDir "prompt-$($module.slug).txt"
Set-Content -Path $promptFile -Value $prompt -Encoding utf8

# O agente pode editar e verificar, mas nao pode rodar comando arbitrario nem git
# de escrita. Blast radius: os arquivos do repo, nada alem disso.
$allowed = 'Read Glob Grep Edit Write "Bash(pnpm *)" "Bash(node *)" "Bash(git status)" "Bash(git diff*)"'

Write-Log 'Chamando o Claude Code (pode demorar)...'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)

$claudeCmd = "claude -p --model $Model --permission-mode acceptEdits --allowedTools $allowed --append-system-prompt `"Voce roda sem supervisao. Na duvida, escolha a opcao mais conservadora e registre a duvida no resumo final.`" < `"$promptFile`""
$run = Invoke-Step $claudeCmd
Add-Content -Path $LogPath -Value $run.Output -Encoding utf8

if ((Get-Date) -gt $deadline) { Write-Log 'Estourou o tempo limite.' 'AVISO' }

# --- verificacao ------------------------------------------------------------

function Test-Repo {
  $results = @()
  foreach ($step in @('pnpm lint', 'pnpm typecheck', 'pnpm test')) {
    $r = Invoke-Step $step
    $results += [pscustomobject]@{ Step = $step; Code = $r.Code; Output = $r.Output }
    if ($r.Code -ne 0) { break }
  }
  return $results
}

Write-Log 'Verificando...'
$checks = Test-Repo
$failed = $checks | Where-Object { $_.Code -ne 0 } | Select-Object -First 1

if ($failed) {
  Write-Log "Falhou em '$($failed.Step)'. Dando UMA chance de correcao ao agente." 'AVISO'

  $fixPrompt = @"
$conventions

A verificacao falhou em: $($failed.Step)

Saida do comando:
$($failed.Output)

Corrija a causa. Nao desabilite regra de lint, nao marque teste como skip e nao
afrouxe tipo para o erro sumir — conserte o problema de verdade. Se concluir que
a abordagem esta errada, reverta suas mudancas e explique o porque.
"@
  $fixFile = Join-Path $LogDir "fix-$($module.slug).txt"
  Set-Content -Path $fixFile -Value $fixPrompt -Encoding utf8

  $fixRun = Invoke-Step "claude -p --model $Model --permission-mode acceptEdits --allowedTools $allowed < `"$fixFile`""
  Add-Content -Path $LogPath -Value $fixRun.Output -Encoding utf8

  $checks = Test-Repo
  $failed = $checks | Where-Object { $_.Code -ne 0 } | Select-Object -First 1
}

$green = -not $failed

# --- commit + push ----------------------------------------------------------

$changed = (& git status --porcelain)
if (-not $changed) {
  Write-Log 'O agente nao alterou nada. Voltando para main e deixando a fila intacta.' 'AVISO'
  $null = Invoke-Step 'git switch main'
  $null = Invoke-Step "git branch -D $branchName"
  exit 1
}

$status = if ($green) { 'verde' } else { 'VERMELHO - revisar' }
$commitMessage = @"
feat($($module.slug)): $($module.title)

Construido pelo builder noturno, sem supervisao. Verificacao: $status.

$($module.brief)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
"@
$msgFile = Join-Path $LogDir "commit-$($module.slug).txt"
Set-Content -Path $msgFile -Value $commitMessage -Encoding utf8

$null = Invoke-Step 'git add -A'
$null = Invoke-Step "git commit -F `"$msgFile`""
$push = Invoke-Step "git push -u origin $branchName"

if ($push.Code -ne 0) {
  Write-Log "push falhou:`n$($push.Output)" 'ERRO'
  $null = Invoke-Step 'git switch main'
  exit 1
}

# --- PR ---------------------------------------------------------------------

$prBody = @"
Construido pelo builder noturno em $(Get-Date -Format 'dd/MM/yyyy HH:mm'), sem supervisao humana.

**Verificacao:** $status
**Log completo:** ``scripts/night-build/logs/`` na maquina do escritorio.

### Revise com atencao
Isto nao foi visto por ninguem antes de voce. Vale conferir:
- a logica bate com a intencao do modulo, nao so com o que compila;
- os testes testam comportamento, nao a propria implementacao;
- nada de segredo ou dado real entrou no repositorio.

### Escopo pedido
$($module.brief)
"@
$prFile = Join-Path $LogDir "pr-$($module.slug).md"
Set-Content -Path $prFile -Value $prBody -Encoding utf8

if (Get-Command gh -ErrorAction SilentlyContinue) {
  $draftFlag = if ($green) { '' } else { '--draft' }
  $pr = Invoke-Step "gh pr create --base main --head $branchName --title `"feat($($module.slug)): $($module.title)`" --body-file `"$prFile`" $draftFlag"
  if ($pr.Code -eq 0) { Write-Log "PR aberto: $($pr.Output)" } else { Write-Log "gh pr create falhou:`n$($pr.Output)" 'AVISO' }
} else {
  Write-Log 'gh nao instalado. Branch enviada; abra o PR manualmente em:' 'AVISO'
  Write-Log "https://github.com/EveCompany-dev/evehub/compare/$branchName?expand=1"
}

# So marca como feito se passou na verificacao: um modulo vermelho volta na
# proxima noite em vez de sumir da fila.
if ($green) {
  $done += $module.slug
  [pscustomobject]@{ done = $done; lastRun = (Get-Date -Format 'o') } | ConvertTo-Json | Set-Content $StatePath -Encoding utf8
  Write-Log "Modulo $($module.slug) concluido e marcado na fila."
} else {
  Write-Log "Modulo $($module.slug) ficou vermelho; continua na fila para a proxima noite." 'AVISO'
}

$null = Invoke-Step 'git switch main'
Write-Log 'Fim.'
