---
tipo: decisão
status: aceita
data: 2026-10-28
tags: [adr, arquitetura, interface]
---

# ADR-009 Sobreposição no cliente oficial

> Revisão de 2026-11-04: a sobreposição deixou de sumir ao trocar de programa e passou a ter a janela da Riot como dona. Ver [[ADR-012 Sobreposição presa à janela do Riot]].
>
> Revisão de 2026-11-07: a migração terminou. O modo anterior (`--private-client`) foi removido e a sobreposição é o único modo. Ver [[ADR-028 Modo antigo removido]].

## Contexto

O usuário quer abrir o Riot Client pelo atalho oficial, com o gerenciador já na bandeja. A cópia privada exige uma abertura própria e coordenação entre duas interfaces.

## Decisão

O modo padrão observa a janela oficial sem modificar seus arquivos ou injetar código. Uma janela Electron sem moldura exibe o botão Contas sobre ela; ao clicar, hospeda o mesmo WebContentsView isolado de gerenciamento. Um observador Windows somente de leitura informa retângulo físico, visibilidade e foco. A sobreposição acompanha posição e escala, desaparece ao minimizar, fechar ou alternar para outro aplicativo e durante autenticação. O processo continua na bandeja sem abrir a Riot no startup.

O IPC segue limitado ao renderer local exato. O serviço de contas continua dono de credenciais e operações. O modo antigo permanece disponível explicitamente por `--private-client` durante a migração. A sobreposição não depende de app.asar privado nem da ponte HTTP. Início automático com Windows não é ativado implicitamente.

Ao terminar um lançamento, o monitor libera os estilos da Riot mantendo suas janelas ocultas. Uma abertura oficial posterior pode reaparecer normalmente. Verificação humana continua usando a janela original.

## Consequências

A sobreposição é uma janela do gerenciador posicionada sobre o cliente oficial; não é um plugin Pengu. Requer validação de DPI, foco e movimentação. Falha do observador oculta o painel e informa erro; não deixa uma janela solta sobre outros aplicativos.
