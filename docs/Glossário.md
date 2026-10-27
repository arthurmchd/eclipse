---
tipo: referência
tags: [glossário]
---

# Glossário

| Termo | Significado |
|---|---|
| **Riot Client Services** | `RiotClientServices.exe`, o serviço de fundo do Riot que expõe a API local HTTPS |
| **Lockfile** | Arquivo do Riot com porta, PID e token da API local ([[backend]]) |
| **RSO** | Riot Sign On, o sistema de autenticação da Riot |
| **Riot ID** | `gameName#tagLine`, a identidade pública da conta |
| **PUUID** | Identificador da conta na Riot API; criptografado por chave de API, por isso cada chave tem seu cache ([[rankApi]]) |
| **Sessão salva** | Cópia criptografada do `RiotGamesPrivateSettings.yaml` tirada com "manter conectado" ([[store]], [[riotClient]]) |
| **`tdid`** | Cookie de identificação do dispositivo, mantido ao limpar uma sessão para a Riot ainda reconhecer o PC |
| **`--headless`** | Opção do `RiotClientServices` que sobe só os serviços, sem interface ([[riotProcess]]) |
| **Produto** | Nome do jogo na API local: `league_of_legends` (LoL e TFT) ou `valorant` |
| **Monitor / guard** | `windowGuard.ps1`, que mantém as janelas do Riot ocultas ([[windowGuard.ps1]]) |
| **Interface nativa escondida** | O próprio formulário do Riot, invisível, usado quando a API de login não serve ([[login.ps1]]) |
| **Cópia privada** | `app.asar` da interface do Riot preparado dentro do projeto, com addons ([[Integração com o Riot Client]]) |
| **Candidate** | O `app.asar` preparado, no vocabulário do manifesto |
| **Addon** | Código anexado às entradas `main`, `preload` e `renderer` da cópia ([[addons]]) |
| **Host privado** | Processo Electron que carrega a cópia com perfil próprio ([[privateHost]], [[hostEntry]]) |
| **Ponte (bridge)** | Servidor HTTP em `127.0.0.1` que liga o painel ao gerenciador ([[bridgeServer]]) |
| **Canal de bootstrap** | Named pipe aleatório que entrega ao host o pedido de abertura ([[bootstrapChannel]]) |
| **Âncora** | Trecho literal do JavaScript minificado do Riot que o código procura para aplicar um ajuste ([[privateHostCore]], [[privateRendererCore]]) |
| **Marcador `RAM_*`** | Texto que prova que um ajuste foi aplicado; "RAM" = Riot Account Manager |
| **DPAPI** | Data Protection API do Windows, criptografia amarrada ao usuário ([[windowsDpapi]]) |
| **ASAR** | Formato de pacote do Electron ([[asar]]) |
| **HenrikDev** | API não oficial usada para o elo do VALORANT |
| **needsAttention** | Estado da operação que pede ação do usuário (2FA, CAPTCHA…) |
