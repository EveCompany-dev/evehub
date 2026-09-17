<#
.SYNOPSIS
  Prepara esta maquina para acesso remoto seguro via Tailscale + SSH.

.DESCRIPTION
  LEIA scripts/remote-access/REMOTE-ACCESS.md ANTES DE RODAR.

  Este script muda a postura de seguranca da maquina. Ele foi escrito para ser
  lido inteiro antes de ser executado — nada aqui e magico.

  O que faz:
    1. instala Tailscale e gh (winget);
    2. instala o servidor OpenSSH do Windows;
    3. libera o SSH no firewall APENAS na faixa do Tailscale (100.64.0.0/10),
       nunca na internet nem na rede local inteira;
    4. desliga suspensao e hibernacao, para a maquina continuar alcancavel;
    5. define o PowerShell como shell padrao do SSH;
    6. NAO desliga a autenticacao por senha sozinho — isso fica para depois de
       voce confirmar que a chave publica funciona, senao da para se trancar
       do lado de fora.

  O que NAO faz (e voce precisa fazer na mao):
    - `tailscale up` e o login (exige seu navegador e sua conta);
    - copiar sua chave publica de casa para esta maquina;
    - desligar login por senha (passo final, documentado no fim da saida).

.PARAMETER WhatIf
  Mostra cada passo sem executar.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$SkipTailscale,
  [switch]$SkipSsh,
  [switch]$KeepSleep
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Rode este script como Administrador (necessario para OpenSSH, firewall e energia).'
  }
}

function Write-Step { param([string]$Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

Assert-Admin

# --- 1. ferramentas ---------------------------------------------------------

Write-Step '1/6 Ferramentas (Tailscale, GitHub CLI)'

if (-not $SkipTailscale -and -not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  if ($PSCmdlet.ShouldProcess('Tailscale', 'winget install')) {
    winget install --id Tailscale.Tailscale --silent --accept-source-agreements --accept-package-agreements
  }
} else {
  Write-Host 'Tailscale ja presente ou pulado.'
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  # O builder noturno usa o gh para abrir PR; sem ele so empurra a branch.
  if ($PSCmdlet.ShouldProcess('GitHub CLI', 'winget install')) {
    winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
  }
} else {
  Write-Host 'gh ja presente.'
}

# --- 2. servidor SSH --------------------------------------------------------

if (-not $SkipSsh) {
  Write-Step '2/6 Servidor OpenSSH'

  $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server*'
  if ($capability.State -ne 'Installed') {
    if ($PSCmdlet.ShouldProcess('OpenSSH.Server', 'Add-WindowsCapability')) {
      Add-WindowsCapability -Online -Name $capability.Name | Out-Null
    }
  } else {
    Write-Host 'OpenSSH Server ja instalado.'
  }

  if ($PSCmdlet.ShouldProcess('sshd', 'habilitar e iniciar')) {
    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd
  }

  # --- 3. firewall -------------------------------------------------------
  Write-Step '3/6 Firewall: SSH so pela Tailscale'

  # O Windows cria uma regra de SSH aberta para qualquer origem. Isso e o que
  # transforma "ligar SSH" em "expor a maquina". Removemos e recriamos a regra
  # restrita a faixa CGNAT que a Tailscale usa.
  Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

  if ($PSCmdlet.ShouldProcess('Firewall', 'criar regra SSH restrita ao Tailscale')) {
    New-NetFirewallRule `
      -Name 'EveHub-SSH-Tailscale-Only' `
      -DisplayName 'SSH (somente Tailscale)' `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort 22 `
      -RemoteAddress '100.64.0.0/10' `
      -Action Allow | Out-Null
  }

  # --- 4. shell padrao ---------------------------------------------------
  Write-Step '4/6 PowerShell como shell do SSH'
  if ($PSCmdlet.ShouldProcess('DefaultShell', 'definir PowerShell')) {
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell `
      -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
      -PropertyType String -Force | Out-Null
  }
}

# --- 5. energia -------------------------------------------------------------

if (-not $KeepSleep) {
  Write-Step '5/6 Energia: a maquina precisa continuar acordada'
  if ($PSCmdlet.ShouldProcess('Energia', 'desligar suspensao e hibernacao')) {
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /change monitor-timeout-ac 15   # a tela pode apagar; a maquina nao dorme
    powercfg /hibernate off
  }
}

# --- 6. proximos passos -----------------------------------------------------

Write-Step '6/6 O que falta — precisa ser voce'

@'
1. Conecte esta maquina a sua rede Tailscale:
       tailscale up
   Faca login com a MESMA conta que voce vai usar em casa.
   Anote o IP 100.x.y.z que aparecer em: tailscale ip -4

2. Em casa, instale a Tailscale e entre com a mesma conta.

3. Ainda em casa, gere uma chave e mande a PUBLICA para ca:
       ssh-keygen -t ed25519
   Cole o conteudo de ~/.ssh/id_ed25519.pub, NESTA maquina, em:
       C:\ProgramData\ssh\administrators_authorized_keys
   (esse e o arquivo certo para conta de administrador; permissoes:
       icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F")

4. Teste de casa:
       ssh SEU_USUARIO@100.x.y.z
   So depois que isso funcionar, desligue a senha (passo 5).

5. SO ENTAO, nesta maquina, edite C:\ProgramData\ssh\sshd_config:
       PasswordAuthentication no
   e reinicie:  Restart-Service sshd
   Pular este passo deixa a maquina aceitando senha para sempre.

6. No VS Code em casa: extensao "Remote - SSH", conectar em 100.x.y.z.
   Todo o processamento roda AQUI; seu notebook so desenha a tela.
'@ | Write-Host

Write-Host "`nLeia REMOTE-ACCESS.md para entender o que isso significa em termos de risco." -ForegroundColor Yellow
