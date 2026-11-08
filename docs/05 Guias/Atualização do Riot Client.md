---
tipo: guia
tags: [integração, manutenção]
---

# Atualização do Riot Client

Os cartões ficam sobre a janela oficial da Riot e não dependem de uma versão da interface dela. O Eclipse não copia nem altera a instalação ([[ADR-028 Modo antigo removido]]). Uma atualização da Riot só quebra algo quando muda o desenho da tela de login, a API local ou o local do certificado.

## Sintomas

- Os cartões cobrem parte da coluna de login, ou deixam uma faixa da arte à mostra.
- A caixa "Ocultar contas" fica fora do lugar da caixa da Riot.
- O login visível digita no lugar errado ou não marca "Manter conectado".
- Os cartões não somem com um diálogo da Riot aberto, ou somem sem motivo.
- O `sign-in.log` mostra erro da API local, de certificado ou um estado de sessão desconhecido.

## O que pode quebrar

| Ponto | Onde | Por quê |
|---|---|---|
| Largura da coluna de login | `cardsLeft` em [[riotOverlay]] (400/1536 da largura) | Os cartões começam onde a arte começa |
| Caixa "Ocultar contas" | `TOGGLE_AREA` em [[overlayToggle]] | Posição medida na tela de login |
| Ponto do painel e caixa "Stay signed in" | `PANEL_POINT` em [[riotWindowObserver]] (`PANEL_X`, `PANEL_Y`, `BOX_X`, `BOX_Y` no `.ps1`) | O observador lê cores nesses pontos para saber se o formulário está à mostra e se a caixa está marcada |
| Posições do preenchimento nativo | `$USERNAME`, `$PASSWORD`, `$REMEMBER`, `$SUBMIT`, `$PANEL` em [[login.ps1]] | Frações medidas na janela da Riot; só usadas quando a API pede o formulário |
| Estados da sessão do jogador | `NON_BLOCKING_SESSION_STATES` em [[riotAuthentication]] | Estado automático novo fica bloqueado até entrar na lista. Compare com a enumeração `PlayerSessionStateType` em `C:\Riot Games\Riot Client\RiotGamesApi.dll` (só leitura) |
| Rotas da API local | constantes no topo de [[riotAuthentication]] e [[riotInterface]] | Rota nova ou removida muda o login e a abertura da interface |
| Certificado da API local | `dist/main/root.pem` dentro do `app.asar` oficial, lido por [[backend]] com [[asar]] | Sem ele, o HTTPS para a API local é recusado |
| Lockfile | `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` ([[backend]]) | Porta e senha da API local |
| Elo pelo jogo | Rotas e campos em [[gameRanks]]: `/lol-summoner/v1/current-summoner`, `/lol-ranked/v1/current-ranked-stats`, `/chat/v1/session`, `/chat/v4/presences`, e o `lockfile` na pasta do LoL | Sem eles, o elo sem chave para de atualizar; o `data.log` mostra "could not read the ranks" |

Os serviços do Riot (`RiotGamesApi.dll`) atualizam junto com a interface e também afetam o login em segundo plano.

## Passo a passo

1. **Confira à vista.** Abra a Riot com o Eclipse e compare cartões, caixa "Ocultar contas" e cópias de minimizar e fechar com a tela da Riot, sem autenticar. Teste também a Riot com 1024 × 576, o menor tamanho dela.
2. **Meça de novo o que mudou.** As constantes da tabela são frações da área cliente. Meça numa captura de tela da Riot em 1536 × 864 e atualize a fração.
3. **Confira a API.** Se o login falhar, procure no `sign-in.log` a rota ou o estado que mudou. Para comparar versões, leia o `app.asar` e a `RiotGamesApi.dll` só para leitura.
4. **Teste.** Ajuste os testes do módulo alterado. `npm test` tem de passar.
5. **Registre.** Atualize a nota do módulo, [[Integração com o Riot Client]] e o [[Changelog]].

## Ferramenta útil: REA

Para comparar versões, o REA (Reverse Engineer Anything, <https://github.com/morluto/rea>) analisa apps Electron, bundles JavaScript e binários .NET. Ele está configurado como servidor MCP no Claude Code desta máquina, mas não foi auditado. Use só leitura, nunca escreva na instalação da Riot.

> [!warning]
> Nunca escreva em `C:\Riot Games\` nem distribua arquivos tirados da instalação da Riot.
