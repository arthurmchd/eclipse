---
tipo: conceito
status: experimental
versões-riot: [141.0.0, 142.0.0]
tags: [arquitetura, integração]
---

# Integração com o Riot Client

Desde 2026-10-28, o padrão é a [[riotOverlay]] sobre o cliente oficial, conforme [[ADR-009 Sobreposição no cliente oficial]]. `npm start` e os atalhos iniciam somente o serviço. O usuário abre o Riot normalmente e acessa Contas. A janela acompanha posição e escala por [[riotWindowObserver]] e tem a janela da Riot como dona ([[ADR-012 Sobreposição presa à janela do Riot]]), sem injeção nem alteração da instalação. O conteúdo abaixo documenta o modo anterior, agora explícito por `npm run start:private`.

O atalho `Abrir Riot com minhas contas.bat` e `npm start` abrem uma **cópia privada** da interface real do Riot Client, hospedada pelo Electron do projeto e conectada aos serviços oficiais locais da Riot. **Contas** abre todo o gerenciamento na mesma janela Riot, e o seletor **MINHAS CONTAS** continua junto do formulário de login. A instalação original permanece intacta; não há mais janela independente Riot Account Manager.

Modo experimental para os pacotes de interface **141.0.0 e 142.0.0**. A instalação desta máquina usa o 142.0.0 e exibe **v142.0.1** no rodapé do login. Não é extensão carregada pelo executável original do Riot nem plugin do Rose/Pengu. A decisão está em [[ADR-001 Cópia privada da interface do Riot]].

## Como funciona

```mermaid
sequenceDiagram
  participant M as main (gerenciador)
  participant PC as privateClient
  participant HE as hostEntry + privateHost
  participant UI as cópia do app.asar + addons
  participant BR as bridgeServer
  participant RCS as Riot Client Services

  M->>BR: inicia a ponte em 127.0.0.1 (token protegido por DPAPI)
  M->>PC: open(clientPath)
  PC->>RCS: garante o backend e verifica HTTPS com a CA do Riot
  PC->>HE: spawn Electron + nome de named pipe aleatório
  PC->>HE: pedido de abertura com token criptografado (pipe)
  HE->>HE: valida manifesto, hashes, versão e marcadores
  HE->>UI: carrega o main da cópia com argumentos sintéticos em memória
  UI->>BR: lista contas (sem segredos)
  UI-->>PC: "ready" (painel carregado, gerenciador conectado)
  UI->>BR: signIn({ accountId, game })
  BR->>M: signInService.start(...)
```

Módulos envolvidos: [[privateClient]], [[hostEntry]], [[privateHost]], [[privateHostCore]], [[privateRendererCore]], [[addons]], [[bridgeServer]], [[bootstrapChannel]], [[backend]], [[asar]], [[windowsDpapi]].

O gerenciamento completo acrescenta [[managerHost]], [[manager-preload]] e [[managerService]]. O primeiro cria somente um `WebContentsView` filho da janela Riot, o segundo expõe a API limitada para seus próprios arquivos e o terceiro valida os comandos e mantém eventos públicos. A decisão e as fronteiras estão em [[ADR-007 Interface completa dentro do Riot Client]].

## Como usar

1. Após atualizar o código, encerre a instância anterior uma vez (bandeja → **Quit**).
2. Abra `Abrir Riot com minhas contas.bat`.
3. Use **Contas** para cadastrar, editar, excluir, consultar elos, filtrar, copiar dados, configurar chaves e acompanhar o login dentro da mesma janela. **Voltar ao Riot** fecha essa visualização. No formulário inicial também é possível expandir **MINHAS CONTAS**, escolher a conta e o jogo e pressionar **Entrar e jogar**.
4. O gerenciador oculta a interface e faz o login em segundo plano ([[Fluxo de login]]). Quando o jogo abrir, ele será a janela visível.

Se a Riot já estiver conectada, sua página inicial aparece. O acesso **Contas** continua disponível, sem desconectar a sessão apenas para gerenciar contas. O seletor rápido é específico do formulário de login.

O serviço continua na bandeja. Abrir contas pela bandeja usa a visualização dentro do Riot, sem outra janela. Recuperar o cliente mostra a interface correta para uma verificação pendente; cancelar e sair continuam disponíveis.

## Proteção dos dados

- O seletor rápido envia só o identificador da conta e o jogo. A visualização completa envia valores de cadastro/edição que o usuário digitou; senhas e chaves persistidas nunca são devolvidas para preencher formulários. Copiar senha é uma ação do main na área de transferência.
- A ponte escuta apenas em `127.0.0.1`, exige token, valida mensagens e limita o tamanho. O token é protegido pelo DPAPI do usuário.
- A inicialização usa um named pipe com nome aleatório. Credenciais de conexão não vão nos argumentos do processo; o token do backend chega criptografado.
- O backend é verificado por HTTPS com o certificado da instalação Riot, com validação de certificado ligada.
- A cópia usa um perfil Chromium próprio dentro do projeto. Os logs do código Riot recebem um filtro que oculta credenciais de conexão.
- No modo integrado o Riot fica sempre oculto, independentemente das preferências antigas do gerenciador.
- Senha incorreta, erro de rede e limite de tentativas não disparam reenvio. O preenchimento nativo só é usado se a API estiver indisponível ou o CAPTCHA vier antes da senha. CAPTCHA depois da submissão pede intervenção, não reenvia.
- Contexto de autenticação ausente ou em erro segue a tela oficial: limpar, inicializar, só então submeter.
- Troca pelo seletor rápido é recusada com LoL/TFT/VALORANT abertos. A visualização completa preserva as confirmações de encerramento do jogo antes de trocar. O login é serializado em ambos os caminhos.
- O gerenciamento completo é isolado da página Riot com sandbox, preload e validação de `webContents`, frame principal e URL local. Ele não recebe o token da ponte e não faz HTTP direto.

Mais em [[Segurança e privacidade]].

## Validação feita

Uma execução real carregou a cópia, confirmou o módulo no renderer e consultou a ponte com lista vazia e autenticação desabilitada. Resultado em `.client-integration/private-v1/probe-controller/result.json`:

```json
{ "ok": true, "rendererReady": true, "managerConnected": true, "mode": "private", "authenticationTested": false }
```

Depois da atualização para 142, o painel apareceu com as contas salvas na tela real de login, sem autenticar. **O fluxo completo com credenciais reais ainda precisa ser validado em uso.**

```powershell
npm run integration:probe-private
npm run preview:riot-login
```

O primeiro repete a verificação de compatibilidade com os serviços Riot abertos, sem login nem jogo. O segundo abre uma demonstração com contas fictícias.

## Atualizações do Riot

O manifesto e os hashes são conferidos antes de carregar a cópia. Uma atualização do Riot invalida a cópia, e o app mostra erro em vez de abrir o cliente original em silêncio. A atualização 142 exigiu adaptar o filtro de logs e a inicialização do protocolo Sentry. A cópia 141 foi preservada em `.client-integration/private-141-backup/`.

O passo a passo para uma versão nova está em [[Atualização do Riot Client]].

> [!warning] Não distribua
> O `app.asar` preparado contém recursos proprietários da Riot. A pasta `.client-integration/` está no `.gitignore` e não pode ir para Releases, ZIPs ou issues.

## Experimento anterior

Foi testada a substituição direta de três entradas do `app.asar` instalado, com backup e hashes. Ao abrir o cliente oficial, a instalação voltou ao pacote original e os módulos sumiram, sem causa identificada. Hash original confirmado: `2c5a8f20b687275fc64936911c883bd92360a794251881e6d74ab045886920fc`.

As ferramentas estão em `scripts/legacy/` e não são usadas pelo atalho. O instalador recusa manifestos da cópia privada. Ver [[Scripts de integração]] e [[status]].
