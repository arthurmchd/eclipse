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
| **Cartões** | O painel de contas sobre a arte da janela da Riot ([[cards]], [[riotOverlay]]) |
| **Sobreposição** | A janela transparente presa à janela da Riot que hospeda os cartões, a caixa e a cobertura ([[riotOverlay]]) |
| **Caixa "Ocultar contas"** | Caixa sobre a coluna de login que esconde os cartões e mostra a arte da Riot ([[overlayToggle]]) |
| **Cobertura** | Carregamento sobre a coluna de login enquanto o Eclipse entra na conta ([[overlayCover]]) |
| **Guardião** | O [[sessionKeeper]], que guarda a sessão de cada conta e deixa a Riot sempre abrir desconectada |
| **Helper de janelas / guard** | [[windowGuard]], chamado uma vez por pedido: traz a janela do Riot à frente, fecha a janela dele e procura a janela do jogo. O monitor persistente que escondia a Riot no modo antigo saiu em 2026-11-07 ([[windowGuard]]) |
| **Preenchimento nativo** | O Eclipse digitando no formulário visível da Riot quando a API de login não serve ([[loginForm]]) |
| **DPAPI** | Data Protection API do Windows, criptografia amarrada ao usuário; usada pelo `safeStorage` do Electron no [[store]] |
| **ASAR** | Formato de pacote do Electron ([[asar]]) |
| **HenrikDev** | API não oficial usada para o elo do VALORANT |
| **needsAttention** | Estado da operação que pede ação do usuário (2FA, CAPTCHA…) |
