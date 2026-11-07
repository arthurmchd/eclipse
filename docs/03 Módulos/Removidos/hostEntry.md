---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/host/hostEntry.js
camada: integração
testes: test/integration/privateClient.test.js
tags: [módulo]
---

# hostEntry

> [!note] Removido em 2026-11-07
> O host da cópia privada saiu inteiro. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Script de entrada do processo Electron do host privado. É o arquivo que [[privateClient]] passa ao executável do Electron.

## Responsabilidade

Fixa o perfil isolado do Electron, registra um arquivo de status sem segredos e conecta no [[bootstrapChannel]]. Em seguida chama `runPrivateHost` de [[privateHost]] usando o canal como entrada e como saída do protocolo. Se algo falhar antes do host assumir, envia um evento de erro mínimo e encerra. Não valida a cópia nem carrega código do Riot por conta própria.

## API pública

Não exporta nada. Roda como script: `electron src/integration/host/hostEntry.js --ram-bootstrap-pipe=<pipe>`. O caminho vem de `PRIVATE_HOST_ENTRY` em [[paths]].

| Saída | Onde | Conteúdo |
|---|---|---|
| `bootstrap-status.json` | `.client-integration/private-v1/` | `started`, versão do Electron, nome do executável, presença de stdin/stdout; depois as últimas 12 etapas do host. |
| evento `error` | canal | `{ event: 'error', stage: 'bootstrap', kind, locations }` |

## Dependências

- Usa: [[paths]] (`PRIVATE_HOST_DIR`), [[bootstrapChannel]] (`connectBootstrapChannel`), [[privateHost]] (`runPrivateHost`), `electron`.
- Usado por: [[privateClient]], que o inicia como processo filho.

## Invariantes e decisões

- **Início explícito.** O Electron pode carregar scripts de entrada pelo módulo de aplicação padrão dele. Por isso a inicialização é explícita, sem depender de `require.main === module`.
- **Perfil isolado antes do primeiro ciclo de eventos.** `userData` e `sessionData` apontam para `private-v1/user-data/private-electron-profile` logo no início, de forma síncrona. Isso vale também para o tempo em que o host espera o pedido cifrado. (O comentário original dizia "via stdin"; hoje o pedido chega pelo pipe.)
- **Mesmo perfil depois da validação.** Depois de validar o pedido, [[privateHost]] aponta `userData` para `<userDataRoot>/private-electron-profile`. Com o `userDataRoot` que [[privateClient]] envia, é a mesma pasta.
- **Status sem segredos.** `bootstrap-status.json` só guarda dados de diagnóstico. As etapas vêm de `diagnostic(stage)`, chamado por [[privateHost]].
- **Erro de bootstrap mínimo.** `kind` só pode ser `Error`, `TypeError`, `SyntaxError` ou `ReferenceError`. `locations` guarda até três posições `privateHost.js` ou `privateHostCore.js` extraídas da pilha. Nenhuma mensagem de erro é enviada.
- **Sem pipe, sem host.** Sem o argumento `--ram-bootstrap-pipe=`, chama `app.exit(1)`.

## Testes

Não há teste direto do script. `privateClient.test.js` confere só que o filho é iniciado com `PRIVATE_HOST_ENTRY` e o argumento do pipe. O evento de erro `bootstrap` e o arquivo de status não têm teste. O resto do comportamento está em [[privateHost]].

## Pontos de atenção

- Depois de `app.exit(1)` não há `return`. A linha seguinte ainda chama `flag.slice` com `flag` indefinido, o que pode gerar uma exceção antes da saída.
- O script cria a pasta do perfil e grava `bootstrap-status.json` mesmo quando a cópia privada não foi preparada.
- A gravação de status nas etapas sobrescreve o arquivo e perde os campos iniciais (`electron`, `executable`).
