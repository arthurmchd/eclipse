---
tipo: decisão
status: aceita
data: 2026-10-26
tags: [adr, integração]
---

# ADR-001 Cópia privada da interface do Riot

## Contexto

O usuário queria escolher a conta direto na tela de login do Riot Client, não numa janela separada. O Riot Client usa uma interface Electron (`RiotClientElectron/resources/app.asar`, pacote `riot-client-ux`). Não existe API de extensão para essa tela; o Pengu Loader, usado pelo Rose, só atua no cliente do League ([[Estudo - Comparação com o Rose]]).

## Decisão

Preparar, a partir da instalação local, uma **cópia privada** do `app.asar` dentro do projeto, com três addons anexados, e hospedá-la num Electron próprio com perfil separado, conectado aos serviços oficiais do Riot. A instalação original não é tocada.

## Alternativas consideradas

- **Substituir entradas do `app.asar` instalado.** Testado com backup e hashes. O cliente oficial voltou sozinho ao pacote original ao abrir, sem causa identificada. Abandonado; ferramentas em `scripts/legacy/`.
- **Plugin no lobby do League (padrão Rose).** Viável, mas só existe depois do League abrir e não cobre VALORANT nem a primeira entrada.
- **Só a janela própria do gerenciador.** Continua existindo como modo padrão, mas não atende o pedido de integração visual.

## Consequências

- Cada versão nova da interface do Riot exige validar compatibilidade e preparar uma cópia nova ([[Atualização do Riot Client]]). Versões desconhecidas são recusadas.
- O código precisa encontrar "âncoras" no JavaScript minificado do Riot ([[privateHostCore]], [[privateRendererCore]]), que mudam a cada versão.
- A cópia contém recursos proprietários e nunca pode ser distribuída.
- Falhas mostram mensagem clara em vez de abrir o cliente original em silêncio.

## Relacionado

- [[Integração com o Riot Client]]
- [[privateClient]] · [[privateHost]] · [[addons]]
