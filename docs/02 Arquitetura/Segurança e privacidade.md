---
tipo: conceito
tags: [arquitetura, segurança]
---

# Segurança e privacidade

Lista central das regras que protegem o usuário. Cada uma aponta para o módulo que a implementa; a nota do módulo explica o detalhe. **Qualquer mudança que enfraqueça uma destas regras precisa de uma decisão registrada em `04 Decisões/` (template [[Decisão]]) antes do código.**

## Segredos

| Segredo | Onde vive | Quem pode ler |
|---|---|---|
| Senha da conta | `data.json`, criptografada | Só o main, durante o login ou ao copiar |
| Chaves de API | `data.json`, criptografadas | Só o main, para [[rankApi]] |
| Sessão Riot salva | `sessions/<id>.bin`, criptografada | Só o main, ao restaurar |
| Token do backend Riot | Lockfile do Riot | Main; host privado recebe criptografado |
| Token da ponte local | `riot-client-bridge.json`, DPAPI | Addon main da cópia privada |

## Regras

### Interface nunca vê segredo
- O renderer recebe contas por `publicAccount`, sem senha ([[store]]).
- O painel integrado envia só `accountId` e jogo; a ponte serializa contas sem objetos internos do store ([[bridgeServer]]).
- `contextIsolation`, `sandbox` e `nodeIntegration: false` na janela; links externos só `https://` e sempre no navegador padrão ([[main]]).

### Segredo não vira texto público
- Mensagens de erro e progresso passam por `safeText`, que troca usuário e senha por `[redacted]` e devolve uma mensagem genérica se o segredo for curto demais para mascarar ([[signInService]]).
- Respostas de autenticação podem conter tokens, usuários e mensagens do servidor. Só valores fixos conhecidos saem de [[riotAuthentication]].
- Corpos de erro são não confiáveis: só códigos de erro conhecidos afetam a mensagem.
- Saída do processo do host privado nunca é repassada: o código do Riot pode imprimir material de conexão ([[privateClient]]).
- Os auxiliares PowerShell nunca ecoam o pedido recebido em logs ([[login.ps1]], [[windowGuard.ps1]]).
- `sign-in.log` e `data.log` não registram credenciais.

### Segredo não vai em argumento de processo
- `login.ps1` recebe credenciais por stdin ([[login.ps1]]).
- O host privado recebe só o caminho do script e um nome de pipe aleatório; o token chega criptografado pelo pipe ([[bootstrapChannel]], [[hostEntry]]).
- Os argumentos sintéticos do Riot (`--remotingAuthToken`…) existem só em `process.argv` em memória, nunca em `spawn`, stdout, stderr ou log, e são restaurados depois que o código do Riot os lê ([[privateHostCore]], [[privateHost]]).

### Rede local fechada
- A ponte escuta em `127.0.0.1`, exige token, confere `Host`, origem e tamanho do corpo ([[bridgeServer]]).
- A API local do Riot é acessada por HTTPS com a CA embutida da instalação, validação de certificado ligada ([[backend]], [[riotTransport]]).

### Arquivos dentro dos limites
- IDs de sessão validados contra travessia de caminho e streams NTFS ([[store]]).
- O host privado só aceita arquivos dentro do projeto, resolvendo links e ancestrais antes de criar pastas ([[privateHostCore]]).
- A cópia privada é verificada por manifesto, tamanhos, SHA-256 e marcadores antes de carregar ([[privateHostCore]], [[asar]]).
- A instalação original do Riot nunca é escrita pelo fluxo atual ([[ADR-001 Cópia privada da interface do Riot]]).

### Autenticação honesta
- Não há tentativa de contornar CAPTCHA ou 2FA ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]).
- Uma tela de verificação desconhecida nunca recebe senha automática.
- Nada de reenvio de senha após falha de senha, rede, limite ou CAPTCHA pós-submissão.
- O jogo só é pedido depois de confirmar o Riot ID ([[signInFlow]]).

### Área de transferência
- A senha copiada é apagada depois de 20 s se ainda estiver lá ([[main]]).

### Janelas e processos
- O monitor esconde apenas processos do Riot Client; jogos e Vanguard ficam fora ([[windowGuard.ps1]]).
- Nenhuma injeção de código, teclado global ou mouse; o preenchimento manda mensagens só para a janela do Riot ([[login.ps1]]).
- Ao fechar o app, os estilos de janela alterados são restaurados ([[windowController]]).

## Ameaças fora do escopo

- Malware rodando como o mesmo usuário Windows: o DPAPI não protege contra ele.
- Mudanças nos termos ou na API privada do Riot ([[Limitações conhecidas]]).
