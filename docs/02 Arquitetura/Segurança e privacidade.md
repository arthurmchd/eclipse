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

### Interface não recebe segredo persistido
- O renderer recebe contas por `publicAccount`, sem senha ([[store]]).
- O seletor rápido integrado envia só `accountId` e jogo. O gerenciamento completo vive em um `WebContentsView` isolado na mesma janela Riot, com preload próprio e comandos validados ([[managerHost]], [[manager-preload]], [[managerService]]).
- Cadastro e edição transportam os valores que o usuário acabou de digitar. Senhas e chaves já guardadas nunca são devolvidas para preencher os campos; o serviço recebe os valores novos e os armazena criptografados. Essa distinção e a nova fronteira estão registradas em [[ADR-007 Interface completa dentro do Riot Client]].
- Copiar senha escreve diretamente na área de transferência pelo main; a resposta devolve somente o resultado da ação.
- `contextIsolation`, `sandbox` e `nodeIntegration: false` na visualização de contas. O IPC aceita apenas o `webContents`, o frame principal e a URL local esperada; o renderer Riot não recebe a API de gerenciamento completo.
- Links externos só `https://` e sempre no navegador padrão; navegação para outra página e criação de janelas pela visualização são recusadas ([[managerHost]]).

### Segredo não vira texto público
- Mensagens de erro e progresso passam por `safeText`, que troca usuário e senha por `[redacted]` e devolve uma mensagem genérica se o segredo for curto demais para mascarar ([[signInService]]).
- Respostas de autenticação podem conter tokens, usuários e mensagens do servidor. Só valores fixos conhecidos saem de [[riotAuthentication]].
- Corpos de erro são não confiáveis: só códigos de erro conhecidos afetam a mensagem.
- Saída do processo do host privado nunca é repassada: o código do Riot pode imprimir material de conexão ([[privateClient]]).
- Os auxiliares PowerShell nunca ecoam o pedido recebido em logs ([[login.ps1]], [[windowGuard.ps1]]).
- Motivos de queda do monitor só chegam ao log como códigos `^[a-z0-9-]{1,64}$`; o resto vira `unknown` ([[windowController]]).
- `sign-in.log` e `data.log` não registram credenciais.

### Segredo não vai em argumento de processo
- `login.ps1` recebe credenciais por stdin ([[login.ps1]]).
- O host privado recebe só o caminho do script e um nome de pipe aleatório; o token chega criptografado pelo pipe ([[bootstrapChannel]], [[hostEntry]]).
- Os argumentos sintéticos do Riot (`--remotingAuthToken`…) existem só em `process.argv` em memória, nunca em `spawn`, stdout, stderr ou log, e são restaurados depois que o código do Riot os lê ([[privateHostCore]], [[privateHost]]).

### Rede local fechada
- A ponte escuta em `127.0.0.1`, exige token, confere `Host`, origem e tamanho do corpo ([[bridgeServer]]).
- Gerenciamento usa uma rota autenticada com lista fechada de métodos e validação dos argumentos no [[managerService]]. O token permanece no addon main, sem ser entregue ao renderer de contas ou à página Riot.
- A fila de eventos tem tamanho limitado e carrega somente dados públicos de contas, configurações mascaradas e progresso. O fechamento da visualização não cancela uma operação nem faz o serviço devolver credenciais.
- A API local do Riot é acessada por HTTPS com a CA embutida da instalação, validação de certificado ligada ([[backend]], [[riotTransport]]).

### Arquivos dentro dos limites
- IDs de sessão validados contra travessia de caminho e streams NTFS ([[store]]).
- O host privado só aceita arquivos dentro do projeto, resolvendo links e ancestrais antes de criar pastas ([[privateHostCore]]).
- A cópia privada é verificada por manifesto, tamanhos, SHA-256 e marcadores antes de carregar ([[privateHostCore]], [[asar]]).
- A instalação original do Riot nunca é escrita pelo fluxo atual ([[ADR-001 Cópia privada da interface do Riot]]).

### Autenticação honesta
- Não há tentativa de contornar CAPTCHA ou 2FA ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]).
- Uma tela de verificação desconhecida nunca recebe senha automática.
- Nada de reenvio de senha após falha de senha, rede, limite, rota indisponível ou CAPTCHA pós-submissão ([[riotAuthentication]]).
- Estado desconhecido da sessão do jogador conta como verificação pendente, nunca como autenticado ([[riotAuthentication]]).
- O jogo só é pedido depois de confirmar o Riot ID ([[signInFlow]]).

### Área de transferência
- A senha copiada é apagada depois de 20 s se ainda estiver lá ([[main]]).

### Janelas e processos
- O padrão desde [[ADR-009 Sobreposição no cliente oficial]] é uma janela própria sem moldura que acompanha o cliente oficial. O observador só lê geometria e processo; exige caminho do executável Riot esperado e não lê título, conteúdo ou credenciais. A única janela que ele altera é a da sobreposição, e só se ela pertencer ao processo do gerenciador ([[ADR-012 Sobreposição presa à janela do Riot]]). A view mantém o mesmo isolamento e validação IPC. A hospedagem privada abaixo continua apenas em modo explícito.
- O main do aplicativo não cria mais a janela independente Riot Account Manager. A interface completa é filha da própria janela Riot; fechar a visualização volta ao Riot, e sair do serviço continua sendo uma ação na bandeja ([[ADR-007 Interface completa dentro do Riot Client]]).
- O monitor esconde apenas processos do Riot Client; jogos e Vanguard ficam fora ([[windowGuard.ps1]]).
- Nenhuma injeção de código, teclado global ou mouse; o preenchimento manda mensagens só para a janela do Riot ([[login.ps1]]).
- Ao fechar o app, os estilos de janela alterados são restaurados ([[windowController]]).

## Ameaças fora do escopo

- Malware rodando como o mesmo usuário Windows: o DPAPI não protege contra ele.
- Mudanças nos termos ou na API privada do Riot ([[Limitações conhecidas]]).
