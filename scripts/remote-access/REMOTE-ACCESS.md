# Acesso remoto — o que muda e o que voce esta aceitando

Leia antes de rodar `setup-remote-access.ps1`. O script e curto de proposito:
da para ler ele inteiro em cinco minutos, e vale a pena.

## O que a gente esta montando

```
notebook de casa                    maquina do escritorio
┌────────────────┐                  ┌──────────────────────────┐
│ VS Code        │                  │ Node, Docker, Postgres,  │
│ (so a tela)    │ ──Tailscale──▶   │ Redis, Claude Code        │
│                │   (WireGuard)    │ (todo o processamento)    │
└────────────────┘                  └──────────────────────────┘
```

Seu notebook nao precisa de forca nenhuma: ele so desenha a interface. Compilar,
rodar teste, subir container e chamar o modelo acontece tudo na maquina do
escritorio.

## Por que Tailscale e nao AnyDesk

| | AnyDesk / TeamViewer | Tailscale + SSH |
|---|---|---|
| Como te acha | servidor do fornecedor intermedia | rede privada WireGuard so sua |
| Porta aberta no roteador | nao, mas o cliente fica escutando o relay | **nenhuma** |
| Quem pode tentar entrar | quem descobrir/adivinhar o ID | so dispositivo autenticado na sua conta |
| Autenticacao | senha de sessao | identidade do dispositivo + MFA da sua conta |
| Se vazar credencial | acesso ao desktop inteiro | ainda precisa de um dispositivo aprovado |

AnyDesk e TeamViewer ja sofreram ataques de *credential stuffing* em que
maquinas de clientes foram acessadas. O modelo deles e "qualquer um na internet
pode tentar falar com voce, o segredo e que te protege". O do Tailscale e "nada
fala com voce a menos que ja esteja na sua rede" — nao ha superficie exposta
para atacar.

## O risco que voce precisa enxergar

**Esta maquina e a chave do cofre.** Nela ficam:

- `CREDENTIALS_KEY` no `.env`, que decifra toda credencial de connector;
- em breve, os tokens de Meta Ads e Google Ads **de todos os clientes**;
- `AUTH_SECRET`, que assina as sessoes do Eve Hub.

Quem entra nesta maquina nao ganha "acesso ao seu computador". Ganha acesso as
contas de anuncio dos seus clientes. Por isso o script:

- **nao** abre porta no roteador;
- restringe o SSH a faixa `100.64.0.0/10` (so Tailscale). A regra padrao que o
  Windows cria aceita conexao de qualquer origem — o script apaga essa e cria a
  restrita no lugar. Esse e o passo que separa "SSH ligado" de "maquina exposta";
- **nao** desliga a senha sozinho, porque desligar antes de testar a chave te
  tranca do lado de fora. E o unico passo manual que eu deixaria de fora.

### Depois de rodar, faca estas tres coisas

1. **Desligue o login por senha** (passo 5 da saida do script). Enquanto ele
   estiver ligado, sua senha do Windows e a unica barreira depois do Tailscale.
2. **Ligue MFA na conta Tailscale.** A rede inteira confia nessa conta; se ela
   cair, tudo cai junto.
3. **Revise os dispositivos** em login.tailscale.com de vez em quando e remova o
   que nao reconhecer. Considere ligar *device approval*, que exige aprovacao
   manual para cada maquina nova entrar.

### Coisas menores, mas reais

- **A maquina para de dormir.** Consumo maior e, mais importante, ela fica
  ligada e destravada no escritorio a noite. Trave a sessao do Windows ao sair:
  o SSH continua funcionando com a tela bloqueada.
- **Roda como voce.** O que voce alcanca por SSH e exatamente o que voce alcanca
  sentado nela — incluindo o `.env`.
- **O builder noturno tambem roda como voce**, e faz commit e push no repositorio
  com as suas credenciais do git.

## Se preferir cortar caminho

Nao instale nada e use a maquina do escritorio so pelo GitHub: commit de casa,
`git pull` no escritorio. Funciona, mas voce perde justamente o que queria —
rodar o projeto e o Claude Code com a forca da maquina de la.

## Reverter

```powershell
# tirar a maquina da rede
tailscale down

# parar e desabilitar o SSH
Stop-Service sshd
Set-Service -Name sshd -StartupType Disabled
Remove-NetFirewallRule -Name 'EveHub-SSH-Tailscale-Only'

# voltar a dormir depois de 30 min
powercfg /change standby-timeout-ac 30
```
