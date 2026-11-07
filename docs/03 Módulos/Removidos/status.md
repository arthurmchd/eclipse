---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/status.js
camada: integração
testes: test/integration/clientIntegrationStatus.test.js
tags: [módulo]
---

# status

> [!note] Removido em 2026-11-07
> O diagnóstico só conferia a cópia privada e o experimento antigo. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Diz se o `app.asar` instalado do Riot está com a integração do experimento legado aplicada.

## Responsabilidade

Inspeciona o `app.asar` da instalação real do Riot Client, ao lado do executável. Confirma o pacote, a versão e a presença do marcador nas três entradas. Só lê; nunca altera nada. Não trata a cópia privada: isso é [[privateClient]] (`inspectPrivateClient`).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `inspectClientIntegration(clientPath)` | função | Devolve `{ active, version?, reason }`. `active` é `true` só com a integração legada completa. |

## Dependências

- Usa: [[asar]] (`openArchive`).
- Usado por: [[main]] (`ensureClientIntegration`).

## Invariantes e decisões

- **Caminho fixo relativo ao executável.** O arquivo inspecionado é `RiotClientElectron\resources\app.asar` na pasta de `clientPath`.
- **Só a versão validada.** O pacote precisa se chamar `riot-client-ux` e ter versão `141.0.0`. Qualquer outra versão devolve `active: false` com a versão encontrada.
- **As três entradas, sem exceção.** `dist/main/main.js`, `dist/main/preload.js` e `dist/renderer/renderer.js` precisam conter `RAM_LOGIN_INTEGRATION_V1`. Uma interface original ou substituída em parte nunca ativa a ponte.
- **Falha fechada.** Riot ausente, arquivo ausente ou qualquer erro de leitura devolvem `active: false` com motivo genérico. Não precisa de processo do Riot rodando.
- **Limites de leitura.** `package.json` até 16 KiB. Cada entrada até 20 MiB.
- **Sem `mode`.** O resultado não tem `mode`. O [[main]] trata isso como integração instalada e abre o Riot normal com `riotClient.openClient`.
- **Precedência no main.** O [[main]] consulta este módulo primeiro. Só se não estiver ativo e o app estiver no modo `--riot-login` ele tenta a cópia privada.

## Testes

`clientIntegrationStatus.test.js` cobre: interface original ou com só parte das entradas nunca ativa; as três entradas são exigidas na versão compatível; instalação ausente falha fechada.

## Pontos de atenção

- O experimento legado não é mais usado pelo atalho. Ver [[Integração com o Riot Client]] e [[Scripts de integração]].
- A versão aceita é só `141.0.0`, mas o script legado de preparação não confere versão. Uma integração legada aplicada sobre outra versão seria relatada como inativa.
- Quando o Riot se atualiza, ele substitui o `app.asar` e o status volta a inativo. A mensagem de motivo já menciona isso.
