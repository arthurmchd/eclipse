---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/bootstrapChannel.js
camada: integração
testes: test/integration/bootstrapChannel.test.js
tags: [módulo]
---

# bootstrapChannel

> [!note] Removido em 2026-11-07
> O canal só abria o host da cópia privada. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Cria o canal local de uso único (named pipe no Windows) por onde o gerenciador entrega ao host privado o pedido de abertura.

## Responsabilidade

Do lado do gerenciador, abre um servidor de pipe com nome aleatório e espera exatamente uma conexão. Do lado do host, valida o nome recebido e conecta. O canal transporta o JSON inicial e depois os comandos `show`, `hide` e `stop` (ver [[privateClient]] e [[privateHost]]). O módulo não define o protocolo das mensagens.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createBootstrapChannel({ timeoutMs })` | função assíncrona | Escuta no pipe. Devolve `{ path, connected, close }`. `connected` resolve com o socket aceito. |
| `connectBootstrapChannel(pipePath)` | função | Valida o caminho e devolve `net.createConnection(pipePath)`. |
| `validBootstrapPath(value)` | função | `true` só para o formato exato gerado por este módulo. |

## Dependências

- Usa: `net`, `crypto`, `os`, `path`.
- Usado por: [[privateClient]] (cria), [[hostEntry]] (conecta).

## Invariantes e decisões

- **Nome imprevisível.** O nome usa 16 bytes aleatórios em hexadecimal: `\\.\pipe\riot-accounts-<32 hex>` no Windows. Fora do Windows é um socket `riot-accounts-<32 hex>.sock` em `os.tmpdir()`.
- **O host só conecta onde deve.** `connectBootstrapChannel` recusa qualquer caminho fora desse formato. Um argumento de linha de comando não consegue apontar o host para outro pipe ou arquivo local.
- **Uma conexão só.** A primeira conexão é aceita e o servidor é fechado em seguida. Conexões posteriores, ou após `close()`, são destruídas.
- **Sem permissão ampla.** O servidor escuta com `readableAll: false` e `writableAll: false`.
- **Prazo para conectar.** Se ninguém conectar em `timeoutMs` (padrão 30000 ms), `connected` rejeita e o canal fecha.
- **Fechar é idempotente.** `close()` destrói o socket aceito, fecha o servidor e rejeita `connected` se ainda estiver pendente.
- **Sem stdio da GUI.** O canal substitui stdin/stdout entre os processos. O host é iniciado com stdin ignorado (ver [[privateClient]]).

## Testes

`bootstrapChannel.test.js` cobre: troca de mensagens nos dois sentidos; expiração quando o filho nunca conecta; recusa de caminho local arbitrário.

## Pontos de atenção

- O nome do pipe vai na linha de comando do host (`--ram-bootstrap-pipe=`). Outro processo do mesmo usuário pode ver esse nome e tentar conectar primeiro. O conteúdo sensível vai cifrado com DPAPI de escopo `CurrentUser`, o que protege contra outros usuários e contra logs, não contra processos do mesmo usuário. Ver [[Segurança e privacidade]].
- Fora do Windows o caminho só é usado nos testes.
