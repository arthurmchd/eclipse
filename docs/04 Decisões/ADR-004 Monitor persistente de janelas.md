---
tipo: decisão
status: substituída
data: 2026-10-26
tags: [adr, windows]
---

# ADR-004 Monitor persistente de janelas

> Substituída em 2026-11-07 pela [[ADR-028 Modo antigo removido]]. Só o login escondido do modo antigo armava o monitor; ele saiu do código, e o [[windowGuard]] ficou só com pedidos avulsos.

## Contexto

A primeira versão escondia uma única janela do Riot e vigiava por três minutos. O Riot recria janelas durante o login, enquanto o jogo carrega e depois de partidas, então elas reapareciam.

## Decisão

Um auxiliar PowerShell com C# ([[windowGuard]]) fica vivo durante toda a sessão de jogo, controlado por comandos em stdin ([[windowController]]):

- reconhece `Riot Client`, `RiotClientUx`, `RiotClientUxRender` e `RiotClientServices`;
- acompanha eventos de criação, exibição e foco (`SetWinEventHook`) e faz varreduras de segurança;
- deixa processos de jogos e do Vanguard fora do filtro;
- confirma cada comando antes de o chamador seguir, para a inicialização não competir com um monitor ainda não pronto;
- ao encerrar, restaura os estilos de janela originais.

## Alternativas consideradas

- **Iniciar o Riot com `windowsHide`.** Não impede que o processo filho mostre a interface; por isso os serviços sobem com `--headless` ([[riotProcess]]).
- **Injetar código no Riot.** Fora de questão ([[Segurança e privacidade]]).

## Consequências

- Eventos de janelas entre processos são assíncronos. O monitor reduz a exposição, mas não garante zero flashes em todas as versões de Windows, drivers e Riot.
- O monitor precisa ficar rodando; fechar o app encerra a proteção e devolve as janelas.

## Relacionado

- [Microsoft: SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook), sobre a entrega assíncrona dos eventos e a fila de mensagens
- [[Fluxo de login]]
